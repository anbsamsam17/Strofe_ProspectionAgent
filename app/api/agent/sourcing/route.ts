// ============================================================
// POST /api/agent/sourcing
// Déclenchement d'un run de sourcing pur avec paramètres custom.
// Cherche de nouvelles entreprises et les ajoute dans `prospects`.
//
// Auth         : session Supabase obligatoire (pas de mode cron ici).
// Anti-concurrent : refuse 409 si un run status='running' existe.
// Body         : effectifMin?, effectifMax?, targetSectors?[], targetRegion?
//                Voir .claude/context/sourcing-param-mapping.md
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { runSourcing } from '@/lib/agent/sourcing-runner'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

// Vercel — le sourcing peut prendre plusieurs minutes (INSEE + ADEME)
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// VALIDATION DU BODY
// ------------------------------------------------------------
//
// Le mapping UI → paramètres API est documenté dans
// .claude/context/sourcing-param-mapping.md (Wave 1.2).
//
// - effectifMin/Max : entiers >= 0, bornes 0..100_000.
//   Refine cross-field : effectifMin <= effectifMax.
// - targetSectors   : codes NAF format `NN.NNX` (ex. "30.30Z"), uppercase.
//                     Doublons supprimés en aval (cf. mapping spec §4.4).
// - targetRegion    : label libre 1..30 caractères (code dept 2-3 chiffres,
//                     ou label comme "Gironde", "Nouvelle-Aquitaine", "France").
//                     La résolution se fait côté `resolveGeoFilter` (Wave 2.1).
//
// `.strict()` : refuse silencieusement tout champ inconnu pour éviter
//               une fuite vers `runSourcing` (defense in depth).
const NAF_CODE_REGEX = /^\d{2}\.\d{2}[A-Z]$/
const TARGET_REGION_REGEX = /^[\p{L}\d\s'\-]{1,30}$/u
// 21 sections officielles NAF rev. 2 INSEE (lettres A-U).
// Cf. lib/agent/naf-labels.ts → NAF_SECTIONS.
const NAF_SECTION_VALUES = [
  'A','B','C','D','E','F','G','H','I','J','K',
  'L','M','N','O','P','Q','R','S','T','U',
] as const

const SourcingBodySchema = z
  .object({
    effectifMin: z.number().int().min(0).max(100_000).optional(),
    effectifMax: z.number().int().min(0).max(100_000).optional(),
    targetSectors: z
      .array(z.string().trim().toUpperCase().regex(NAF_CODE_REGEX, 'Code NAF invalide (attendu : NN.NNX)'))
      .max(100, 'Trop de codes NAF (max 100)')
      .optional(),
    targetRegion: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .regex(TARGET_REGION_REGEX, 'targetRegion contient des caractères non autorisés')
      .optional(),
    /**
     * Filtre par section NAF (lettres A-U). Vide ou absent = toutes sections.
     * Multi-sélection. Filtrage post-fetch côté runner via `sectionFromNaf`.
     */
    sections: z.array(z.enum(NAF_SECTION_VALUES)).max(21).optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.effectifMin === undefined ||
      data.effectifMax === undefined ||
      data.effectifMin <= data.effectifMax,
    {
      message: 'effectifMin doit être <= effectifMax',
      path: ['effectifMin'],
    },
  )

// ------------------------------------------------------------
// HANDLER POST
// ------------------------------------------------------------

export async function POST(request: NextRequest) {
  // -- 1. Auth via session Supabase (AVANT parse body, pas de leak) --
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

  // -- 2. Parsing + validation du body (optionnel : body vide = tous défauts) --
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
          details: parsed.error.flatten(),
        },
        { status: 400 },
      )
    }
    body = parsed.data
  }

  // -- 3. Anti-concurrence : un seul run actif (sourcing ou complet) par user --
  //
  // Note : on utilise le client admin (service_role) car `runSourcing` insère
  // dans `agent_runs` via le même client. Le filter manuel `.eq('user_id', ...)`
  // est ici INDISPENSABLE et non-redondant : service_role bypasse RLS, donc
  // sans ce filter on inspecterait les runs de tous les users.
  // Cf. .claude/rules/security.md §RLS pour le contexte.
  const supabaseAdmin = createAdminClient()

  // -- Rate-limit (anti-abus INSEE/ADEME + quotas en aval) : sourcing pur --
  // Plus léger qu'un run complet mais reste coûteux (pagination INSEE + ADEME).
  // 20 sourcings / heure couvrent un usage intensif légitime (réglages multiples).
  // Placé APRÈS l'auth, AVANT le travail coûteux. Fail-open si DB limiteur KO.
  const sourcingRl = await checkRateLimit(supabaseAdmin, user.id, 'agent_sourcing', {
    limit: 20,
    windowSec: 3600,
  })
  if (!sourcingRl.allowed) {
    return rateLimitResponse(sourcingRl)
  }

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
  //
  // Les champs sont passés explicitement (pas de spread) pour figer le contrat
  // de transmission vers `runSourcing` et faciliter l'audit.
  let result: Awaited<ReturnType<typeof runSourcing>>
  try {
    result = await runSourcing(user.id, supabaseAdmin, {
      effectifMin: body.effectifMin,
      effectifMax: body.effectifMax,
      targetSectors: body.targetSectors,
      targetRegion: body.targetRegion,
      sections: body.sections,
    })
  } catch (err) {
    // Log structuré sans PII (pas de body brut, juste user_id)
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
        // Détail technique uniquement en dev — pas de leak schéma en prod
        ...(process.env.NODE_ENV === 'development' && {
          details: err instanceof Error ? err.message : String(err),
        }),
      },
      { status: 500 },
    )
  }

  // Wave 3 (F-IMP-01 + F-IMP-04) — La modal `sourcing-modal.tsx:81-104` lit
  // en plus `prospectsQualified`, `totalAvailable`, `exhausted`, `pagesLoaded`.
  // On les expose ici. `duration_ms` est conservé (legacy) + `durationMs` ajouté
  // (format Task 2.3 que la modal tolère aussi via `parseRunResponse`).
  //
  // `universeEmpty` (Contrat D du fix sourcing-france) : distingue côté UI
  // « 0 résultat car univers vide » vs « curseur consommé » (exhausted).
  return NextResponse.json(
    {
      success: true,
      runId: result.runId,
      prospectsNew: result.prospectsNew,
      prospectsUpdated: result.prospectsUpdated,
      prospectsSourced: result.prospectsSourced,
      prospectsQualified: result.prospectsQualified,
      totalAvailable: result.totalAvailable,
      pagesLoaded: result.pagesLoaded,
      exhausted: result.exhausted,
      universeEmpty: result.universeEmpty,
      curseurFinal: result.curseurFinal,
      usedFallback: result.usedFallback,
      duration_ms: result.duration_ms,
      durationMs: result.duration_ms,
    },
    { status: 200 },
  )
}
