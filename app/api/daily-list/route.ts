// ============================================================
// GET /api/daily-list?date=YYYY-MM-DD
// Récupère la daily list du jour (ou d'une date précise).
// Auth : session Supabase obligatoire.
//
// Comportement :
//   - Retourne la liste avec ses items et les prospects joints
//   - Si aucune liste n'existe pour la date → déclenche la génération
//     en arrière-plan via waitUntil (si disponible dans le runtime)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { runAgentNocturne } from '@/lib/agent/orchestrator'
import type { DailyList, DailyListItem, Prospect } from '@/lib/types'

export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// Validation query params
// ------------------------------------------------------------

const QuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format date invalide — attendu YYYY-MM-DD')
    .optional(),
})

// ------------------------------------------------------------
// Type de réponse
// ------------------------------------------------------------

type DailyListWithItems = DailyList & {
  items: (DailyListItem & { prospect: Prospect })[]
}

// ------------------------------------------------------------
// Handler GET
// ------------------------------------------------------------

export async function GET(request: NextRequest) {
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

  // -- Validation query params --
  const { searchParams } = new URL(request.url)
  const parsed = QuerySchema.safeParse({ date: searchParams.get('date') ?? undefined })

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

  const targetDate = parsed.data.date ?? new Date().toISOString().split('T')[0]

  // -- Récupérer la liste du jour avec items + prospects --
  const { data: listData, error: listError } = await supabase
    .from('daily_lists')
    .select(
      `
      *,
      items:daily_list_items (
        *,
        prospect:prospects (*)
      )
    `,
    )
    .eq('user_id', user.id)
    .eq('date', targetDate)
    .order('ordre', { referencedTable: 'daily_list_items', ascending: true })
    .maybeSingle()

  if (listError) {
    console.log(
      JSON.stringify({
        level: 'error',
        route: '/api/daily-list',
        msg: 'Erreur récupération daily_list',
        error: listError.message,
        user_id: user.id,
      }),
    )
    return NextResponse.json(
      { error: 'Erreur base de données', code: 'DB_ERROR' },
      { status: 500 },
    )
  }

  // -- Aucune liste pour cette date → déclencher la génération --
  if (!listData) {
    // Déclencher uniquement pour la date d'aujourd'hui (pas de régénération du passé)
    const today = new Date().toISOString().split('T')[0]

    if (targetDate === today) {
      // Utiliser waitUntil si disponible (Vercel Edge Runtime)
      // pour ne pas bloquer la réponse HTTP
      const supabaseAdmin = await createAdminClient()

      // @ts-expect-error — waitUntil n'est pas typé dans Next.js 15 mais disponible
      // sur Vercel via `after()` ou via le contexte de la requête
      if (typeof globalThis.waitUntil === 'function') {
        // @ts-expect-error
        globalThis.waitUntil(runAgentNocturne(user.id, supabaseAdmin))
      } else {
        // Fallback : lancement sans attendre (fire-and-forget)
        // Le garbage collector ne tuera pas la Promise grâce à Vercel serverless
        runAgentNocturne(user.id, supabaseAdmin).catch((err) => {
          console.log(
            JSON.stringify({
              level: 'error',
              route: '/api/daily-list',
              msg: 'Génération background échouée',
              error: err instanceof Error ? err.message : String(err),
            }),
          )
        })
      }
    }

    // Retourner une réponse vide mais structurée — le frontend peut afficher
    // un état "liste en cours de génération"
    return NextResponse.json(
      {
        list: null,
        generating: targetDate === new Date().toISOString().split('T')[0],
        message:
          targetDate === new Date().toISOString().split('T')[0]
            ? 'Liste en cours de génération'
            : 'Aucune liste pour cette date',
      },
      { status: 200 },
    )
  }

  // -- Mapper la réponse DB vers le type DailyListWithItems --
  const list: DailyListWithItems = {
    id: listData.id as string,
    user_id: listData.user_id as string,
    date: listData.date as string,
    status: listData.status as DailyList['status'],
    generated_at: listData.generated_at as string | undefined,
    notified_at: (listData.notified_at as string | null) ?? undefined,
    created_at: listData.created_at as string,
    updated_at: listData.updated_at as string,
    items: ((listData.items as unknown as DailyListItem[]) ?? []).map((item) => ({
      ...item,
      prospect: item.prospect as unknown as Prospect,
    })),
  }

  return NextResponse.json({ list }, { status: 200 })
}
