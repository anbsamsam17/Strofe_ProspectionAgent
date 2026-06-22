// ============================================================
// POST /api/email/send — envoi email prospection via Resend
//
// Tickets : GLN-020 (composer/envoi) + GLN-003 (RGPD art. 14) + GLN-120 (Calendly)
//
// Auth : session Supabase obligatoire. RLS implicite filtre par user.
// L'utilisateur envoie pour lui-même → client Supabase SSR (pas service_role).
//
// Flux :
//   1. Auth + validation Zod.
//   2. Fetch prospect (RLS) + contact + profile (settings).
//   3. Si premier contact → ajout footer RGPD art. 14 + opt-out token HMAC.
//   4. Interpolation des variables {{prenom}}, etc.
//   5. Resend.emails.send (from=RESEND_FROM_EMAIL, reply_to=user.email).
//   6. INSERT prospect_exchanges (type=email, result=sent, notes=corps).
//   7. Si premier contact → UPDATE prospects.first_contact_at.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Resend } from 'resend'
import * as React from 'react'

import { createClient } from '@/lib/supabase/server'
import { isOptedOut } from '@/lib/agent/opt-out-checker'
import { TEMPLATES } from '@/lib/email/templates/prospection'
import {
  interpolateTemplate,
  computeBegesExpireLe,
  computeBegesAnneeReporting,
} from '@/lib/email/render'
import { buildRgpdFooter } from '@/lib/email/rgpd'
import { generateOptOutToken } from '@/lib/auth/opt-out-token'
import type { ProfileSettings } from '@/lib/types'

export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// Validation Zod
// ------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Préfixe `legacy-<UUID>` accepté pour les contacts stockés en colonnes
// `prospects.contact_*` (enrichissement UI pré-migration prospect_contacts).
const CONTACT_ID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|legacy-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

const BodySchema = z.object({
  prospectId: z.string().regex(UUID_RE, 'UUID prospect invalide'),
  contactId: z.string().regex(CONTACT_ID_RE, 'Contact ID invalide'),
  subject: z.string().min(1, 'Sujet vide').max(200, 'Sujet trop long'),
  body: z.string().min(1, 'Corps vide').max(10_000, 'Corps trop long'),
  templateKey: z.enum(['daf', 'rse', 'dg', 'drh']),
})

// ------------------------------------------------------------
// Client Resend (lazy singleton)
// ------------------------------------------------------------

let _resendClient: Resend | null = null
function getResendClient(): Resend {
  if (!_resendClient) {
    _resendClient = new Resend(process.env.RESEND_API_KEY)
  }
  return _resendClient
}

// ------------------------------------------------------------
// POST
// ------------------------------------------------------------

export async function POST(request: NextRequest) {
  // 1. Client + auth
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

  // 2. Parse body
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'JSON invalide' } },
      { status: 400 },
    )
  }

  const parsed = BodySchema.safeParse(raw)
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

  const { prospectId, contactId, subject, body, templateKey } = parsed.data

  // 3. Fetch prospect (RLS implicite)
  // NB: cast unknown -> ProspectRow car les types Supabase générés ne reflètent
  // pas encore la migration 022 (first_contact_at) — `npm run db:types` après push.
  type ProspectRow = {
    id: string
    user_id: string
    raison_sociale: string
    secteur_libelle: string | null
    beges_derniere_publication: string | null
    entite_publique: boolean | null
    first_contact_at: string | null
    statut: string | null
    siren: string | null
    contact_prenom: string | null
    contact_nom: string | null
    contact_email: string | null
    contact_poste: string | null
  }

  const { data: prospectRaw, error: prospectError } = await supabase
    .from('prospects')
    .select('*')
    .eq('id', prospectId)
    .maybeSingle()

  if (prospectError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: prospectError.message } },
      { status: 500 },
    )
  }
  if (!prospectRaw) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Prospect introuvable' } },
      { status: 404 },
    )
  }
  // Cast `unknown -> ProspectRow` sûr : les types Supabase générés
  // (database.types.ts) ne reflètent pas encore la colonne `first_contact_at`
  // (migration 022), d'où le double cast pour contourner l'inférence partielle.
  // Sûr car : (a) le `select('*')` ramène bien la ligne complète de `prospects`,
  // (b) `prospectId` a été validé en amont par le schema Zod (UUID_RE),
  // (c) les champs sont lus en lecture seule sans contrat d'écriture.
  // À retirer après régénération des types via scripts/regen-supabase-types.ps1.
  const prospect = prospectRaw as unknown as ProspectRow

  // 4. Fetch contact + check ownership chain
  // Deux sources possibles :
  //   a) contactId UUID standard → table normalisée `prospect_contacts`
  //   b) contactId préfixé `legacy-<prospectUUID>` → colonnes legacy
  //      `prospects.contact_*` (cf. /api/prospects/[id]/enrich qui n'écrit
  //      pas encore dans la table normalisée).
  type ResolvedContact = {
    prenom: string | null
    nom: string | null
    email: string
    poste: string | null
  }
  let contact: ResolvedContact

  if (contactId.startsWith('legacy-')) {
    const expectedLegacyId = `legacy-${prospectId}`
    if (contactId !== expectedLegacyId) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Contact legacy invalide pour ce prospect' } },
        { status: 404 },
      )
    }
    if (!prospect.contact_email) {
      return NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'Contact legacy sans email' } },
        { status: 400 },
      )
    }
    contact = {
      prenom: prospect.contact_prenom,
      nom: prospect.contact_nom,
      email: prospect.contact_email,
      poste: prospect.contact_poste,
    }
  } else {
    const { data: contactRow, error: contactError } = await supabase
      .from('prospect_contacts')
      .select('id, prospect_id, prenom, nom, email, email_status, poste')
      .eq('id', contactId)
      .maybeSingle()

    if (contactError) {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: contactError.message } },
        { status: 500 },
      )
    }
    if (!contactRow || contactRow.prospect_id !== prospectId) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Contact introuvable' } },
        { status: 404 },
      )
    }
    if (!contactRow.email || contactRow.email_status === 'invalid') {
      return NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'Contact sans email valide' } },
        { status: 400 },
      )
    }
    contact = {
      prenom: contactRow.prenom,
      nom: contactRow.nom,
      email: contactRow.email,
      poste: contactRow.poste,
    }
  }

  // 4bis. Vérification opt-out RGPD (art. 21) AVANT tout envoi.
  // Contrairement au pipeline (fail-open, cf. orchestrator l.530-538), le chemin
  // d'envoi MANUEL est FAIL-CLOSED : si on ne peut pas confirmer que le
  // destinataire n'est PAS désinscrit, on bloque l'envoi.
  //
  // Deux sources d'opt-out :
  //   a) statut prospect `do_not_contact` (opt-out manuel utilisateur, migr. 017),
  //   b) table `opt_out` (désinscription 1 clic du prospect — siren et/ou email),
  //      revérifiée via `isOptedOut` (même logique que le scoring/pitch).
  if (prospect.statut === 'do_not_contact') {
    return NextResponse.json(
      {
        error: {
          code: 'OPTED_OUT',
          message: 'Ce prospect est marqué « ne pas contacter » (opt-out RGPD). Envoi bloqué.',
        },
      },
      { status: 409 },
    )
  }

  let recipientOptedOut: boolean
  try {
    recipientOptedOut = await isOptedOut(supabase, user.id, {
      siren: prospect.siren ?? undefined,
      email: contact.email,
    })
  } catch (err) {
    // FAIL-CLOSED : impossible de vérifier l'opt-out → on n'envoie pas.
    const msg = err instanceof Error ? err.message : 'erreur vérification opt-out'
    return NextResponse.json(
      {
        error: {
          code: 'OPT_OUT_CHECK_FAILED',
          message: `Vérification opt-out impossible, envoi bloqué (RGPD) : ${msg}`,
        },
      },
      { status: 409 },
    )
  }
  if (recipientOptedOut) {
    return NextResponse.json(
      {
        error: {
          code: 'OPTED_OUT',
          message: 'Ce destinataire s\'est désinscrit (opt-out RGPD). Envoi bloqué.',
        },
      },
      { status: 409 },
    )
  }

  // 5. Fetch profile (Calendly URL + reply-to)
  // NB: select '*' + cast car la colonne `email` sur profiles est ajoutée par
  // une migration future non reflétée dans database.types.ts (auto-régénéré).
  type ProfileRow = {
    settings: unknown
    email: string | null
    full_name: string | null
  }
  const { data: profileRaw } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  // Cast `unknown -> ProfileRow | null` sûr : la colonne `email` sur `profiles`
  // est ajoutée par une migration non encore reflétée dans database.types.ts,
  // d'où le double cast pour contourner l'inférence partielle des types générés.
  // Sûr car : (a) `user.id` provient de la session Supabase authentifiée (pas
  // d'entrée utilisateur), (b) tous les champs sont lus en lecture seule et
  // déjà gardés par `?.` / fallback en aval, (c) le `null` est explicitement
  // géré (profil absent). À retirer après scripts/regen-supabase-types.ps1.
  const profile = (profileRaw ?? null) as unknown as ProfileRow | null

  const settings = (profile?.settings ?? {}) as Partial<ProfileSettings>
  const calendlyUrl = settings.calendly_url ?? ''
  const senderName = profile?.full_name ?? null
  // Reply-to centralisé sur la boite contact STROFE (decision produit 2026-05-20)
  // pour mutualiser les reponses prospects vs l'inbox personnelle du user.
  // Override possible via RESEND_REPLY_TO_EMAIL si besoin futur multi-tenant.
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL ?? 'contact@strofe.fr'

  // 6. Pré-vérification template (le set est figé via TEMPLATES)
  if (!(templateKey in TEMPLATES)) {
    // Le schema Zod garantit déjà cette invariance, mais double-check.
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Template inconnu' } },
      { status: 400 },
    )
  }
  const template = TEMPLATES[templateKey]

  // 7. Premier contact ? → footer RGPD art. 14 + flagging post-send
  // Double check : `first_contact_at` peut être NULL sur prospects pré-migration
  // 022 alors qu'un email a déjà été envoyé via `prospect_exchanges`. On consulte
  // donc aussi l'historique pour éviter de réinjecter le footer art. 14 à chaque
  // envoi sur ces prospects legacy. Audit Playwright 2026-05-20.
  let isFirstContact = prospect.first_contact_at === null
  if (isFirstContact) {
    const { count: priorEmailCount } = await supabase
      .from('prospect_exchanges')
      .select('id', { count: 'exact', head: true })
      .eq('prospect_id', prospectId)
      .eq('type', 'email')
    if ((priorEmailCount ?? 0) > 0) {
      isFirstContact = false
    }
  }
  const ENV_APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://decarbonleads.strofe.fr'

  // Variables pour interpolation
  const variables = {
    prenom: contact.prenom,
    nom: contact.nom,
    raison_sociale: prospect.raison_sociale,
    secteur_libelle: prospect.secteur_libelle ?? '',
    beges_expire_le: computeBegesExpireLe({
      beges_derniere_publication: prospect.beges_derniere_publication,
      entite_publique: prospect.entite_publique,
    }),
    beges_annee_reporting: computeBegesAnneeReporting(
      prospect.beges_derniere_publication,
    ),
    calendly_url: calendlyUrl,
  }

  // Interpolation sujet + corps (UI envoie déjà du contenu pouvant contenir placeholders)
  const finalSubject = interpolateTemplate(subject, variables)
  const finalBody = interpolateTemplate(body, variables)

  // 8. Si premier contact, construit le footer RGPD art. 14 (GLN-003)
  // Le footer est passé en PROP séparée au layout — il est rendu dans un
  // bloc dédié (divider + style discret), pas concaténé au body. Fix 2026-05-20.
  let rgpdFooterText: string | undefined = undefined
  if (isFirstContact) {
    try {
      const token = generateOptOutToken({
        userId: user.id,
        siren: prospect.siren ?? undefined,
        email: contact.email,
        ttlDays: 365,
      })
      const optOutUrl = `${ENV_APP_URL}/api/opt-out/${token}`
      rgpdFooterText = buildRgpdFooter(optOutUrl)
    } catch (err) {
      // OPT_OUT_HMAC_SECRET non configuré — on bloque l'envoi du premier
      // contact car sans opt-out 1 clic on n'est pas conforme.
      const msg = err instanceof Error ? err.message : 'config opt-out invalide'
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: msg } },
        { status: 500 },
      )
    }
  }

  // 9. Envoi Resend
  const fromEmail = process.env.RESEND_FROM_EMAIL
  if (!fromEmail || !process.env.RESEND_API_KEY) {
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Config email manquante (RESEND_*)',
        },
      },
      { status: 500 },
    )
  }

  const reactElement = React.createElement(template.Component, {
    body: finalBody,
    calendlyUrl: calendlyUrl || undefined,
    rgpdFooter: rgpdFooterText, // GLN-003 — bloc dédié dans le layout (divider + style gris)
    senderName: senderName ?? undefined,
  })

  const { data: sendData, error: sendError } = await getResendClient().emails.send({
    from: fromEmail,
    to: contact.email,
    replyTo,
    subject: finalSubject,
    react: reactElement,
  })

  if (sendError) {
    return NextResponse.json(
      {
        error: {
          code: 'EXTERNAL_API_ERROR',
          message: sendError.message || 'Erreur envoi Resend',
        },
      },
      { status: 502 },
    )
  }

  // 10. INSERT prospect_exchanges
  const { data: exchange, error: insertError } = await supabase
    .from('prospect_exchanges')
    .insert({
      user_id: user.id,
      prospect_id: prospectId,
      type: 'email',
      result: 'sent',
      // Traçabilité CNIL : on persiste le footer art. 14 dans les notes
      // pour pouvoir prouver l'information préalable du destinataire,
      // même si visuellement le footer est rendu dans un bloc séparé.
      notes: rgpdFooterText
        ? `Sujet : ${finalSubject}\n\n${finalBody}\n\n${rgpdFooterText}`
        : `Sujet : ${finalSubject}\n\n${finalBody}`,
      occurred_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (insertError) {
    // L'email est PARTI mais le log échoue — on remonte une erreur 500
    // pour que l'utilisateur sache, mais on reflète qu'il a été envoyé.
    return NextResponse.json(
      {
        error: {
          code: 'DB_ERROR',
          message: `Email envoyé mais traçabilité échouée : ${insertError.message}`,
        },
        sent: true,
        resendId: sendData?.id,
      },
      { status: 500 },
    )
  }

  // 11. UPDATE first_contact_at si premier contact (GLN-003)
  if (isFirstContact) {
    // Cast unknown — colonne ajoutée par migration 022 mais pas encore reflétée
    // dans database.types.ts (auto-régénéré par scripts/regen-supabase-types.ps1).
    // Cast `unknown -> Record<string, unknown>` sûr : la colonne
    // `first_contact_at` (migration 022) n'est pas encore dans le type Update
    // généré de `prospects`, ce qui ferait échouer le typage de `.update(...)`.
    // Sûr car : (a) la valeur est une ISO string produite côté serveur (pas
    // d'entrée utilisateur), (b) le filtre `.eq('id', prospectId)` cible une
    // seule ligne dont l'appartenance a été vérifiée plus haut (RLS + ownership),
    // (c) l'échec d'update est non bloquant et loggé. À retirer après
    // régénération des types via scripts/regen-supabase-types.ps1.
    const updatePayload = {
      first_contact_at: new Date().toISOString(),
    } as unknown as Record<string, unknown>
    const { error: updateError } = await supabase
      .from('prospects')
      .update(updatePayload)
      .eq('id', prospectId)
    if (updateError) {
      // Non bloquant — l'échange est tracé, l'email parti, on log côté serveur.
      console.error(
        JSON.stringify({
          module: 'email-send',
          level: 'warn',
          msg: 'first_contact_at update failed',
          prospect_id: prospectId,
          error: updateError.message,
        }),
      )
    }
  }

  return NextResponse.json(
    {
      data: {
        id: exchange.id,
        sentAt: new Date().toISOString(),
        resendId: sendData?.id ?? null,
        firstContact: isFirstContact,
      },
    },
    { status: 201 },
  )
}
