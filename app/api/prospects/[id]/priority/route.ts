// ============================================================
// PATCH /api/prospects/[id]/priority — met à jour la priorité manuelle
// Auth  : session Supabase obligatoire. RLS implicite via la session SSR.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// Validation
// ------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidUUID(id: string): boolean {
  return UUID_RE.test(id)
}

// Migration 009 : CHECK (priorite IN ('haute', 'moyenne', 'basse')).
const PRIORITES = ['haute', 'moyenne', 'basse'] as const

const PatchBodySchema = z.object({
  priorite: z.enum(PRIORITES),
})

// ------------------------------------------------------------
// PATCH
// ------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params
  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Identifiant invalide' } },
      { status: 400 },
    )
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Corps JSON invalide' } },
      { status: 400 },
    )
  }

  const parsed = PatchBodySchema.safeParse(raw)
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

  // RLS implicite — l'update ne traversera que les prospects de l'user.
  // `priorite` est typée `string` dans database.types.ts (migration 009) ;
  // la valeur est déjà restreinte par le z.enum(PRIORITES) ci-dessus, donc
  // l'update est typé sans cast.
  const { data: updated, error: updateError } = await supabase
    .from('prospects')
    .update({ priorite: parsed.data.priorite })
    .eq('id', id)
    .select('id, priorite')
    .maybeSingle()

  if (updateError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: updateError.message } },
      { status: 500 },
    )
  }

  if (!updated) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Prospect introuvable' } },
      { status: 404 },
    )
  }

  return NextResponse.json({ data: updated }, { status: 200 })
}
