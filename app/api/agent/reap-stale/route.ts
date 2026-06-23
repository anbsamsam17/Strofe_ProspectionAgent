// ============================================================
// POST /api/agent/reap-stale
// Marque `failed` toute row agent_runs status='running' dont le
// `started_at` dépasse le seuil de staleness.
//
// Contexte : Vercel tue les fonctions à maxDuration=300s. Quand
// l'orchestrateur n'a pas le temps d'écrire `status='failed'` avant
// le SIGKILL, la row reste 'running' indéfiniment et bloque les
// runs suivants via le check anti-concurrent (409) de /api/agent/sourcing.
//
// Sécurité :
// - Bearer CRON_SECRET timing-safe (lib/auth/cron.ts).
// - Service role : bypass RLS pour scanner TOUS les users.
// - Aucun PII loggé.
//
// Idempotent : un run déjà passé à 'completed' ou 'failed' n'est pas réaffecté.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isCronRequest } from '@/lib/auth/cron'

export const dynamic = 'force-dynamic'

// Au-delà de 15 min, un run 'running' est considéré orphelin (Vercel
// timeout est à 5 min — large marge pour le pire cas réseau + retries).
const STALE_THRESHOLD_MINUTES = 15

export async function POST(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Cron secret invalide' } },
      { status: 401 },
    )
  }

  const supabaseAdmin = createAdminClient()
  const thresholdIso = new Date(
    Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000,
  ).toISOString()

  // Sélection des runs orphelins. On lit avant d'écrire pour pouvoir loguer.
  const { data: stale, error: selectErr } = await supabaseAdmin
    .from('agent_runs')
    .select('id, user_id, phase, started_at')
    .eq('status', 'running')
    .lt('started_at', thresholdIso)

  if (selectErr) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: selectErr.message } },
      { status: 500 },
    )
  }

  if (!stale || stale.length === 0) {
    return NextResponse.json(
      { data: { reaped: 0, threshold_minutes: STALE_THRESHOLD_MINUTES } },
      { status: 200 },
    )
  }

  // Update atomique conditionnel : `eq('status', 'running')` évite l'aliasing
  // si un run a transitionné vers completed entre le SELECT et l'UPDATE.
  const staleIds = stale.map((r) => r.id)
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('agent_runs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message:
        'Vercel runtime timeout — auto-reaped (>15 min en running sans heartbeat de complétion)',
    })
    .in('id', staleIds)
    .eq('status', 'running')
    .select('id, user_id')

  if (updateErr) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: updateErr.message } },
      { status: 500 },
    )
  }

  console.log(
    JSON.stringify({
      level: 'warn',
      module: 'api/agent/reap-stale',
      msg: 'Runs orphelins marqués failed',
      reaped: updated?.length ?? 0,
      threshold_minutes: STALE_THRESHOLD_MINUTES,
      run_ids: staleIds,
    }),
  )

  return NextResponse.json(
    {
      data: {
        reaped: updated?.length ?? 0,
        threshold_minutes: STALE_THRESHOLD_MINUTES,
        run_ids: staleIds,
      },
    },
    { status: 200 },
  )
}

// ------------------------------------------------------------
// Handler GET — Vercel Cron
// ------------------------------------------------------------
//
// Vercel Cron invoque cette route en GET avec Authorization: Bearer
// {CRON_SECRET}. POST ne lit aucun corps de requête (auth via header
// uniquement) — la délégation est donc parfaitement sûre et l'auth
// CRON_SECRET (isCronRequest) reste appliquée sur le chemin GET.
export async function GET(request: NextRequest) {
  return POST(request)
}
