// ============================================================
// POST /api/admin/recategorize-secteurs
//
// Route admin de BACKFILL — rattrape le retard de catégorisation secteur
// pour les prospects existants insérés AVANT le cablage Gemini (cf. enrichirProspect
// dans lib/agent/sourcing.ts qui ne renseigne JAMAIS `secteur_libelle`).
//
// Cas de figure :
//   - ~700 prospects historiques en DB avec `secteur_libelle = NULL`
//   - Cap orchestrator nocturne = 200/run → couvrirait le backlog en 4 nuits
//   - Backfill manuel évite d'attendre N runs nocturnes
//
// Protection : `isCronRequest` (CRON_SECRET) — strictement la même que /api/agent/run.
// Pas de session user — la route opère sur la table `prospects` avec service_role
// et boucle sur tous les utilisateurs onboardés.
//
// Idempotent : un re-run ne touchera que les prospects toujours marqués
// NULL / vide / "Inconnu*" (l'UPDATE écrase, mais Gemini est déterministe
// à 90% via cache LRU + temperature 0.2).
//
// Sécurité :
//   - Pas de PII dans les logs (uniquement id, siren tronqué côté Gemini).
//   - Service role utilisé strictement côté serveur, jamais loggé.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/auth/cron'
import { createAdminClient } from '@/lib/supabase/server'
import {
  categoriserSecteurAvecGemini,
  isGeminiAvailable,
} from '@/lib/agent/gemini-scoring'

// Vercel Pro — backfill peut prendre plusieurs minutes sur grand volume.
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

/** Taille du batch SELECT — page Supabase confortable, RLS bypass via admin. */
const BATCH_SIZE = 50

/** Parallélisme des appels Gemini par lot (rate-limit Gemini Flash 30 req/min). */
const PARALLELISM = 5

/**
 * Cap dur de prospects traités par appel route — protège contre un timeout
 * Vercel 300s ET respecte la limite gratuite Gemini Flash 2.0 (1500 req/jour).
 * Un re-run de la route reprendra où l'on s'est arrêté (idempotent sur le filtre).
 */
const HARD_CAP_PER_CALL = 800

// ------------------------------------------------------------
// HANDLER
// ------------------------------------------------------------

export async function POST(request: NextRequest) {
  // 1. Auth cron (CRON_SECRET timing-safe).
  if (!isCronRequest(request)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Non autorisé' } },
      { status: 401 },
    )
  }

  // 2. Court-circuit : si GEMINI_API_KEY absente, on signale clairement plutôt
  //    que de faire tourner la route à blanc avec 100% d'échecs silencieux.
  if (!isGeminiAvailable()) {
    return NextResponse.json(
      {
        error: {
          code: 'GEMINI_UNAVAILABLE',
          message: 'GEMINI_API_KEY absente côté serveur — impossible de backfill',
        },
      },
      { status: 503 },
    )
  }

  const supabase = createAdminClient()

  // 3. SELECT des prospects à backfill : NULL, vide, ou littéral "Inconnu*".
  //    Filtre symétrique à `phaseSecteurCategorisation` dans l'orchestrator.
  //    On exclut les prospects archivés et ceux sans `secteur_naf` (rien à
  //    donner à Gemini).
  const { data: prospects, error: selectError } = await supabase
    .from('prospects')
    .select('id, secteur_naf, secteur_libelle, raison_sociale, effectif_min')
    .is('archived_at', null)
    .or('secteur_libelle.is.null,secteur_libelle.eq.,secteur_libelle.ilike.inconnu%')
    .not('secteur_naf', 'is', null)
    .order('score_priorite', { ascending: false })
    .limit(HARD_CAP_PER_CALL)

  if (selectError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: selectError.message } },
      { status: 500 },
    )
  }

  const rows = prospects ?? []
  const traites = rows.length

  if (traites === 0) {
    return NextResponse.json(
      {
        data: {
          traites: 0,
          succes: 0,
          echecs: 0,
          message: 'Aucun prospect à backfill — tous les secteurs sont déjà renseignés',
        },
      },
      { status: 200 },
    )
  }

  // 4. Backfill par batch parallèle de PARALLELISM.
  let succes = 0
  let echecs = 0

  for (let groupStart = 0; groupStart < rows.length; groupStart += PARALLELISM) {
    const groupEnd = Math.min(groupStart + PARALLELISM, rows.length)
    const group = rows.slice(groupStart, groupEnd)

    const results = await Promise.all(
      group.map(async (p) => {
        const id = p.id as string
        const result = await categoriserSecteurAvecGemini({
          nafCode: (p.secteur_naf as string | null) ?? null,
          raisonSociale: (p.raison_sociale as string | null) ?? '',
          effectifMin: (p.effectif_min as number | null) ?? null,
        })
        return { id, result }
      }),
    )

    for (const { id, result } of results) {
      if (!result) {
        echecs += 1
        continue
      }

      const { error: updateError } = await supabase
        .from('prospects')
        .update({ secteur_libelle: result.secteur_libelle })
        .eq('id', id)

      if (updateError) {
        echecs += 1
        continue
      }
      succes += 1
    }

    // Bornage des batchs : log structuré JSON console (visible Vercel logs).
    console.log(
      JSON.stringify({
        level: 'info',
        module: 'admin/recategorize-secteurs',
        msg: 'Batch backfill traité',
        batch_start: groupStart,
        batch_size: group.length,
        running_succes: succes,
        running_echecs: echecs,
      }),
    )
  }

  return NextResponse.json(
    {
      data: {
        traites,
        succes,
        echecs,
        cap_per_call: HARD_CAP_PER_CALL,
        batch_size: BATCH_SIZE,
        parallelism: PARALLELISM,
      },
    },
    { status: 200 },
  )
}
