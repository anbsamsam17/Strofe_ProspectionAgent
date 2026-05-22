// ============================================================
// PATCH  /api/notifications/dismiss
// Marque une relance (prospect_exchange) comme traitée.
// Auth   : session Supabase obligatoire. RLS implicite via session SSR.
// Body   : { exchange_id: string }
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// Validation
// ------------------------------------------------------------

const BodySchema = z.object({
  exchange_id: z.string().uuid({ message: 'exchange_id doit être un UUID valide' }),
})

// ------------------------------------------------------------
// PATCH
// ------------------------------------------------------------

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Non authentifié' } },
      { status: 401 },
    )
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Corps JSON invalide' } },
      { status: 400 },
    )
  }

  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_INPUT',
          message: parsed.error.issues[0]?.message ?? 'Paramètres invalides',
        },
      },
      { status: 400 },
    )
  }

  // RLS implicite : la session SSR garantit que seul le propriétaire peut mettre
  // à jour ses propres échanges. Si l'échange appartient à un autre user, la
  // query retourne data=[] (pas d'erreur 403 — comportement RLS attendu).
  // Cast local : migration 014 (callback_done) pas encore dans database.types.ts.
  const sb = supabase as unknown as SupabaseClient
  const { data: updated, error } = await sb
    .from('prospect_exchanges')
    .update({ callback_done: true })
    .eq('id', parsed.data.exchange_id)
    .select('id')

  if (error) {
    // Détecter spécifiquement la migration 014 manquante pour donner un message
    // actionnable à l'admin plutôt qu'un 500 générique.
    const isColumnMissing =
      error.code === '42703' ||
      (error.message ?? '').toLowerCase().includes('callback_done')
    if (isColumnMissing) {
      return NextResponse.json(
        {
          error: {
            code: 'DB_ERROR',
            message:
              'Migration 014 non appliquée — la colonne callback_done est absente. ' +
              'Appliquez supabase/migrations/014_notification_callback_done.sql sur la base de production.',
          },
        },
        { status: 500 },
      )
    }
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Erreur lors de la mise à jour' } },
      { status: 500 },
    )
  }

  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Échange introuvable' } },
      { status: 404 },
    )
  }

  // Sprint 3 retour client #18 — Invalider le cache RSC de /notifications pour
  // que router.refresh() côté client reflète immediatement la disparition de la
  // relance traitée (sans rester sur le snapshot precedent).
  revalidatePath('/notifications')

  return NextResponse.json({ data: { dismissed: true } }, { status: 200 })
}
