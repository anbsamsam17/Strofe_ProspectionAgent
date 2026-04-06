// ============================================================
// POST /api/agent/run
// Déclenchement du run agent — cron nocturne Vercel (22h) ou manuel.
//
// Double protection :
//   1. Header Authorization: Bearer {CRON_SECRET} → run pour TOUS les users actifs
//   2. Session Supabase valide → run pour cet user uniquement
//   3. Sinon → 401
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { runAgentNocturne } from '@/lib/agent/orchestrator'
import type { AgentRun } from '@/lib/types'

// TODO: Remplacer par import { isCronRequest } from '@/lib/auth/cron'
//       une fois que lib/auth/cron.ts est créé par l'agent dédié.
//       Laisser la copie locale en attendant pour éviter une erreur de compilation.
import { timingSafeEqual } from 'crypto'

// Vercel Pro — le run nocturne peut prendre plusieurs minutes
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// Validation du body (optionnel)
// ------------------------------------------------------------

const RunBodySchema = z.object({
  userId: z.string().uuid().optional(),
})

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/** Vérifie que le header Authorization correspond au secret cron configuré.
 *  Copie locale de lib/auth/cron.ts#isCronRequest — à remplacer par l'import
 *  dès que ce module est disponible.
 */
function isCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false

  const authHeader = request.headers.get('authorization') ?? ''
  const provided = authHeader.replace('Bearer ', '').trim()

  // Padding à longueur fixe pour éviter le leak de longueur via timing
  const expectedBuf = Buffer.from(cronSecret.padEnd(128, '\0'))
  const providedBuf = Buffer.from(provided.padEnd(128, '\0'))

  return timingSafeEqual(expectedBuf, providedBuf) && provided.length === cronSecret.length
}

/** Construit la réponse stats normalisée à partir d'un AgentRun. */
function buildRunStats(run: AgentRun) {
  return {
    sourced: run.prospects_sourced,
    qualified: run.prospects_qualified,
    listGenerated: run.list_generated,
  }
}

// ------------------------------------------------------------
// Handler POST
// ------------------------------------------------------------

export async function POST(request: NextRequest) {
  // -- 1. Parsing + validation du body --
  let body: z.infer<typeof RunBodySchema> = {}

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

    const parsed = RunBodySchema.safeParse(raw)
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

  // -- 2. Authentification double --

  const cronMode = isCronRequest(request)

  if (cronMode) {
    // --------------------------------------------------------
    // MODE CRON : run pour tous les users onboardés
    // --------------------------------------------------------
    const supabaseAdmin = await createAdminClient()

    // Récupérer tous les utilisateurs ayant complété l'onboarding
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('onboarded', true)

    if (profilesError) {
      return NextResponse.json(
        { error: 'Impossible de récupérer les utilisateurs', code: 'DB_ERROR' },
        { status: 500 },
      )
    }

    const userIds: string[] = (profiles ?? []).map(
      (p: { id: string }) => p.id,
    )

    if (userIds.length === 0) {
      return NextResponse.json(
        { success: true, message: 'Aucun utilisateur onboardé', runs: [] },
        { status: 200 },
      )
    }

    // Lancer les runs en parallèle — chaque run reçoit son propre client admin
    // pour éviter la contention sur le pool de connexions d'une instance partagée.
    // createAdminClient() est async, on résout tous les clients d'abord puis on
    // lance les runs afin que les Promise.allSettled ne se mélangent pas.
    const adminClients = await Promise.all(userIds.map(() => createAdminClient()))

    const results = await Promise.allSettled(
      userIds.map((userId, index) =>
        runAgentNocturne(userId, adminClients[index]),
      ),
    )

    const runs = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        const run = result.value
        return {
          userId: userIds[index],
          runId: run.id,
          status: run.status,
          stats: buildRunStats(run),
        }
      }
      // Ne jamais logger le userId brut en cas d'erreur (PII)
      return {
        userId: userIds[index],
        runId: null,
        status: 'failed',
        stats: null,
      }
    })

    const successCount = runs.filter((r) => r.status === 'completed').length

    return NextResponse.json(
      {
        success: true,
        mode: 'cron',
        totalUsers: userIds.length,
        successCount,
        runs,
      },
      { status: 200 },
    )
  }

  // --------------------------------------------------------
  // MODE MANUEL : user authentifié via session Supabase
  // --------------------------------------------------------
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

  // Si un userId explicite est fourni dans le body, il doit correspondre
  // au user connecté (pas d'usurpation d'identité possible)
  if (body.userId && body.userId !== user.id) {
    return NextResponse.json(
      { error: 'Accès interdit', code: 'FORBIDDEN' },
      { status: 403 },
    )
  }

  const targetUserId = user.id

  // Utiliser le client admin pour l'orchestrateur (bypass RLS — le run crée
  // des enregistrements pour l'user sans passer par les policies user)
  const supabaseAdmin = await createAdminClient()

  // -- Vérification anti-concurrence : un seul run actif à la fois par user --
  // Deux runs simultanés peuvent créer une condition de course sur daily_list_items
  // (DELETE + INSERT concurrent). On retourne 409 si un run est déjà en cours.
  const { data: existingRun } = await supabaseAdmin
    .from('agent_runs')
    .select('id')
    .eq('user_id', targetUserId)
    .eq('status', 'running')
    .maybeSingle()

  if (existingRun) {
    return NextResponse.json(
      {
        error: 'Un run est déjà en cours',
        code: 'RUN_IN_PROGRESS',
        runId: existingRun.id,
      },
      { status: 409 },
    )
  }

  let run: AgentRun
  try {
    run = await runAgentNocturne(targetUserId, supabaseAdmin)
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Échec du run agent',
        code: 'AGENT_RUN_FAILED',
        // Ne pas exposer le message d'erreur interne en production
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
      mode: 'manual',
      runId: run.id,
      status: run.status,
      stats: buildRunStats(run),
    },
    { status: 200 },
  )
}
