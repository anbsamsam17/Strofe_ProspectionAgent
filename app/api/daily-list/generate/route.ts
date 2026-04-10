// ============================================================
// POST /api/daily-list/generate
// Génère (ou régénère) la liste quotidienne pour l'utilisateur connecté.
// Sélectionne les TOP N prospects par score, enrichit leurs contacts,
// génère les pitchs GPT-4o et insère les daily_list_items.
//
// Auth : session Supabase obligatoire.
// Idempotent : relancer 2x ne crée pas de doublons
//   (les items non appelés sont supprimés avant réinsertion).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { generateDailyList } from '@/lib/agent/daily-list-generator'

// Vercel — la génération peut prendre plusieurs minutes (pitchs GPT-4o)
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// VALIDATION DU BODY
// ------------------------------------------------------------

const GenerateBodySchema = z.object({
  targetCount: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(15),
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
  let body: z.infer<typeof GenerateBodySchema> = { targetCount: 15 }

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

    const parsed = GenerateBodySchema.safeParse(raw)
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

  // -- 3. Client admin (bypass RLS pour les opérations d'écriture) --
  const supabaseAdmin = createAdminClient()

  // -- 4. Lancement de la génération --
  let result: Awaited<ReturnType<typeof generateDailyList>>
  try {
    result = await generateDailyList(user.id, supabaseAdmin, {
      targetCount: body.targetCount,
    })
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'error',
        module: 'api/daily-list/generate',
        msg: 'generateDailyList a échoué',
        user_id: user.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return NextResponse.json(
      {
        error: 'Échec de la génération de la liste',
        code: 'GENERATE_FAILED',
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
      dailyListId: result.dailyListId,
      itemsAdded: result.itemsAdded,
      itemsReplaced: result.itemsReplaced,
      duration_ms: result.duration_ms,
    },
    { status: 200 },
  )
}
