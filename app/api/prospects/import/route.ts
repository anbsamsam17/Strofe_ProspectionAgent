// ============================================================
// POST /api/prospects/import — import CSV de SIREN warm (GLN-060)
//
// Le consultant a TOUJOURS une liste warm hors Glan (LinkedIn, salons,
// recommandations). Cette route accepte une liste de SIREN, valide chacun,
// enrichit via Recherche Entreprises (raison sociale, siège, dirigeant) +
// ADEME BEGES, puis upsert dans `prospects` avec `source = 'import_warm'`.
//
// Sécurité :
//   - Session Supabase obligatoire (RLS implicite côté client SSR).
//   - Validation Zod stricte du body (1..100 SIREN, note ≤ 200 char).
//   - Pas de PII passée à un service tiers — uniquement le SIREN public.
//
// Idempotence : upsert sur (user_id, siren) — un re-import met à jour
// silencieusement les champs (raison_sociale, BEGES) sans dupliquer.
//
// Performance : 100 SIREN max par batch. Recherche Entreprises ≈ 7 req/s,
// ADEME ≈ idem — un batch de 100 SIREN tient en ~30s (sous limite Vercel 300s).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { fetchRechercheEntreprisesData } from '@/lib/agent/sources/recherche-entreprises-dirigeants'
import { verifierBegesAdeme } from '@/lib/agent/sourcing'
import { calculerScore, determinerPriorite } from '@/lib/agent/scoring'
import type { Database } from '@/lib/supabase/database.types'
import type { Prospect } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Vercel function timeout — l'enrichissement de 100 SIREN tient en ~30s
// mais on prend une marge en cas de lenteur RE/ADEME.
export const maxDuration = 300

// ------------------------------------------------------------
// Constantes
// ------------------------------------------------------------

const MAX_SIRENS_PER_BATCH = 100
const MAX_NOTE_LENGTH = 200

// Parallélisme controlé pour Recherche Entreprises + ADEME (rate-limit 7 req/s).
// 5 en parallèle = ~1.4s par SIREN → 100 SIREN en ~28s.
const ENRICH_PARALLELISM = 5

// ------------------------------------------------------------
// Schéma Zod du body
// ------------------------------------------------------------

const BodySchema = z.object({
  sirens: z
    .array(z.string().trim())
    .min(1, 'Au moins 1 SIREN requis')
    .max(MAX_SIRENS_PER_BATCH, `Maximum ${MAX_SIRENS_PER_BATCH} SIREN par batch`),
  note: z
    .string()
    .trim()
    .max(MAX_NOTE_LENGTH, `Note trop longue (max ${MAX_NOTE_LENGTH} caractères)`)
    .optional(),
})

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

const SIREN_REGEX = /^\d{9}$/

interface ImportError {
  siren: string
  reason: string
}

interface EnrichmentResult {
  /** Payload prêt à l'upsert (Partial<Prospect>) si enrichissement OK. */
  prospect: Partial<Prospect> | null
  /** Raison de l'échec si null. */
  error: string | null
}

/**
 * Enrichit un SIREN unique : Recherche Entreprises (raison sociale + siège +
 * dirigeant principal) + ADEME BEGES (publication + validité).
 *
 * Toujours retourne un objet — pas de throw. En cas d'échec réseau RE, on
 * persiste quand même le prospect en mode dégradé (raison_sociale = SIREN
 * brut) pour ne pas perdre le warm import.
 */
async function enrichirSirenImport(
  siren: string,
  note: string | undefined,
  userId: string,
): Promise<EnrichmentResult> {
  // Phase 1 : Recherche Entreprises (raison sociale + siège + dirigeant).
  // Retourne null si SIREN inconnu de l'API gouv ou erreur réseau.
  const reData = await fetchRechercheEntreprisesData(siren).catch(() => null)

  // Phase 2 : ADEME BEGES (publication + dernière année). Non bloquant.
  const begesAdeme = await verifierBegesAdeme(siren).catch(() => null)

  // Validité BEGES : prive=4 ans, public=3 ans. Sans `categorieJuridique` côté RE
  // on suppose privé par défaut (warm import = entreprises commerciales typiquement).
  const currentYear = new Date().getFullYear()
  const begesValide = begesAdeme !== null
    ? begesAdeme.annee_reporting >= currentYear - 4
    : undefined

  // Construction du nom contact à partir du dirigeant principal (si dispo).
  const dirigeant = reData?.dirigeantPrincipal ?? null
  const contactNom = dirigeant ? `${dirigeant.prenoms} ${dirigeant.nom}`.trim() : undefined
  const contactPoste = dirigeant?.qualite || undefined

  // Mode dégradé : si RE n'a rien renvoyé, on stocke quand même avec raison
  // sociale = 'À renseigner' (le user verra que l'enrichissement a échoué
  // et pourra renseigner manuellement / relancer Glan).
  const raisonSociale = reData?.raisonSociale ?? `SIREN ${siren}`

  const prospect: Partial<Prospect> = {
    siren,
    raison_sociale: raisonSociale,
    user_id: userId,
    source: 'import_warm',
    statut: 'sourced',
    signaux: [],
    beges_publie: begesAdeme !== null,
    beges_derniere_publication: begesAdeme?.date_publication
      ? begesAdeme.date_publication.substring(0, 10)
      : undefined,
    beges_url: begesAdeme?.url_bilan ?? undefined,
    beges_valide: begesValide,
    // Contact issu du BEGES (ADEME) > dirigeant Recherche Entreprises.
    contact_nom: begesAdeme?.responsable_du_suivi ?? contactNom,
    contact_poste: begesAdeme?.fonction ?? contactPoste,
    contact_email: begesAdeme?.courriel ?? undefined,
    // Siège : adresse + commune + CP (Recherche Entreprises).
    adresse: reData?.siege.adresse ?? undefined,
    ville: reData?.siege.commune ?? undefined,
    code_postal: reData?.siege.codePostal ?? undefined,
    // Note d'import — préfixe « [import] » pour traçabilité côté UI.
    notes: note ? `[import] ${note}` : undefined,
    // Pas d'obligation_beges par défaut — sera recalculée par le prochain
    // run agent quand on aura la tranche d'effectifs (RE ne l'expose pas).
    obligation_beges: false,
  }

  // Scoring minimal : on calcule un score basé sur les données partielles
  // (le prochain run agent enrichira tranche/NAF et rescorera).
  const score = calculerScore(prospect, false)
  prospect.score_priorite = score
  prospect.priorite = determinerPriorite(score)

  return { prospect, error: null }
}

/**
 * Pré-valide un SIREN brut : trim, retire espaces et tirets, vérifie 9 chiffres.
 * Retourne le SIREN normalisé ou null si invalide.
 */
function normalizeSiren(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-.]/g, '')
  if (!SIREN_REGEX.test(cleaned)) return null
  return cleaned
}

/**
 * Exécute des promesses en parallèle bornées (pool de `limit` workers max).
 * Préserve l'ordre des résultats vs entrées.
 */
async function withParallelism<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) break
      results[idx] = await worker(items[idx], idx)
    }
  })
  await Promise.all(runners)
  return results
}

// ------------------------------------------------------------
// POST handler
// ------------------------------------------------------------

export async function POST(req: NextRequest) {
  // 1. Auth — RLS implicite côté client SSR.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Non authentifié' } },
      { status: 401 },
    )
  }

  // 2. Parsing JSON.
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Corps JSON invalide' } },
      { status: 400 },
    )
  }

  // 3. Validation Zod.
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_INPUT',
          message: parsed.error.message,
          details: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    )
  }

  const { sirens: rawSirens, note } = parsed.data

  // 4. Normalisation + déduplication + validation regex.
  const errors: ImportError[] = []
  const validSirens = new Set<string>()
  for (const raw of rawSirens) {
    const normalized = normalizeSiren(raw)
    if (!normalized) {
      errors.push({ siren: raw, reason: 'SIREN invalide (doit faire 9 chiffres)' })
      continue
    }
    if (validSirens.has(normalized)) {
      // Doublon silencieux dans la liste d'entrée — on ne le compte pas comme erreur.
      continue
    }
    validSirens.add(normalized)
  }

  if (validSirens.size === 0) {
    return NextResponse.json(
      {
        data: { created: 0, updated: 0, errors },
      },
      { status: 200 },
    )
  }

  // 5. Enrichissement parallèle borné (RE + ADEME).
  const sirensArray = Array.from(validSirens)
  const enrichments = await withParallelism(
    sirensArray,
    ENRICH_PARALLELISM,
    (siren) => enrichirSirenImport(siren, note, user.id),
  )

  // Sépare réussites d'erreurs (pour l'instant aucun cas error remonte —
  // l'enrichissement est best-effort et persiste en mode dégradé).
  const toUpsert: Partial<Prospect>[] = []
  enrichments.forEach((r, idx) => {
    if (r.error) {
      errors.push({ siren: sirensArray[idx], reason: r.error })
    } else if (r.prospect) {
      toUpsert.push(r.prospect)
    }
  })

  if (toUpsert.length === 0) {
    return NextResponse.json(
      {
        data: { created: 0, updated: 0, errors },
      },
      { status: 200 },
    )
  }

  // 6. Upsert sur (user_id, siren). On veut distinguer created vs updated
  // côté retour API → on lit d'abord les SIREN déjà en base pour ce user.
  const existingQuery = await supabase
    .from('prospects')
    .select('siren')
    .in('siren', toUpsert.map((p) => p.siren!).filter(Boolean))

  const existingSet = new Set<string>(
    (existingQuery.data ?? []).map((r: { siren: string | null }) => r.siren ?? '').filter(Boolean),
  )

  // Préserve les prospects déjà en `do_not_contact` (RGPD) — strip statut
  // pour ces SIREN-là afin de ne pas l'écraser par 'sourced'.
  const doNotContactQuery = await supabase
    .from('prospects')
    .select('siren')
    .eq('statut', 'do_not_contact')

  const doNotContactSet = new Set<string>(
    (doNotContactQuery.data ?? []).map((r: { siren: string | null }) => r.siren ?? '').filter(Boolean),
  )

  const cleanedToUpsert = toUpsert.map((p) => {
    if (p.siren && doNotContactSet.has(p.siren)) {
      const { statut: _s, ...rest } = p
      void _s
      return rest
    }
    return p
  })

  const { error: upsertError } = await supabase
    .from('prospects')
    .upsert(
      cleanedToUpsert as unknown as Database['public']['Tables']['prospects']['Insert'][],
      { onConflict: 'user_id,siren' },
    )

  if (upsertError) {
    console.log(
      JSON.stringify({
        level: 'error',
        route: '/api/prospects/import POST',
        msg: 'Erreur upsert prospects',
        error: upsertError.message,
        user_id: user.id,
      }),
    )
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Erreur insertion : ' + upsertError.message } },
      { status: 500 },
    )
  }

  // 7. Comptage created vs updated.
  let created = 0
  let updated = 0
  for (const p of cleanedToUpsert) {
    if (p.siren && existingSet.has(p.siren)) updated++
    else created++
  }

  return NextResponse.json(
    {
      data: {
        created,
        updated,
        errors,
        total_processed: cleanedToUpsert.length,
      },
    },
    { status: 200 },
  )
}
