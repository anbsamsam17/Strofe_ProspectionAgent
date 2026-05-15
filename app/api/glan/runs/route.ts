// ============================================================
// GET /api/glan/runs
//
// Historique paginé des runs Alpha pour la page /alpha.
// Retourne agent_runs triés par started_at DESC avec leurs logs JSONB.
//
// Query params :
//   - limit  (1-50, défaut 20)
//   - offset (>=0, défaut 0)
//
// Auth : session Supabase obligatoire (RLS filtre par user_id).
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { AgentRun } from '@/lib/types'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .pipe(z.number().int().min(1).max(50)),
  offset: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 0))
    .pipe(z.number().int().min(0)),
})

export async function GET(req: NextRequest) {
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

  const { searchParams } = new URL(req.url)
  const parsed = querySchema.safeParse({
    limit: searchParams.get('limit') ?? undefined,
    offset: searchParams.get('offset') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_INPUT',
          message: 'Paramètres limit/offset invalides',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    )
  }

  const { limit, offset } = parsed.data

  // RLS filtre implicitement par user_id (session SSR).
  const { data, count, error } = await supabase
    .from('agent_runs')
    .select('*', { count: 'exact' })
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 },
    )
  }

  return NextResponse.json(
    {
      // Cast via unknown : les types Supabase générés exposent `logs: Json`,
      // alors qu'on sait que la colonne contient toujours AgentLog[] (insertion
      // contrôlée par l'orchestrator). Pas de risque runtime.
      data: ((data ?? []) as unknown) as AgentRun[],
      count: count ?? 0,
      limit,
      offset,
    },
    { status: 200 },
  )
}
