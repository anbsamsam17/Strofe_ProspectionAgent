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
  // GLN — Sprint 3 V3 retour client #10 : statut "à contacter" (migration 028).
  // Décision humaine d'amorce, entre 'qualified' et 'contacted'. Sans cette valeur
  // le PATCH renvoie 400 alors que la colonne accepte la valeur côté DB.
  'to_contact',
  'contacted',
  'interested',
  'rdv',
  'offer_sent',
  'converted',
  'rejected',
  'on_hold',
  // GLN — Sprint 3 retour client #6 : statut opt-out explicite (migration 017).
  // Sans cette valeur, le PATCH renvoie 400 VALIDATION_ERROR alors que la colonne
  // accepte la valeur côté DB.
  'do_not_contact',
]

// ------------------------------------------------------------
// Schéma de validation PATCH (tous les champs sont optionnels)
// ------------------------------------------------------------

// Statuts considérés comme "terminaux" pour la suppression :
// converti / rdv pris / intéressé — supprimer ces lignes ferait perdre du contexte
// commercial, on les protège (sauf si l'utilisateur a explicitement archivé).
const PROTECTED_STATUTS: ProspectStatus[] = ['interested', 'rdv', 'converted']

// Limites notes : 4000 char ≈ 1 page A4 — largement suffisant pour des notes CRM,
// borne la taille pour éviter les abus / payload géants.
const NOTES_MAX_LENGTH = 4000

// Helper Zod : `''` est traité comme "effacer la valeur" → null en DB.
// Permet à l'UI d'envoyer un input vide pour supprimer un champ optionnel.
const nullableString = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.trim())
    .transform((s) => (s.length === 0 ? null : s))
    .nullable()
    .optional()

const PatchBodySchema = z.object({
  // Identité entreprise (correction manuelle)
  raison_sociale: z.string().min(1).max(255).trim().optional(),
  secteur_naf: nullableString(20),
  secteur_libelle: nullableString(255),

  // Infos de contact
  contact_nom: nullableString(100),
  contact_prenom: nullableString(100),
  contact_poste: nullableString(200),
  contact_telephone: z
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
  contact_email: z
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
  contact_linkedin: z
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

  // Statut pipeline
  statut: z.enum(PROSPECT_STATUTS).optional(),

  // Localisation (correction possible)
  ville: nullableString(100),
  code_postal: nullableString(10),
  adresse: nullableString(500),

  // Données BEGES (correction manuelle possible)
  beges_publie: z.boolean().optional(),
  beges_valide: z.boolean().optional(),
  beges_derniere_publication: nullableString(20),
  obligation_beges: z.boolean().optional(),

  // CRM — actions axe principal /prospects
  /** true → archive (archived_at = now()), false → désarchive (archived_at = null). */
  archived: z.boolean().optional(),
  /** Notes libres ; null pour effacer, string (vide ok) pour remplacer. */
  notes: z.string().max(NOTES_MAX_LENGTH).nullable().optional(),

  // ── GLN-041 — Deal value + probability (forecast pipeline pondéré) ──────
  /**
   * Valeur estimée du deal en EUR. NUMERIC(10,2) DB → plafond app 99 999 999.99
   * (= 99 M€). `null` pour effacer la valeur.
   */
  deal_value: z
    .number()
    .min(0)
    .max(99_999_999.99)
    .nullable()
    .optional(),
  /**
   * Probabilité de cloture 0-100 (smallint DB). `null` pour repasser sur
   * la valeur par défaut du statut côté UI.
   */
  deal_probability: z
    .number()
    .int()
    .min(0)
    .max(100)
    .nullable()
    .optional(),
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

  // Transformer `archived: bool` (DX côté UI) → `archived_at: timestamp | null` (colonne DB).
  // On extrait `archived` du payload Zod et on injecte `archived_at` dans la maj DB.
  const { archived, ...rest } = parsed.data
  const updatePayload: Record<string, unknown> = { ...rest }
  if (archived !== undefined) {
    updatePayload.archived_at = archived ? new Date().toISOString() : null
  }

  const { data: updatedProspect, error: updateError } = await supabase
    .from('prospects')
    .update(updatePayload)
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

  // Récupérer statut + archived_at pour appliquer la règle métier de suppression.
  const { data: existing } = await supabase
    .from('prospects')
    .select('id, statut, archived_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!existing) {
    return NextResponse.json(
      { error: 'Prospect introuvable', code: 'NOT_FOUND' },
      { status: 404 },
    )
  }

  // Règle métier : un prospect avec un statut "à valeur commerciale"
  // (interested / rdv / converted) ne peut être hard-delete que s'il est
  // d'abord archivé — pour éviter les pertes accidentelles de pipeline.
  const isProtected = PROTECTED_STATUTS.includes(existing.statut as ProspectStatus)
  if (isProtected && existing.archived_at === null) {
    return NextResponse.json(
      {
        error:
          'Ce prospect ne peut pas être supprimé directement (statut protégé). Archivez-le d’abord.',
        code: 'DELETE_FORBIDDEN',
      },
      { status: 409 },
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

  return NextResponse.json({ data: { deleted: true } }, { status: 200 })
}
