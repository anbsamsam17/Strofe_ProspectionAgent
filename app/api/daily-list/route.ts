// ============================================================
// GET /api/daily-list?date=YYYY-MM-DD
// Récupère la daily list du jour (ou d'une date précise).
// Auth : session Supabase obligatoire.
//
// Comportement :
//   - Retourne la liste avec ses items et les prospects joints
//   - Si aucune liste n'existe pour la date → déclenche la génération
//     en arrière-plan via after() (Next.js 15 — survit à la réponse HTTP)
// ============================================================

import { NextRequest, NextResponse, after } from 'next/server'
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

  // Constante unique pour éviter toute incohérence si le handler s'exécute à minuit
  const now = new Date()
  const today = now.toISOString().split('T')[0]

  const targetDate = parsed.data.date ?? today

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
    if (targetDate === today) {
      const supabaseAdmin = await createAdminClient()

      // after() de Next.js 15 : le callback s'exécute APRÈS que la réponse HTTP
      // est envoyée au client mais AVANT que la fonction serverless soit détruite.
      // Contrairement au fire-and-forget nu, Vercel garantit l'exécution complète.
      after(async () => {
        try {
          await runAgentNocturne(user.id, supabaseAdmin)
        } catch (err) {
          console.log(
            JSON.stringify({
              level: 'error',
              module: 'daily-list',
              msg: 'Background agent run failed',
              error: err instanceof Error ? err.message : String(err),
            }),
          )
        }
      })
    }

    // Retourner une réponse vide mais structurée — le frontend peut afficher
    // un état "liste en cours de génération"
    return NextResponse.json(
      {
        list: null,
        generating: targetDate === today,
        message:
          targetDate === today
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

// ------------------------------------------------------------
// Handler DELETE — Réinitialiser les appels non effectués
// Supprime tous les daily_list_items avec called_at IS NULL pour
// la daily list du jour de l'utilisateur authentifié.
// Les items déjà appelés (called_at IS NOT NULL) sont conservés.
// Les prospects de la table `prospects` ne sont PAS touchés.
// ------------------------------------------------------------

export async function DELETE(_request: NextRequest) {
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

  const today = new Date().toISOString().split('T')[0]

  // Trouver la daily list du jour
  const { data: dailyList, error: listError } = await supabase
    .from('daily_lists')
    .select('id')
    .eq('user_id', user.id)
    .eq('date', today)
    .maybeSingle()

  if (listError) {
    console.log(
      JSON.stringify({
        level: 'error',
        route: 'DELETE /api/daily-list',
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

  // Aucune liste pour aujourd'hui — rien à supprimer
  if (!dailyList) {
    return NextResponse.json({ deleted: 0 }, { status: 200 })
  }

  // Supprimer uniquement les items non appelés (called_at IS NULL)
  const { data: deleted, error: deleteError } = await supabase
    .from('daily_list_items')
    .delete()
    .eq('daily_list_id', dailyList.id)
    .is('called_at', null)
    .select('id')

  if (deleteError) {
    console.log(
      JSON.stringify({
        level: 'error',
        route: 'DELETE /api/daily-list',
        msg: 'Erreur suppression daily_list_items',
        error: deleteError.message,
        user_id: user.id,
        daily_list_id: dailyList.id,
      }),
    )
    return NextResponse.json(
      { error: 'Erreur suppression', code: 'DB_ERROR' },
      { status: 500 },
    )
  }

  const deletedCount = deleted?.length ?? 0

  console.log(
    JSON.stringify({
      level: 'info',
      route: 'DELETE /api/daily-list',
      msg: `${deletedCount} items non appelés supprimés`,
      user_id: user.id,
      daily_list_id: dailyList.id,
      deleted_count: deletedCount,
    }),
  )

  return NextResponse.json({ deleted: deletedCount }, { status: 200 })
}
