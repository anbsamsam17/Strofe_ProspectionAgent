// ============================================================
// GET /api/agent/status
// Retourne le statut du dernier run agent + infos liste du jour.
// Auth : session Supabase obligatoire.
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

  const today = new Date().toISOString().split('T')[0] // "YYYY-MM-DD"

  // Lancer les 3 requêtes en parallèle pour réduire la latence
  const [runResult, dailyListResult, callsCountResult] = await Promise.all([
    // Dernier run de l'user (le plus récent)
    supabase
      .from('agent_runs')
      .select('*')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),

    // Liste du jour (status 'ready')
    supabase
      .from('daily_lists')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle(),

    // Nombre d'appels passés aujourd'hui (called_at non null)
    supabase
      .from('daily_list_items')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .not('called_at', 'is', null)
      // Filtre sur les items de la liste du jour via une sous-requête implicite
      // (la jointure via daily_list_id sera gérée par le filtre ci-dessous)
      .gte('created_at', `${today}T00:00:00.000Z`)
      .lte('created_at', `${today}T23:59:59.999Z`),
  ])

  // Erreurs non bloquantes — on retourne ce qu'on a
  const run = (runResult.data as AgentRun | null) ?? null
  const dailyListReady =
    dailyListResult.data?.status === 'ready' ||
    dailyListResult.data?.status === 'completed'
  const todayCallsCount = callsCountResult.count ?? 0

  return NextResponse.json(
    {
      run,
      dailyListReady,
      todayCallsCount,
    },
    { status: 200 },
  )
}
