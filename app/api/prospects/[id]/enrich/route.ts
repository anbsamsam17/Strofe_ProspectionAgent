// ============================================================
// POST /api/prospects/[id]/enrich — re-trigger enrichissement contact
//
// Endpoint user-déclenché (bouton "Chercher un contact" sur la fiche prospect).
// Appelle la cascade `enrichirContact` (lib/agent/contact-enrichment) pour
// un seul prospect, identique à ce que fait l'orchestrator cron mais à la
// demande.
//
// Body (optionnel) :
//   { forceReplace?: boolean }
//
// Quand `forceReplace=true` :
//   1. SELECT les contacts masqués (placeholder [Masqué], email_is_pro=false,
//      email_status='invalid', etc.) via `isMaskedContact()`
//   2. DELETE ces lignes de `prospect_contacts`
//   3. RESET les colonnes legacy `prospects.contact_*` si elles pointent vers
//      un masqué (sinon on les garde — la cascade est additive)
//   4. PUIS lance la cascade normale avec un contact existant "vide"
//
// Différences vs orchestrator :
//   - Pas de tier hot/cold (l'utilisateur demande explicitement)
//   - Pas de filtre opt-out (l'utilisateur sait ce qu'il fait)
//   - Réponse synchrone JSON : { added: [...], sources: [...], replaced?: number }
//   - Timeout 25s (Vercel function timeout 30s, on garde une marge)
//
// Sécurité :
//   - getUser() obligatoire → session valide.
//   - RLS via session SSR : un user ne peut enrichir que ses prospects.
//   - Pas de service_role (le pipeline cron utilise service_role, mais ici
//     on est en session user — RLS suffit).
//
// Erreurs :
//   - 401 UNAUTHENTICATED  : pas de session
//   - 400 INVALID_INPUT    : id non UUID / body malformé
//   - 404 NOT_FOUND        : prospect introuvable / pas owné
//   - 503 EXTERNAL_API_ERROR : Pappers/Hunter quotas épuisés
//   - 500 INTERNAL_ERROR   : erreur inattendue
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { createAdminClient, createClient } from '@/lib/supabase/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { enrichirContact, type EnrichedContact } from '@/lib/agent/contact-enrichment'
import { isProfessionalEmail } from '@/lib/agent/email-is-pro'
import {
  isMaskedContact,
  type MaskedDetectableContact,
} from '@/lib/agent/contact-masked-detector'

export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

/** Vercel function timeout 30s — on s'arrête à 25s pour rendre un message clair. */
const ENRICH_TIMEOUT_MS = 25_000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const bodySchema = z
  .object({
    forceReplace: z.boolean().optional(),
  })
  .strict()

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function isValidUUID(id: string): boolean {
  return UUID_RE.test(id)
}

/**
 * Race une promesse contre un timeout. Si le timeout l'emporte, rejette avec
 * un Error('TIMEOUT'). L'appelant transformera cette erreur en réponse 504-like.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('TIMEOUT')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

/**
 * Tente de parser le body JSON. Body absent OU vide = `{}` (le param est optionnel).
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

  // 1. Auth
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
      { error: { code: 'INVALID_INPUT', message: 'Identifiant prospect invalide' } },
      { status: 400 },
    )
  }

  // 2bis. Rate-limit (anti-abus quotas Pappers/Hunter) — cascade payante par hit.
  // 30 enrichissements / minute : généreux pour un usage manuel (clics sur fiches)
  // tout en plafonnant un script abusif. Client admin dédié au limiteur (le reste
  // de la route reste en session SSR + RLS). Placé APRÈS l'auth, AVANT la cascade.
  // Fail-open si la DB du limiteur est indisponible.
  const enrichRl = await checkRateLimit(createAdminClient, user.id, 'prospect_enrich', {
    limit: 30,
    windowSec: 60,
  })
  if (!enrichRl.allowed) {
    return rateLimitResponse(enrichRl)
  }

  // 3. Validation body (optionnel)
  const rawBody = await safeParseBody(request)
  if (rawBody === null) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Body JSON malformé' } },
      { status: 400 },
    )
  }
  const parsed = bodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: parsed.error.message } },
      { status: 400 },
    )
  }
  const forceReplace = parsed.data.forceReplace === true

  // 4. Charger le prospect (RLS filtre par user_id)
  const { data: prospect, error: fetchError } = await supabase
    .from('prospects')
    .select(
      'id, siren, raison_sociale, contact_nom, contact_prenom, contact_poste, contact_telephone, contact_email, contact_linkedin, contact_linkedin_entreprise',
    )
    .eq('id', id)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: fetchError.message } },
      { status: 500 },
    )
  }
  if (!prospect) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Prospect introuvable' } },
      { status: 404 },
    )
  }

  if (!prospect.siren) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_INPUT',
          message: 'Prospect sans SIREN — enrichissement impossible',
        },
      },
      { status: 400 },
    )
  }

  // 5. Cleanup contacts masqués si demandé.
  // ----------------------------------------------------------
  // On lit les contacts associés, on filtre les masqués via `isMaskedContact`,
  // puis on les supprime de `prospect_contacts`. On reset également les colonnes
  // legacy `prospects.contact_*` si le contact "primaire legacy" est masqué.
  // Tout cela AVANT la cascade, pour qu'elle ne soit plus court-circuitée.
  let replacedCount = 0
  let legacyReset = false
  if (forceReplace) {
    const { data: existingContacts, error: contactsErr } = await supabase
      .from('prospect_contacts')
      .select('id, nom, prenom, email, telephone, email_is_pro, email_status')
      .eq('prospect_id', id)

    if (contactsErr) {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: contactsErr.message } },
        { status: 500 },
      )
    }

    const maskedIds = (existingContacts ?? [])
      .filter((c) => isMaskedContact(c as MaskedDetectableContact))
      .map((c) => c.id as string)

    if (maskedIds.length > 0) {
      const { error: deleteErr } = await supabase
        .from('prospect_contacts')
        .delete()
        .in('id', maskedIds)
      if (deleteErr) {
        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: deleteErr.message } },
          { status: 500 },
        )
      }
      replacedCount = maskedIds.length
    }

    // Reset legacy si le contact stocké sur la ligne `prospects` est lui-même
    // masqué — sinon on conserve les données (la cascade est additive et ne
    // doit pas effacer un contact valide).
    const legacyContactView: MaskedDetectableContact = {
      nom: prospect.contact_nom ?? null,
      prenom: prospect.contact_prenom ?? null,
      email: prospect.contact_email ?? null,
      telephone: prospect.contact_telephone ?? null,
    }
    if (isMaskedContact(legacyContactView)) {
      const { error: legacyErr } = await supabase
        .from('prospects')
        .update({
          contact_nom: null,
          contact_prenom: null,
          contact_poste: null,
          contact_telephone: null,
          contact_email: null,
          contact_linkedin: null,
        })
        .eq('id', id)
      if (legacyErr) {
        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: legacyErr.message } },
          { status: 500 },
        )
      }
      legacyReset = true
      // Repartir avec un état "vide" pour la cascade.
      prospect.contact_nom = null
      prospect.contact_prenom = null
      prospect.contact_poste = null
      prospect.contact_telephone = null
      prospect.contact_email = null
      prospect.contact_linkedin = null
    }
  }

  // 6. Construire le contact existant (champs déjà présents — la cascade ne
  // les ré-enrichit pas, garde sa sémantique additive).
  const existingContact: Partial<EnrichedContact> = {
    contact_nom: prospect.contact_nom ?? undefined,
    contact_prenom: prospect.contact_prenom ?? undefined,
    contact_poste: prospect.contact_poste ?? undefined,
    contact_telephone: prospect.contact_telephone ?? undefined,
    contact_email: prospect.contact_email ?? undefined,
    contact_linkedin: prospect.contact_linkedin ?? undefined,
    contact_linkedin_entreprise: prospect.contact_linkedin_entreprise ?? undefined,
  }

  // 7. Appel cascade avec timeout dur (Vercel cap 30s).
  let nouveauxChamps: Partial<EnrichedContact>
  try {
    nouveauxChamps = await withTimeout(
      enrichirContact(
        prospect.siren,
        existingContact,
        prospect.raison_sociale ?? '',
      ),
      ENRICH_TIMEOUT_MS,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Timeout = cascade trop longue (sources externes lentes)
    if (message === 'TIMEOUT') {
      return NextResponse.json(
        {
          error: {
            code: 'EXTERNAL_API_ERROR',
            message: 'Enrichissement trop long (sources externes lentes). Réessayez plus tard.',
          },
        },
        { status: 504 },
      )
    }
    // Quotas Pappers/Hunter épuisés — message dédié 503.
    if (/quota|crédits|credits|exhausted/i.test(message)) {
      return NextResponse.json(
        {
          error: {
            code: 'EXTERNAL_API_ERROR',
            message:
              "Quota d'enrichissement épuisé pour ce mois. Le quota se réinitialise le 1er du mois.",
          },
        },
        { status: 503 },
      )
    }
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Erreur enrichissement : ' + message } },
      { status: 500 },
    )
  }

  // 8. Filtre email_is_pro : un email perso (gmail, hotmail, …) ne doit jamais
  // écraser le primary. Aligné sur la logique de l'orchestrator cron.
  let emailPersoSkipped = false
  if (
    nouveauxChamps.contact_email &&
    !isProfessionalEmail(nouveauxChamps.contact_email)
  ) {
    delete nouveauxChamps.contact_email
    emailPersoSkipped = true
  }

  // 9. Rien à mettre à jour → réponse no-op.
  if (Object.keys(nouveauxChamps).length === 0) {
    return NextResponse.json(
      {
        data: {
          added: [],
          sources: [],
          replaced: replacedCount,
          legacyReset,
          reason: emailPersoSkipped
            ? 'email_perso_filtered'
            : replacedCount > 0 || legacyReset
              ? 'replaced_no_new_data'
              : 'no_new_data',
        },
      },
      { status: 200 },
    )
  }

  // 10. UPDATE — on n'écrase JAMAIS les champs existants côté DB (la cascade
  // a déjà filtré, mais on sécurise une seconde fois en ne passant que les
  // champs réellement nouveaux). RLS filtre via session.
  const updatePayload: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(nouveauxChamps)) {
    updatePayload[key] = value ?? null
  }

  const { error: updateError } = await supabase
    .from('prospects')
    .update(updatePayload)
    .eq('id', id)

  if (updateError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: updateError.message } },
      { status: 500 },
    )
  }

  // 11. Déterminer les sources qui ont contribué — heuristique simple basée
  // sur quels champs ont été remplis. Le détail fin est dans les logs serveur
  // (cf. logSummary dans contact-enrichment.ts).
  const sources: string[] = []
  if (nouveauxChamps.contact_nom || nouveauxChamps.contact_prenom) {
    sources.push('recherche-entreprises')
  }
  if (nouveauxChamps.contact_telephone) sources.push('pappers')
  if (nouveauxChamps.contact_email) sources.push('hunter')
  if (nouveauxChamps.contact_linkedin_entreprise) sources.push('linkedin')

  // Déduplication ordre préservé.
  const uniqueSources = Array.from(new Set(sources))

  return NextResponse.json(
    {
      data: {
        added: Object.keys(nouveauxChamps),
        sources: uniqueSources,
        replaced: replacedCount,
        legacyReset,
      },
    },
    { status: 200 },
  )
}
