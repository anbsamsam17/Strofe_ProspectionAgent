// ============================================================
// POST /api/agent/sourcing
// Déclenchement d'un run de sourcing pur avec paramètres.
// Cherche de nouvelles entreprises et les ajoute dans `prospects`.
// NE GÉNÈRE PAS la daily list.
//
// Auth : session Supabase obligatoire.
// Protection anti-concurrent : refuse si un run status='running' existe.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { runSourcing } from '@/lib/agent/sourcing-runner'

// Vercel — le sourcing peut prendre plusieurs minutes (INSEE + ADEME)
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// VALIDATION DU BODY
// ------------------------------------------------------------

const SourcingBodySchema = z.object({
  effectifMax: z.number().int().positive().optional(),
  effectifMin: z.number().int().positive().optional(),
  targetSectors: z
    .array(z.string().trim().min(1))
    .optional(),
  targetRegion: z.string().trim().min(1).optional(),
})

// ------------------------------------------------------------
// HANDLER POST
// ------------------------------------------------------------

export async function POST(request: NextRequest) {
  // -- 1. Auth via session Supabase --
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

  // -- 2. Parsing + validation du body --
  let body: z.infer<typeof SourcingBodySchema> = {}

  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Corps JSON invalide', code: 'INVALID_JSON' },
        { status: 400 },
      )
    }

    const parsed = SourcingBodySchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Paramètres invalides',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      )
    }
    body = parsed.data
  }

  // -- 3. Protection anti-concurrent --
  // Un seul run actif (sourcing ou complet) par utilisateur à la fois.
  const supabaseAdmin = createAdminClient()

  const { data: existingRun } = await supabaseAdmin
    .from('agent_runs')
    .select('id, phase')
    .eq('user_id', user.id)
    .eq('status', 'running')
    .maybeSingle()

  if (existingRun) {
    return NextResponse.json(
      {
        error: 'Un run est déjà en cours',
        code: 'RUN_IN_PROGRESS',
        runId: existingRun.id,
        phase: existingRun.phase,
      },
      { status: 409 },
    )
  }

  // -- 4. Lancement du sourcing --
  let result: Awaited<ReturnType<typeof runSourcing>>
  try {
    result = await runSourcing(user.id, supabaseAdmin, {
      effectifMax:    body.effectifMax,
      effectifMin:    body.effectifMin,
      targetSectors:  body.targetSectors,
      targetRegion:   body.targetRegion,
    })
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'error',
        module: 'api/agent/sourcing',
        msg: 'runSourcing a échoué',
        user_id: user.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return NextResponse.json(
      {
        error: 'Échec du sourcing',
        code: 'SOURCING_FAILED',
        ...(process.env.NODE_ENV === 'development' && {
          details: err instanceof Error ? err.message : String(err),
        }),
      },
      { status: 500 },
    )
  }

  return NextResponse.json(
    {
      success: true,
      runId: result.runId,
      prospectsNew: result.prospectsNew,
      prospectsUpdated: result.prospectsUpdated,
      duration_ms: result.duration_ms,
    },
    { status: 200 },
  )
}
