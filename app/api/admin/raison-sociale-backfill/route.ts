// ============================================================
// POST /api/admin/raison-sociale-backfill
//
// Corrige les prospects dont `raison_sociale` est NULL ou égale au SIREN
// (fallback UI) en les ré-enrichissant via l'API Recherche Entreprises.
//
// Problème : le bulk SIRENE (StockEtablissement_utf8.csv) ne contient pas
// la dénomination de l'unité légale — uniquement dans StockUniteLegale.
// Résultat : prospects insérés avec raison_sociale='Inconnu' ou null.
//
// AUTH DUAL-MODE :
//   1. Session SSR (user) → traite uniquement ses propres prospects.
//   2. Bearer CRON_SECRET → traite les N plus récents toutes users confondus
//      (mode batch admin pour corriger le stock initial).
//
// IDEMPOTENT : un prospect déjà corrigé (raison_sociale non-null et != SIREN)
// n'est pas retouché — le filtre WHERE le garantit.
//
// PAGINATION : body `{ limit }` (défaut 100, max 500) pour rester sous
// Vercel Hobby 60s. Appeler plusieurs fois jusqu'à `remaining === 0`.
//
// SÉCURITÉ :
//   - Pas de PII loggé (on log uniquement les SIREN et les compteurs).
//   - UPDATE via service_role (bypass RLS nécessaire pour le mode cron
//     multi-users). En mode user, on filtre explicitement par user_id
//     (la session SSR ne suffit pas ici car on utilise adminClient).
// ============================================================

import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isCronRequest } from '@/lib/auth/cron'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { fetchRaisonSocialesBatch } from '@/lib/agent/sources/lookup-raison-sociale'

export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

// ------------------------------------------------------------
// ZOD
// ------------------------------------------------------------

const BodySchema = z.object({
  limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
})

// ------------------------------------------------------------
// HANDLER
// ------------------------------------------------------------

export async function POST(req: NextRequest) {
  // 1. Auth dual-mode.
  const cronOk = isCronRequest(req)
  let userId: string | null = null

  if (!cronOk) {
    const sbSsr = await createClient()
    const {
      data: { user },
    } = await sbSsr.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Non authentifié' } },
        { status: 401 },
      )
    }

    userId = user.id
  }

  // 2. Validation body (optionnel — défaut limit=100).
  let body: z.infer<typeof BodySchema> = {}
  try {
    const raw = await req.json().catch(() => ({}))
    const parsed = BodySchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: parsed.error.message } },
        { status: 400 },
      )
    }
    body = parsed.data
  } catch {
    // body absent ou non-JSON → on utilise les défauts
  }

  const limit = body.limit ?? DEFAULT_LIMIT

  // 3. Sélection des prospects à corriger (service_role pour éviter RLS en
  //    mode cron multi-users, et pour le UPDATE ultérieur).
  const adminClient = createAdminClient()

  // Un SIREN (9 chiffres) utilisé comme raison_sociale de fallback signifie
  // que l'enrichissement a échoué. On cible aussi 'Inconnu' (buildDegradedProspect).
  // La pattern ^\d{9}$ via ilike n'est pas dispo facilement en Supabase JS ;
  // on utilise `or` avec les deux cas connus.
  let query = adminClient
    .from('prospects')
    .select('id, siren, raison_sociale, user_id')
    .or('raison_sociale.is.null,raison_sociale.eq.Inconnu')
    .order('created_at', { ascending: false })
    .limit(limit)

  // En mode user on restreint à ses prospects uniquement.
  if (userId !== null) {
    query = query.eq('user_id', userId)
  }

  const { data: rows, error: selectError } = await query

  if (selectError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: selectError.message } },
      { status: 500 },
    )
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ data: { updated: 0, remaining: 0, total_scanned: 0 } })
  }

  const totalScanned = rows.length

  // Filtre supplémentaire : exclure les SIREN dont raison_sociale == le SIREN
  // lui-même (cas UI fallback affiche le SIREN directement).
  const toEnrich = rows.filter(
    (r) => !r.raison_sociale || r.raison_sociale === 'Inconnu' || r.raison_sociale === r.siren,
  )
  const sirens = [...new Set(toEnrich.map((r) => r.siren))]

  if (sirens.length === 0) {
    return NextResponse.json({ data: { updated: 0, remaining: 0, total_scanned: totalScanned } })
  }

  // 4. Batch Recherche Entreprises.
  const rsMap = await fetchRaisonSocialesBatch(sirens, {
    parallelism: 7,
    throttleMs: 1_100,
  })

  if (rsMap.size === 0) {
    return NextResponse.json({ data: { updated: 0, remaining: sirens.length, total_scanned: totalScanned } })
  }

  // 5. UPDATE prospects pour chaque SIREN résolu.
  //    On boucle SIREN par SIREN pour éviter un UPDATE sans WHERE (sécurité),
  //    et pour avoir un compteur précis. Pas de batch UPDATE côté Supabase JS.
  let updatedCount = 0
  for (const [siren, raisonSociale] of rsMap.entries()) {
    // En mode user on restreint strictement à son user_id.
    // En mode cron on met à jour tous les users ayant ce SIREN (plusieurs
    // consultants peuvent avoir sourcé la même entreprise).
    let updateQuery = adminClient
      .from('prospects')
      .update({ raison_sociale: raisonSociale })
      .eq('siren', siren)

    if (userId !== null) {
      updateQuery = updateQuery.eq('user_id', userId)
    }

    const { error: updateError } = await updateQuery

    if (updateError) {
      // Log l'erreur mais continue — pipeline dégradé.
      console.log(
        JSON.stringify({
          level: 'warn',
          module: 'raison-sociale-backfill',
          phase: 'update',
          siren,
          error: updateError.message,
        }),
      )
    } else {
      updatedCount++
    }
  }

  // 6. Compte combien reste encore à corriger (pour permettre au caller de
  //    boucler jusqu'à épuisement).
  let remainingQuery = adminClient
    .from('prospects')
    .select('id', { count: 'exact', head: true })
    .or('raison_sociale.is.null,raison_sociale.eq.Inconnu')

  if (userId !== null) {
    remainingQuery = remainingQuery.eq('user_id', userId)
  }

  const { count: remainingCount } = await remainingQuery

  return NextResponse.json({
    data: {
      updated: updatedCount,
      remaining: remainingCount ?? 0,
      total_scanned: totalScanned,
    },
  })
}
