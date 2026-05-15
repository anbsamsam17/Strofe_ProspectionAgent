// ============================================================
// GET /api/agent/status
// Retourne le statut du dernier run agent.
// Auth : session Supabase obligatoire.
//
// Pivot 2026-05-15 : daily_lists et daily_list_items ont été supprimés.
// dailyListReady est hardcodé false, todayCallsCount hardcodé 0.
// L'historique des appels est désormais dans prospect_exchanges.
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { AgentRun } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  // -- Auth --
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json(
      { error: 'Non authentifié', code: 'UNAUTHORIZED' },
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

  return NextResponse.json(
    {
      run,
      // Post-pivot : daily_lists supprimée — valeurs statiques conservées
      // pour compatibilité descendante avec les consommateurs existants.
      dailyListReady: false,
      todayCallsCount: 0,
    },
    { status: 200 },
  )
}
