// ============================================================
// DELETE /api/blacklist-domains/[id]
//
// Supprime une entrée de la blacklist. RLS garantit que l'utilisateur
// ne peut supprimer QUE ses propres entrées (auth.uid() = user_id).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const UuidSchema = z.string().uuid()

export async function DELETE(
  _req: NextRequest,
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
  const parsed = UuidSchema.safeParse(id)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'ID invalide (UUID attendu)' } },
      { status: 400 },
    )
  }

  // Retypage local : `domain_blacklist` ajoutée par mig. 021.
  const { error, count } = await (
    supabase.from('domain_blacklist' as 'profiles') as unknown as {
      delete: (opts: { count: 'exact' }) => {
        eq: (col: string, val: string) => Promise<{
          error: { message: string } | null
          count: number | null
        }>
      }
    }
  )
    .delete({ count: 'exact' })
    .eq('id', parsed.data)

  if (error) {
    console.log(
      JSON.stringify({
        level: 'error',
        route: '/api/blacklist-domains/[id] DELETE',
        msg: 'Erreur suppression blacklist',
        error: error.message,
        user_id: user.id,
      }),
    )
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Erreur suppression' } },
      { status: 500 },
    )
  }

  if (count === 0) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Entrée introuvable' } },
      { status: 404 },
    )
  }

  return NextResponse.json({ data: { deleted: count ?? 0 } }, { status: 200 })
}
