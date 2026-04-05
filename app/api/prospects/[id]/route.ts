// ============================================================
// GET    /api/prospects/[id]  — fiche complète d'un prospect
// PATCH  /api/prospects/[id]  — mise à jour partielle
// DELETE /api/prospects/[id]  — suppression (ownership vérifié)
// Auth : session Supabase obligatoire.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { ProspectStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// Constantes
// ------------------------------------------------------------

const PROSPECT_STATUTS: [ProspectStatus, ...ProspectStatus[]] = [
  'sourced',
  'qualified',
  'contacted',
  'interested',
  'rdv',
  'converted',
  'rejected',
  'on_hold',
]

// ------------------------------------------------------------
// Schéma de validation PATCH (tous les champs sont optionnels)
// ------------------------------------------------------------

const PatchBodySchema = z.object({
  // Infos de contact
  contact_nom: z.string().max(100).trim().optional(),
  contact_prenom: z.string().max(100).trim().optional(),
  contact_poste: z.string().max(200).trim().optional(),
  contact_telephone: z
    .string()
    .max(20)
    .regex(/^[\d\s\+\-\(\)\.]+$/, 'Numéro de téléphone invalide')
    .optional(),
  contact_email: z.string().email('Email invalide').max(254).optional(),
  contact_linkedin: z.string().url('URL LinkedIn invalide').max(500).optional(),

  // Statut pipeline
  statut: z.enum(PROSPECT_STATUTS).optional(),

  // Localisation (correction possible)
  ville: z.string().max(100).trim().optional(),
  code_postal: z.string().max(10).optional(),
  adresse: z.string().max(500).trim().optional(),

  // Données BEGES (correction manuelle possible)
  beges_publie: z.boolean().optional(),
  obligation_beges: z.boolean().optional(),
})

// ------------------------------------------------------------
// Helper : validation UUID
// ------------------------------------------------------------

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
}

// ------------------------------------------------------------
// GET handler
// ------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params

  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: 'Identifiant invalide', code: 'INVALID_ID' },
      { status: 400 },
    )
  }

  // Le RLS s'assure que l'user ne peut voir que ses prospects
  const { data: prospect, error: queryError } = await supabase
    .from('prospects')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (queryError) {
    console.log(
      JSON.stringify({
        level: 'error',
        route: '/api/prospects/[id] GET',
        msg: 'Erreur récupération prospect',
        error: queryError.message,
        prospect_id: id,
      }),
    )
    return NextResponse.json(
      { error: 'Erreur base de données', code: 'DB_ERROR' },
      { status: 500 },
    )
  }

  if (!prospect) {
    return NextResponse.json(
      { error: 'Prospect introuvable', code: 'NOT_FOUND' },
      { status: 404 },
    )
  }

  return NextResponse.json({ prospect }, { status: 200 })
}

// ------------------------------------------------------------
// PATCH handler
// ------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params

  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: 'Identifiant invalide', code: 'INVALID_ID' },
      { status: 400 },
    )
  }

  // -- Parsing + validation du body --
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Corps JSON invalide', code: 'INVALID_JSON' },
      { status: 400 },
    )
  }

  const parsed = PatchBodySchema.safeParse(raw)
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

  // Refuser un body vide (aucun champ à mettre à jour)
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json(
      { error: 'Aucun champ à mettre à jour', code: 'EMPTY_UPDATE' },
      { status: 400 },
    )
  }

  const { data: updatedProspect, error: updateError } = await supabase
    .from('prospects')
    .update(parsed.data)
    .eq('id', id)
    .eq('user_id', user.id) // ownership garanti
    .select()
    .maybeSingle()

  if (updateError) {
    console.log(
      JSON.stringify({
        level: 'error',
        route: '/api/prospects/[id] PATCH',
        msg: 'Erreur mise à jour prospect',
        error: updateError.message,
        prospect_id: id,
      }),
    )
    return NextResponse.json(
      { error: 'Erreur mise à jour', code: 'UPDATE_FAILED' },
      { status: 500 },
    )
  }

  if (!updatedProspect) {
    // Le RLS a filtré → soit l'id n'existe pas, soit il n'appartient pas à l'user
    return NextResponse.json(
      { error: 'Prospect introuvable', code: 'NOT_FOUND' },
      { status: 404 },
    )
  }

  return NextResponse.json({ prospect: updatedProspect }, { status: 200 })
}

// ------------------------------------------------------------
// DELETE handler
// ------------------------------------------------------------

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params

  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: 'Identifiant invalide', code: 'INVALID_ID' },
      { status: 400 },
    )
  }

  // Vérifier l'existence avant suppression pour retourner un 404 propre
  const { data: existing } = await supabase
    .from('prospects')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!existing) {
    return NextResponse.json(
      { error: 'Prospect introuvable', code: 'NOT_FOUND' },
      { status: 404 },
    )
  }

  const { error: deleteError } = await supabase
    .from('prospects')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (deleteError) {
    console.log(
      JSON.stringify({
        level: 'error',
        route: '/api/prospects/[id] DELETE',
        msg: 'Erreur suppression prospect',
        error: deleteError.message,
        prospect_id: id,
      }),
    )
    return NextResponse.json(
      { error: 'Erreur suppression', code: 'DELETE_FAILED' },
      { status: 500 },
    )
  }

  // 204 No Content — suppression réussie
  return new NextResponse(null, { status: 204 })
}
