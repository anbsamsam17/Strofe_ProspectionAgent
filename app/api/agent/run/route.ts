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
import { runSourcing } from '@/lib/agent/sourcing-runner'
import type { AgentRun } from '@/lib/types'
import { isCronRequest } from '@/lib/auth/cron'

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

/** Construit la réponse stats normalisée à partir d'un AgentRun. */
function buildRunStats(run: AgentRun) {
  return {
    sourced: run.prospects_sourced,
    qualified: run.prospects_qualified,
    listGenerated: run.list_generated,
  }
}

/** Construit la réponse stats normalisée à partir d'un résultat runSourcing. */
function buildSourcingStats(result: { prospectsNew: number; prospectsUpdated: number }) {
  return {
    prospectsNew: result.prospectsNew,
    prospectsUpdated: result.prospectsUpdated,
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
    const supabaseAdmin = createAdminClient()

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

    // Lancer le pipeline NOCTURNE COMPLET en parallèle pour chaque user.
    // runAgentNocturne enchaîne : sourcing INSEE + enrichissement ADEME (BEGES)
    // + scoring composite + contact enrichment (Pappers/Hunter) + Gemini scoring
    // (raisons commerciales). Sans cet appel, le cron ne déclenche QUE le sourcing
    // (runSourcing) — donc Gemini ne tourne jamais en automatique.
    //
    // ⚠️ Durée : ~3-5 min par user vs ~30s pour runSourcing seul. maxDuration
    // côté Vercel est à 300s — OK pour Hobby/Pro plan.
    const adminClients = userIds.map(() => createAdminClient())

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
          stats: {
            prospectsSourced: run.prospects_sourced,
            prospectsQualified: run.prospects_qualified,
            phase: run.phase,
          },
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
  const supabaseAdmin = createAdminClient()

  // -- Vérification anti-concurrence : un seul run actif à la fois par user --
  // Deux runs simultanés peuvent créer une condition de course sur l'upsert
  // de `prospects`. On retourne 409 si un run est déjà en cours.
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

  // MODE MANUEL : appelle runAgentNocturne() — sourcing + enrichissement +
  // scoring + upsert prospects. Pas de daily list générée.
  // Pour un sourcing pur avec paramètres : POST /api/agent/sourcing
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
