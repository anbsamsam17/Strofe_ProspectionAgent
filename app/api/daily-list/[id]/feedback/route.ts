// ============================================================
// PATCH /api/daily-list/[id]/feedback
// Soumettre le résultat d'un appel téléphonique.
// Auth : session Supabase + vérification ownership de l'item.
//
// Met à jour :
//   - daily_list_items.call_result, called_at, callback_date, call_notes
//   - prospects.statut selon le résultat de l'appel
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { CallResult, ProspectStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// Validation UUID (BUG-06 — regex stricte RFC 4122)
// La version précédente /^[0-9a-f-]{36}$/ acceptait des UUIDs invalides
// (ex: "----------------------------------" passait la validation).
// La regex ci-dessous valide le format exact : variante 1-5 + variant bits [89ab].
// ------------------------------------------------------------

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ------------------------------------------------------------
// Validation du body (Zod strict)
// ------------------------------------------------------------

const FeedbackBodySchema = z
  .object({
    call_result: z.enum([
      'interested',
      'callback',
      'not_interested',
      'wrong_contact',
      'no_answer',
      'voicemail',
    ]),
    callback_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format date invalide — attendu YYYY-MM-DD')
      .optional(),
    call_notes: z.string().max(2000, 'Notes limitées à 2000 caractères').optional(),
  })
  .refine(
    (data) => {
      // callback_date est obligatoire si call_result = 'callback'
      if (data.call_result === 'callback' && !data.callback_date) return false
      return true
    },
    {
      message: 'callback_date est obligatoire quand call_result = callback',
      path: ['callback_date'],
    },
  )

// ------------------------------------------------------------
// Mapping call_result → statut prospect
// ------------------------------------------------------------

const CALL_RESULT_TO_STATUS: Record<CallResult, ProspectStatus | null> = {
  interested: 'interested',
  callback: 'contacted',
  not_interested: 'rejected',
  wrong_contact: null, // statut inchangé
  no_answer: 'contacted',
  voicemail: 'contacted',
}

// ------------------------------------------------------------
// Handler PATCH
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

  // -- Résolution du paramètre dynamique --
  const { id: itemId } = await params

  if (!itemId || !UUID_REGEX.test(itemId)) {
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

  const parsed = FeedbackBodySchema.safeParse(raw)
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

  const { call_result, callback_date, call_notes } = parsed.data

  // -- Vérification ownership + récupération prospect_id --
  // Le RLS garantit déjà que l'user ne peut accéder qu'à ses propres items,
  // mais on vérifie explicitement pour retourner un 404 propre plutôt qu'un 403 implicite.
  const { data: existingItem, error: itemError } = await supabase
    .from('daily_list_items')
    .select('id, user_id, prospect_id, call_result')
    .eq('id', itemId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (itemError) {
    console.log(
      JSON.stringify({
        level: 'error',
        route: '/api/daily-list/[id]/feedback',
        msg: 'Erreur récupération daily_list_item',
        error: itemError.message,
      }),
    )
    return NextResponse.json(
      { error: 'Erreur base de données', code: 'DB_ERROR' },
      { status: 500 },
    )
  }

  if (!existingItem) {
    return NextResponse.json(
      { error: 'Item introuvable', code: 'NOT_FOUND' },
      { status: 404 },
    )
  }

  const nowIso = new Date().toISOString()

  // -- Mise à jour de daily_list_items --
  const { data: updatedItem, error: updateItemError } = await supabase
    .from('daily_list_items')
    .update({
      call_result,
      called_at: nowIso,
      callback_date: callback_date ?? null,
      call_notes: call_notes ?? null,
    })
    .eq('id', itemId)
    .eq('user_id', user.id) // double sécurité
    .select()
    .single()

  if (updateItemError) {
    console.log(
      JSON.stringify({
        level: 'error',
        route: '/api/daily-list/[id]/feedback',
        msg: 'Erreur mise à jour daily_list_item',
        error: updateItemError.message,
        item_id: itemId,
      }),
    )
    return NextResponse.json(
      { error: 'Erreur mise à jour', code: 'UPDATE_FAILED' },
      { status: 500 },
    )
  }

  // -- Mise à jour du statut prospect (si applicable) --
  const newProspectStatus = CALL_RESULT_TO_STATUS[call_result as CallResult]

  if (newProspectStatus !== null && existingItem.prospect_id) {
    const prospectUpdate: Record<string, unknown> = {
      statut: newProspectStatus,
    }

    // Ajouter la date de rappel sur le prospect si callback
    if (call_result === 'callback' && callback_date) {
      // Le schéma prospect ne contient pas de callback_date directement —
      // on ne met à jour que le statut (la date est sur l'item)
    }

    const { error: prospectError } = await supabase
      .from('prospects')
      .update(prospectUpdate)
      .eq('id', existingItem.prospect_id)
      .eq('user_id', user.id)

    if (prospectError) {
      // Non-fatal : l'item est mis à jour, mais le statut prospect n'a pas changé
      console.log(
        JSON.stringify({
          level: 'warn',
          route: '/api/daily-list/[id]/feedback',
          msg: 'Erreur mise à jour statut prospect',
          error: prospectError.message,
          prospect_id: existingItem.prospect_id,
        }),
      )
    }
  }

  return NextResponse.json({ item: updatedItem }, { status: 200 })
}
