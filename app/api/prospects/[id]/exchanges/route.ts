// ============================================================
// GET    /api/prospects/[id]/exchanges  — liste des échanges manuels
// POST   /api/prospects/[id]/exchanges  — crée un échange (appel/email/...)
// Auth   : session Supabase obligatoire. RLS implicite via la session SSR.
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

const PostBodySchema = z.object({
  // ISO 8601 datetime — défaut côté client = now.
  occurred_at: z
    .string()
    .datetime({ offset: true })
    .optional(),
  type: z.enum(EXCHANGE_TYPES),
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
})

// ------------------------------------------------------------
// GET
// ------------------------------------------------------------

export async function GET(
  _request: NextRequest,
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

  // RLS implicite — la session SSR filtre déjà par user_id.
  const { data, error } = await supabase
    .from('prospect_exchanges')
    .select('*')
    .eq('prospect_id', id)
    .order('occurred_at', { ascending: false })

  if (error) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 },
    )
  }

  return NextResponse.json({ data: data ?? [] }, { status: 200 })
}

// ------------------------------------------------------------
// POST
// ------------------------------------------------------------

export async function POST(
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

  // Vérification ownership via RLS implicite.
  const { data: prospect, error: prospectError } = await supabase
    .from('prospects')
    .select('id')
    .eq('id', id)
    .maybeSingle()

  if (prospectError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: prospectError.message } },
      { status: 500 },
    )
  }
  if (!prospect) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Prospect introuvable' } },
      { status: 404 },
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

  const parsed = PostBodySchema.safeParse(raw)
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

  const insertPayload = {
    user_id: user.id,
    prospect_id: id,
    occurred_at: parsed.data.occurred_at ?? new Date().toISOString(),
    type: parsed.data.type,
    result: parsed.data.result ?? null,
    notes: parsed.data.notes ?? null,
    callback_date: parsed.data.callback_date ?? null,
  }

  const { data: inserted, error: insertError } = await supabase
    .from('prospect_exchanges')
    .insert(insertPayload)
    .select()
    .single()

  if (insertError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: insertError.message } },
      { status: 500 },
    )
  }

  // Sprint 3 retour client #9 — Auto-promotion vers 'contacted' au 1er échange
  // réel (appel/email/linkedin). Garde-fou strict : on NE régresse JAMAIS un
  // statut avancé (interested/rdv/offer_sent/converted/rejected/on_hold/
  // do_not_contact restent intouchés). Best-effort : si la lecture du statut
  // ou l'update échoue, on log mais on ne casse pas la réponse 201.
  const PROMOTABLE_FROM: ReadonlyArray<string> = [
    'sourced',
    'qualified',
    'to_contact',
  ]
  const PROMOTABLE_TYPES: ReadonlyArray<string> = [
    'appel',
    'email',
    'linkedin',
  ]
  if (PROMOTABLE_TYPES.includes(parsed.data.type)) {
    const { data: currentProspect, error: readErr } = await supabase
      .from('prospects')
      .select('statut')
      .eq('id', id)
      .maybeSingle()
    if (!readErr && currentProspect && PROMOTABLE_FROM.includes(currentProspect.statut)) {
      const { error: promoteErr } = await supabase
        .from('prospects')
        .update({ statut: 'contacted' })
        .eq('id', id)
      if (promoteErr) {
        console.error(
          JSON.stringify({
            module: 'exchanges-post',
            level: 'warn',
            msg: 'auto-promotion contacted failed (non-blocking)',
            prospect_id: id,
            error: promoteErr.message,
          }),
        )
      }
    }
  }

  return NextResponse.json({ data: inserted }, { status: 201 })
}
