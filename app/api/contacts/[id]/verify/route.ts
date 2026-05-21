// ============================================================
// POST /api/contacts/[id]/verify — vérifier email via DNS MX + heuristiques
// ------------------------------------------------------------
// Ticket : GLN-062 (data quality — verification email + score confiance)
//
// Endpoint user-déclenché depuis la liste de contacts d'un prospect (bouton
// "Vérifier"). Vérification 100% locale (DNS MX + listes disposable/webmail)
// — pas de quota externe. Remplace Hunter Email Verifier 2026-05-22 (plan
// gratuit Hunter cap 25/mois trop limitant).
//
// Persistance : `email_status` (valid/accept_all/webmail/disposable/invalid/
// unknown) + `email_confidence` (score 0-100) + `email_verified_at`.
//
// Body : `{}` (rien — l'ID contact est dans l'URL).
//
// Sécurité :
//   - getUser() obligatoire (session SSR).
//   - Ownership vérifié explicitement (RLS de prospect_contacts garantit
//     déjà l'isolation, on relit pour obtenir l'email).
//   - Pas de service_role.
//
// Erreurs :
//   - 401 UNAUTHENTICATED  : pas de session
//   - 400 INVALID_INPUT    : id non UUID / contact sans email
//   - 404 NOT_FOUND        : contact introuvable / pas owné
//   - 500 INTERNAL_ERROR   : erreur DB inattendue
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { verifyEmailViaDns } from '@/lib/agent/email-verifier-dns'

export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Body Zod — pas de champ attendu pour l'instant, on garde strict pour défaut. */
const BodySchema = z.object({}).strict()

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function isValidUUID(id: string): boolean {
  return UUID_RE.test(id)
}

/**
 * Parse safe du body — `{}` si absent ou vide (le body est optionnel).
 */
async function safeParseBody(req: NextRequest): Promise<unknown> {
  try {
    const text = await req.text()
    if (!text || text.trim().length === 0) return {}
    return JSON.parse(text)
  } catch {
    return null
  }
}

// ------------------------------------------------------------
// HANDLER
// ------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()

  // 1. Auth — getUser (revalide la session).
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Non authentifié' } },
      { status: 401 },
    )
  }

  // 2. Validation id
  const { id } = await params
  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Identifiant contact invalide' } },
      { status: 400 },
    )
  }

  // 3. Validation body (vide accepté, strict refuse les inconnus)
  const raw = await safeParseBody(request)
  if (raw === null) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Body JSON malformé' } },
      { status: 400 },
    )
  }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: parsed.error.message } },
      { status: 400 },
    )
  }

  // 4. Charger le contact (RLS filtre par user_id, mais on garde lecture
  //    explicite pour obtenir l'email + détecter NOT_FOUND).
  const { data: contact, error: fetchErr } = await supabase
    .from('prospect_contacts')
    .select('id, email, user_id')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: fetchErr.message } },
      { status: 500 },
    )
  }
  if (!contact) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Contact introuvable' } },
      { status: 404 },
    )
  }

  // Defense-in-depth : la RLS doit déjà filtrer, mais on vérifie l'ownership
  // pour ne jamais lancer la vérification sur un contact d'un autre user.
  if (contact.user_id !== user.id) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Contact introuvable' } },
      { status: 404 },
    )
  }

  if (!contact.email || contact.email.trim().length === 0) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_INPUT',
          message: "Ce contact n'a pas d'email à vérifier",
        },
      },
      { status: 400 },
    )
  }

  // 5. Vérification DNS MX + heuristiques (sans quota externe).
  // Remplace Hunter 2026-05-22 — plan gratuit Hunter cap 25/mois trop limitant.
  // verifyEmailViaDns ne throw pas en mode dégradé (renvoie 'unknown').
  const verification = await verifyEmailViaDns(contact.email)

  // 7. Persister status + score + verified_at. RLS filtre via session.
  const verifiedAt = new Date().toISOString()
  const { data: updated, error: updateErr } = await supabase
    .from('prospect_contacts')
    .update({
      email_status: verification.status,
      email_confidence: verification.score,
      email_verified_at: verifiedAt,
    })
    .eq('id', id)
    .select('id, email_status, email_confidence, email_verified_at')
    .maybeSingle()

  if (updateErr) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: updateErr.message } },
      { status: 500 },
    )
  }
  if (!updated) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Contact introuvable (post-update)' } },
      { status: 404 },
    )
  }

  return NextResponse.json(
    {
      data: {
        email_status: updated.email_status,
        email_score: updated.email_confidence,
        email_verified_at: updated.email_verified_at,
      },
    },
    { status: 200 },
  )
}
