// ============================================================
// PATCH  /api/prospects/[id]/exchanges/[exchangeId]  — édition d'un échange
// DELETE /api/prospects/[id]/exchanges/[exchangeId]  — suppression d'un échange
// Auth   : session Supabase obligatoire. RLS implicite via la session SSR.
// ------------------------------------------------------------
// Ownership : RLS + check explicite que `exchange.prospect_id === id`.
// ------------------------------------------------------------
// RGPD : la table `prospect_exchanges` sert de trace `first_contact_at`
// (Art. 14 RGPD — démonstration de la base légale d'intérêt légitime). La
// modification rétroactive de la date `occurred_at` ou la suppression d'un
// échange impacte cette preuve. TODO(GLN-rgpd): mettre en place un audit log
// (table append-only `prospect_exchanges_audit`) avant d'autoriser le contrôle
// de conformité externe. Pour l'instant, on autorise la modification (besoin
// utilisateur explicite #11) sans tracer — à durcir en post-Sprint 4.
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

const EXCHANGE_TYPES = ['appel', 'email', 'linkedin', 'rdv', 'autre'] as const

const PatchBodySchema = z
  .object({
    occurred_at: z.string().datetime({ offset: true }).optional(),
    type: z.enum(EXCHANGE_TYPES).optional(),
    result: z
      .string()
      .max(50)
      .transform((s) => s.trim())
      .transform((s) => (s.length === 0 ? null : s))
      .nullable()
      .optional(),
    notes: z
      .string()
      .max(4000)
      .transform((s) => s.trim())
      .transform((s) => (s.length === 0 ? null : s))
      .nullable()
      .optional(),
    callback_date: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .optional(),
    /**
     * Marqueur "rappel effectué" — utilisé par la vue Notifications pour
     * masquer les rappels traités. Migration 014 (notification_callback_done).
     */
    callback_done: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Aucun champ à mettre à jour',
  })

// ------------------------------------------------------------
// Helpers communs
// ------------------------------------------------------------

interface ParamsShape {
  id: string
  exchangeId: string
}

async function loadAuthAndExchange(
  request: NextRequest,
  params: Promise<ParamsShape>,
): Promise<
  | { ok: false; response: NextResponse }
  | {
      ok: true
      supabase: Awaited<ReturnType<typeof createClient>>
      userId: string
      prospectId: string
      exchangeId: string
    }
> {
  void request
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Non authentifié' } },
        { status: 401 },
      ),
    }
  }

  const { id, exchangeId } = await params
  if (!isValidUUID(id) || !isValidUUID(exchangeId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'Identifiant invalide' } },
        { status: 400 },
      ),
    }
  }

  const { data: exchange, error: exchangeError } = await supabase
    .from('prospect_exchanges')
    .select('id, prospect_id')
    .eq('id', exchangeId)
    .maybeSingle()

  if (exchangeError) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'DB_ERROR', message: exchangeError.message } },
        { status: 500 },
      ),
    }
  }
  if (!exchange || exchange.prospect_id !== id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Échange introuvable' } },
        { status: 404 },
      ),
    }
  }

  return {
    ok: true,
    supabase,
    userId: user.id,
    prospectId: id,
    exchangeId,
  }
}

// ------------------------------------------------------------
// PATCH
// ------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<ParamsShape> },
) {
  const loaded = await loadAuthAndExchange(request, params)
  if (!loaded.ok) return loaded.response

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

  const updatePayload: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) updatePayload[k] = v
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Aucun champ à mettre à jour' } },
      { status: 400 },
    )
  }

  const { data: updated, error: updateError } = await loaded.supabase
    .from('prospect_exchanges')
    .update(updatePayload)
    .eq('id', loaded.exchangeId)
    .select()
    .maybeSingle()

  if (updateError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: updateError.message } },
      { status: 500 },
    )
  }
  if (!updated) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Échange introuvable' } },
      { status: 404 },
    )
  }

  return NextResponse.json({ data: updated }, { status: 200 })
}

// ------------------------------------------------------------
// DELETE
// ------------------------------------------------------------

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<ParamsShape> },
) {
  const loaded = await loadAuthAndExchange(request, params)
  if (!loaded.ok) return loaded.response

  const { error: deleteError } = await loaded.supabase
    .from('prospect_exchanges')
    .delete()
    .eq('id', loaded.exchangeId)

  if (deleteError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: deleteError.message } },
      { status: 500 },
    )
  }

  return NextResponse.json({ data: { deleted: true } }, { status: 200 })
}
