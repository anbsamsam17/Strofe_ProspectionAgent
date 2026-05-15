// ============================================================
// GET /api/glan/status
//
// Statut enrichi de l'agent Alpha — utilisé par GlanStatusBar
// (composant Client polling toutes les 5s) et par /alpha pour
// l'historique live.
//
// Diffère de /api/agent/status (existant) par :
//   - Inclut la phase courante (sourcing / enrichissement / scoring / pitch_gen)
//   - Inclut phase_started_at (pour calculer l'ETA de la phase courante)
//   - Inclut les compteurs sourced/qualified live
//   - Inclut un statut sémantique "glanState" (dormant/working/done/error)
//
// Auth : session Supabase obligatoire (RLS filtre par user_id).
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { AgentRun } from '@/lib/types'

export const dynamic = 'force-dynamic'

export type GlanState = 'dormant' | 'working' | 'done' | 'error'

interface GlanStatusResponse {
  run: AgentRun | null
  /** Phase courante du run (ex. "sourcing", "enrichissement", "scoring", "pitch_gen"). */
  phase: string | null
  /** Horodatage du début de la phase courante (déduit du dernier log de cette phase). */
  phaseStartedAt: string | null
  /** État sémantique de Glan pour pilotage UI. */
  glanState: GlanState
  /** True si la liste du jour est prête (status `ready` ou `completed`). */
  dailyListReady: boolean
  /** Nombre d'appels passés aujourd'hui (call_result renseigné). */
  todayCallsCount: number
}

/**
 * Déduit l'état sémantique de Glan à partir du dernier run.
 *
 * Post-pivot 2026-05-15 : daily_lists supprimée. L'état "done" est dérivé
 * directement de run.status === 'completed' avec une fenêtre glissante de 12h
 * depuis la fin du run (au-delà, on revient à 'dormant' pour la prochaine nuit).
 */
function deriveGlanState(run: AgentRun | null): GlanState {
  if (!run) return 'dormant'
  if (run.status === 'running') return 'working'
  if (run.status === 'failed') return 'error'
  // completed — done si le run s'est terminé il y a moins de 12h
  if (run.completed_at) {
    const completedMs = Date.parse(run.completed_at)
    const twelveHoursMs = 12 * 60 * 60 * 1000
    if (Date.now() - completedMs < twelveHoursMs) return 'done'
  }
  return 'dormant'
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Non authentifié' } },
      { status: 401 },
    )
  }

  // Dernier run de l'user (le plus récent)
  const runResult = await supabase
    .from('agent_runs')
    .select('*')
    .eq('user_id', user.id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const run = (runResult.data as AgentRun | null) ?? null

  // Phase courante : on lit la phase explicite sur agent_runs si présente,
  // sinon on déduit du dernier log.
  const phase = run?.phase ?? (run?.logs?.[run.logs.length - 1]?.phase ?? null)

  // phaseStartedAt : on cherche le premier log de la phase courante.
  let phaseStartedAt: string | null = null
  if (run && phase && Array.isArray(run.logs)) {
    const firstLogOfPhase = run.logs.find((log) => log.phase === phase)
    phaseStartedAt = firstLogOfPhase?.timestamp ?? null
  }

  const glanState = deriveGlanState(run)

  const response: GlanStatusResponse = {
    run,
    phase,
    phaseStartedAt,
    glanState,
    // Post-pivot : daily_lists supprimée — valeurs statiques conservées
    // pour compatibilité descendante avec les consommateurs existants.
    dailyListReady: false,
    todayCallsCount: 0,
  }

  return NextResponse.json({ data: response }, { status: 200 })
}
