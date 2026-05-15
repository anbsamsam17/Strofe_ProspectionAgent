// ============================================================
// POST /api/prospects/[id]/enrich — re-trigger enrichissement contact
//
// Endpoint user-déclenché (bouton "Vérifier maintenant" sur la fiche
// prospect). Appelle la cascade `enrichirContact` (lib/agent/contact-enrichment)
// pour un seul prospect, identique à ce que fait l'orchestrator cron mais à
// la demande.
//
// Différences vs orchestrator :
//   - Pas de tier hot/cold (l'utilisateur demande explicitement)
//   - Pas de filtre opt-out (l'utilisateur sait ce qu'il fait — il pourra
//     opt-out par ailleurs)
//   - Réponse synchrone JSON : { added: [...], sources: [...] }
//   - Timeout 25s (Vercel function timeout 30s, on garde une marge)
//
// Sécurité :
//   - getUser() obligatoire → session valide.
//   - RLS via session SSR : un user ne peut enrichir que ses prospects.
//   - Pas de service_role (le pipeline cron utilise lui-même service_role,
//     mais ici on est dans une session user — RLS suffit).
//
// Erreurs :
//   - 401 UNAUTHENTICATED  : pas de session
//   - 400 INVALID_INPUT    : id non UUID
//   - 404 NOT_FOUND        : prospect introuvable / pas owné
//   - 503 EXTERNAL_API_ERROR : Pappers/Hunter quotas épuisés
//   - 500 INTERNAL_ERROR   : erreur inattendue
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { enrichirContact, type EnrichedContact } from '@/lib/agent/contact-enrichment'
import { isProfessionalEmail } from '@/lib/agent/email-is-pro'

export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

/** Vercel function timeout 30s — on s'arrête à 25s pour rendre un message clair. */
const ENRICH_TIMEOUT_MS = 25_000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

// ------------------------------------------------------------
// HANDLER
// ------------------------------------------------------------

export async function POST(
  _request: NextRequest,
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

  // 3. Charger le prospect (RLS filtre par user_id)
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

  // 4. Construire le contact existant (champs déjà présents — la cascade ne
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

  // 5. Appel cascade avec timeout dur (Vercel cap 30s).
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

  // 6. Filtre email_is_pro : un email perso (gmail, hotmail, …) ne doit jamais
  // écraser le primary. Aligné sur la logique de l'orchestrator cron.
  let emailPersoSkipped = false
  if (
    nouveauxChamps.contact_email &&
    !isProfessionalEmail(nouveauxChamps.contact_email)
  ) {
    delete nouveauxChamps.contact_email
    emailPersoSkipped = true
  }

  // 7. Rien à mettre à jour → réponse no-op.
  if (Object.keys(nouveauxChamps).length === 0) {
    return NextResponse.json(
      {
        data: {
          added: [],
          sources: [],
          reason: emailPersoSkipped ? 'email_perso_filtered' : 'no_new_data',
        },
      },
      { status: 200 },
    )
  }

  // 8. UPDATE — on n'écrase JAMAIS les champs existants côté DB (la cascade
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

  // 9. Déterminer les sources qui ont contribué — heuristique simple basée
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
      },
    },
    { status: 200 },
  )
}
