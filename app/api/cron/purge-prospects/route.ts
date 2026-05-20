// ============================================================
// POST /api/cron/purge-prospects (GLN-002)
//
// Cron quotidien de conformite RGPD :
//   supprime les prospects dont la derniere activite remonte a plus
//   de 3 ans, sauf ceux marques `converted` ou `on_hold` (interets
//   commerciaux actifs / dossiers en pause volontaire).
//
// Derniere activite = COALESCE(MAX(prospect_exchanges.occurred_at), created_at).
//   Cf. spec ticket : pas de colonne `last_contact_at` materialisee ;
//   on calcule a la volee pour limiter la complexite (volumes faibles,
//   purge quotidienne nocturne).
//
// CASCADE : prospect_contacts, prospect_exchanges, prospect_notes,
// daily_list_items, sont supprimes via FK ON DELETE CASCADE.
//
// Logging : compteur emis en structured JSON sur stdout (Sentry / Vercel
// logs). On n'utilise pas la table `agent_runs` car cette table requiert
// un `user_id` NOT NULL alors que la purge est globale (cross-tenants).
//
// Securite :
//   - Bearer CRON_SECRET via isCronRequest (timingSafeEqual).
//   - Service role key isolee a cette route (cf. .claude/rules/security.md).
// ============================================================

import { type NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js'

import { isCronRequest } from '@/lib/auth/cron'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Statuts a preserver : prospects converted (affaire conclue, valeur business
// persistante) et on_hold (mise en pause volontaire par l'utilisateur).
// `do_not_contact` est explicitement INCLUS dans la purge — pas de raison de
// conserver un opt-out plus de 3 ans apres la derniere activite.
const STATUTS_NON_PURGEABLES = ['converted', 'on_hold'] as const

// Periode de retention. 3 ans = duree CNIL maximale recommandee pour la
// prospection B2B (intéret legitime).
const RETENTION_YEARS = 3
const THREE_YEARS_MS = RETENTION_YEARS * 365 * 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  // 1. Auth cron (timing-safe)
  if (!isCronRequest(req)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Cron secret invalide' } },
      { status: 401 },
    )
  }

  // 2. Config Supabase service role
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Supabase env manquantes' } },
      { status: 500 },
    )
  }

  const supabase = createSupabaseAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const cutoffIso = new Date(Date.now() - THREE_YEARS_MS).toISOString()
  const phase = 'purge_rgpd'

  // 3. Identifier les prospects a supprimer.
  //    Strategie : on charge en deux passes pour eviter une dependance a une
  //    SQL function (RPC). Tres peu de prospects > 3 ans en pratique, donc OK.
  //
  // 3.a — Prospects "froids" : created_at < cutoff ET statut hors preservation.
  //       On filtre ensuite en memoire par derniere occurrence d'exchange.
  const { data: candidats, error: selectErr } = await supabase
    .from('prospects')
    .select('id, created_at')
    .lt('created_at', cutoffIso)
    .not('statut', 'in', `(${STATUTS_NON_PURGEABLES.join(',')})`)

  if (selectErr) {
    console.error(
      JSON.stringify({
        level: 'error',
        module: 'purge-prospects',
        phase,
        msg: 'Erreur selection candidats',
        error: selectErr.message,
      }),
    )
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Selection echec' } },
      { status: 500 },
    )
  }

  if (!candidats || candidats.length === 0) {
    console.log(
      JSON.stringify({
        level: 'info',
        module: 'purge-prospects',
        phase,
        msg: 'Aucun candidat',
        deleted: 0,
        cutoffIso,
      }),
    )
    return NextResponse.json({ data: { deleted: 0 } }, { status: 200 })
  }

  // 3.b — Pour les candidats, recuperer le MAX(occurred_at) dans prospect_exchanges.
  //       Si max_occurred_at est posterieur au cutoff, le prospect est encore "tiede" :
  //       on ne le supprime pas.
  const candidatIds = candidats.map((c) => c.id)
  const { data: exchanges, error: exchangesErr } = await supabase
    .from('prospect_exchanges')
    .select('prospect_id, occurred_at')
    .in('prospect_id', candidatIds)
    .gte('occurred_at', cutoffIso)

  if (exchangesErr) {
    console.error(
      JSON.stringify({
        level: 'error',
        module: 'purge-prospects',
        phase,
        msg: 'Erreur selection exchanges',
        error: exchangesErr.message,
      }),
    )
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Selection exchanges echec' } },
      { status: 500 },
    )
  }

  // Ensemble des prospect_id avec au moins un exchange recent (> cutoff) → a preserver.
  const prospectsPreserves = new Set<string>(
    (exchanges ?? []).map((e) => e.prospect_id),
  )

  const idsAPurger = candidatIds.filter((id) => !prospectsPreserves.has(id))

  if (idsAPurger.length === 0) {
    console.log(
      JSON.stringify({
        level: 'info',
        module: 'purge-prospects',
        phase,
        msg: 'Tous les candidats ont un echange recent',
        candidats: candidats.length,
        deleted: 0,
        cutoffIso,
      }),
    )
    return NextResponse.json({ data: { deleted: 0 } }, { status: 200 })
  }

  // 4. Supprimer en batch (FK CASCADE supprime les rows liees automatiquement).
  const { error: deleteErr } = await supabase
    .from('prospects')
    .delete()
    .in('id', idsAPurger)

  if (deleteErr) {
    console.error(
      JSON.stringify({
        level: 'error',
        module: 'purge-prospects',
        phase,
        msg: 'Erreur suppression',
        error: deleteErr.message,
        attempted_count: idsAPurger.length,
      }),
    )
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Suppression echec' } },
      { status: 500 },
    )
  }

  console.log(
    JSON.stringify({
      level: 'info',
      module: 'purge-prospects',
      phase,
      msg: 'Purge RGPD effectuee',
      deleted: idsAPurger.length,
      candidats: candidats.length,
      preserves_par_exchange_recent: prospectsPreserves.size,
      cutoffIso,
      retention_years: RETENTION_YEARS,
    }),
  )

  return NextResponse.json(
    { data: { deleted: idsAPurger.length, cutoffIso } },
    { status: 200 },
  )
}
