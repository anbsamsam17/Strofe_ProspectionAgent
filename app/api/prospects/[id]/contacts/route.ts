// ============================================================
// GET    /api/prospects/[id]/contacts  — liste des contacts d'un prospect
// POST   /api/prospects/[id]/contacts  — crée un contact additionnel
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

// Helper Zod : trim + transforme `''` en `null`.
const nullableString = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.trim())
    .transform((s) => (s.length === 0 ? null : s))
    .nullable()
    .optional()

const PostBodySchema = z
  .object({
    nom: nullableString(100),
    prenom: nullableString(100),
    poste: nullableString(200),
    telephone: z
      .string()
      .max(20)
      .transform((s) => s.trim())
      .refine(
        (s) => s.length === 0 || /^[\d\s+\-().]+$/.test(s),
        'Numéro de téléphone invalide',
      )
      .transform((s) => (s.length === 0 ? null : s))
      .nullable()
      .optional(),
    email: z
      .string()
      .max(254)
      .transform((s) => s.trim())
      .refine(
        (s) => s.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
        'Email invalide',
      )
      .transform((s) => (s.length === 0 ? null : s))
      .nullable()
      .optional(),
    linkedin: z
      .string()
      .max(500)
      .transform((s) => s.trim())
      .refine(
        (s) => s.length === 0 || /^https?:\/\/.+/i.test(s),
        'URL LinkedIn invalide',
      )
      .transform((s) => (s.length === 0 ? null : s))
      .nullable()
      .optional(),
    source: nullableString(50),
    is_primary: z.boolean().optional(),
  })
  // Au moins un champ identifiant doit être renseigné — sinon, on insère un contact vide.
  .refine(
    (data) =>
      Boolean(
        data.nom ||
          data.prenom ||
          data.poste ||
          data.telephone ||
          data.email ||
          data.linkedin,
      ),
    {
      message: 'Au moins un champ (nom, prénom, poste, téléphone, email, LinkedIn) doit être renseigné.',
    },
  )

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
    .from('prospect_contacts')
    .select('*')
    .eq('prospect_id', id)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

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

  // Vérification d'ownership via RLS implicite — le prospect doit exister
  // pour cet utilisateur, sinon `.maybeSingle()` retourne null.
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

  // user_id requis par la table (RLS WITH CHECK auth.uid()=user_id).
  const insertPayload = {
    user_id: user.id,
    prospect_id: id,
    nom: parsed.data.nom ?? null,
    prenom: parsed.data.prenom ?? null,
    poste: parsed.data.poste ?? null,
    telephone: parsed.data.telephone ?? null,
    email: parsed.data.email ?? null,
    linkedin: parsed.data.linkedin ?? null,
    source: parsed.data.source ?? 'manual',
    is_primary: parsed.data.is_primary ?? false,
  }

  const { data: inserted, error: insertError } = await supabase
    .from('prospect_contacts')
    .insert(insertPayload)
    .select()
    .single()

  if (insertError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: insertError.message } },
      { status: 500 },
    )
  }

  return NextResponse.json({ data: inserted }, { status: 201 })
}
