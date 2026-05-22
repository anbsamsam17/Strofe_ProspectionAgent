// ============================================================
// PATCH  /api/prospects/[id]/contacts/[contactId]  — édition d'un contact
// DELETE /api/prospects/[id]/contacts/[contactId]  — suppression d'un contact
// Auth   : session Supabase obligatoire. RLS implicite via la session SSR.
// ------------------------------------------------------------
// Ownership : la session SSR + les policies RLS (auth.uid()=user_id) filtrent
// implicitement. On vérifie EN PLUS que `contact.prospect_id === id` pour
// éviter qu'un utilisateur n'édite un contact appartenant à un autre prospect
// (cas pathologique mais on borne le scope explicitement).
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

const PatchBodySchema = z
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
    is_primary: z.boolean().optional(),
  })
  // Au moins un champ doit être fourni pour qu'on update quelque chose.
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Aucun champ à mettre à jour',
  })

// ------------------------------------------------------------
// Helpers communs
// ------------------------------------------------------------

interface ParamsShape {
  id: string
  contactId: string
}

async function loadAuthAndContact(
  request: NextRequest,
  params: Promise<ParamsShape>,
): Promise<
  | { ok: false; response: NextResponse }
  | {
      ok: true
      supabase: Awaited<ReturnType<typeof createClient>>
      userId: string
      prospectId: string
      contactId: string
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

  const { id, contactId } = await params
  if (!isValidUUID(id) || !isValidUUID(contactId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'Identifiant invalide' } },
        { status: 400 },
      ),
    }
  }

  // Ownership check : RLS filtre déjà mais on vérifie aussi le rattachement
  // contact ↔ prospect (un utilisateur ne peut pas éditer un contact d'un
  // autre de ses propres prospects via cette route).
  const { data: contact, error: contactError } = await supabase
    .from('prospect_contacts')
    .select('id, prospect_id')
    .eq('id', contactId)
    .maybeSingle()

  if (contactError) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'DB_ERROR', message: contactError.message } },
        { status: 500 },
      ),
    }
  }
  if (!contact || contact.prospect_id !== id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Contact introuvable' } },
        { status: 404 },
      ),
    }
  }

  return {
    ok: true,
    supabase,
    userId: user.id,
    prospectId: id,
    contactId,
  }
}

// ------------------------------------------------------------
// PATCH
// ------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<ParamsShape> },
) {
  const loaded = await loadAuthAndContact(request, params)
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

  // On normalise les champs optionnels présents en null si la valeur trim est vide.
  // Les champs absents du body ne sont PAS écrits (Zod .optional()).
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
    .from('prospect_contacts')
    .update(updatePayload)
    .eq('id', loaded.contactId)
    .select()
    .maybeSingle()

  if (updateError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: updateError.message } },
      { status: 500 },
    )
  }
  if (!updated) {
    // Cas théorique : RLS aurait filtré entre le SELECT et l'UPDATE
    // (race condition très improbable).
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Contact introuvable' } },
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
  const loaded = await loadAuthAndContact(request, params)
  if (!loaded.ok) return loaded.response

  const { error: deleteError } = await loaded.supabase
    .from('prospect_contacts')
    .delete()
    .eq('id', loaded.contactId)

  if (deleteError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: deleteError.message } },
      { status: 500 },
    )
  }

  return NextResponse.json({ data: { deleted: true } }, { status: 200 })
}
