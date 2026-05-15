// ============================================================
// CONTACT PERSISTENCE — Agent IA Prospection Bilan Carbone
//
// Couche de persistance pour l'enrichissement contacts v2 (migration 015).
//
// Rôles :
//   1. `upsertContact`        : insert ou update idempotent dans
//      `prospect_contacts`, avec append append-only de la `source_chain` JSONB.
//      L'unicité fonctionnelle est `(prospect_id, lower(email))` quand un email
//      est présent, sinon `(prospect_id, lower(nom), lower(prenom))`. La table
//      n'ayant pas d'UNIQUE constraint sur ces couples (cf. migration 011),
//      la déduplication est gérée applicativement (SELECT-then-UPSERT).
//
//   2. `computeProspectCompleteness` : score 0-100 de complétude contact, basé
//      sur la présence d'email, téléphone, linkedin sur les contacts agrégés
//      du prospect (max par canal — pas la somme — un email vaut email, peu
//      importe le nombre de contacts qui le portent).
//
//   3. `refreshProspectAggregates` : met à jour les colonnes agrégées sur
//      `prospects` (contact_completeness, contact_source_origin,
//      last_enrichment_run_at, contact_tier) après une passe d'enrichissement.
//
//   4. `computeTier` : fonction pure dérivant le tier hot/cold à partir des
//      flags BEGES (obligation + publié + valide).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

// ------------------------------------------------------------
// TYPES PUBLICS
// ------------------------------------------------------------

/**
 * Sources reconnues par la cascade d'enrichissement v2.
 * Aligné sur le CHECK constraint `prospects.contact_source_origin` (migration 015)
 * + 'ademe' utilisé en source historique pour les contacts importés du BEGES.
 */
export type ContactSource =
  | 're'
  | 'inpi'
  | 'bodacc'
  | 'pappers'
  | 'hunter-pattern'
  | 'pattern'
  | 'ademe'
  | 'manual'

export interface ContactInput {
  prospect_id: string
  nom?: string | null
  prenom?: string | null
  poste?: string | null
  email?: string | null
  telephone?: string | null
  linkedin?: string | null
  is_primary?: boolean
  email_status?: 'valid' | 'catchall' | 'invalid' | 'unknown' | 'pattern_unverified'
  email_confidence?: number
  email_is_pro?: boolean
  source: ContactSource
}

// ------------------------------------------------------------
// HELPERS INTERNES
// ------------------------------------------------------------

const CONTACTS_TABLE = 'prospect_contacts'
const PROSPECTS_TABLE = 'prospects'

/** Type lâche pour gérer `database.types.ts` non régénéré post-migration 015. */
type AnyClient = SupabaseClient<any, 'public', any>

/**
 * Entrée append dans `source_chain` à chaque passe d'enrichissement.
 * Format aligné sur le commentaire SQL de la colonne (migration 015).
 */
interface SourceChainEntry {
  source: ContactSource
  at: string
  result: 'hit' | 'miss'
}

/** Borne basse / haute du score de complétude (cohérent avec CHECK SMALLINT 0-100). */
const COMPLETENESS_MIN = 0
const COMPLETENESS_MAX = 100

/** Pondération par canal (33 points × 3 canaux + 1 bonus identité = 100). */
const POINTS_PER_CHANNEL = 33
const IDENTITY_BONUS = 1

/** Format ISO 8601 court. */
function nowIso(): string {
  return new Date().toISOString()
}

/** Normalise une string optionnelle pour comparaison case-insensitive. */
function normKey(s: string | null | undefined): string | null {
  if (!s) return null
  const t = s.trim().toLowerCase()
  return t || null
}

// ------------------------------------------------------------
// API PUBLIQUE — TIER
// ------------------------------------------------------------

/**
 * Dérive le tier commercial d'un prospect à partir de ses flags BEGES.
 *
 *   hot  = obligation_beges = true ET (beges_publie = false OU beges_valide = false)
 *          → soit infraction L. 229-25 (jamais publié), soit publication expirée (>4 ans).
 *   cold = tout autre cas.
 *
 * Note : on traite `null` comme "donnée manquante" — un prospect sans flag
 * obligation_beges n'est pas hot (faute de preuve). Pas d'imputation côté code.
 */
export function computeTier(prospect: {
  obligation_beges: boolean | null
  beges_publie: boolean | null
  beges_valide: boolean | null
}): 'hot' | 'cold' {
  if (prospect.obligation_beges !== true) return 'cold'

  // Obligation confirmée — on bascule en hot si pas publié OU expiré.
  if (prospect.beges_publie === false) return 'hot'
  if (prospect.beges_valide === false) return 'hot'

  return 'cold'
}

// ------------------------------------------------------------
// API PUBLIQUE — UPSERT CONTACT
// ------------------------------------------------------------

/**
 * Insère ou met à jour un contact dans `prospect_contacts`.
 *
 * Stratégie de déduplication (la table n'a pas d'UNIQUE composite — cf. 011) :
 *   1. Si `email` fourni : on cherche un contact existant `(prospect_id, lower(email))`.
 *   2. Sinon, si `nom` + `prenom` fournis : on cherche `(prospect_id, lower(nom), lower(prenom))`.
 *   3. Sinon : pas de clé de dédup → on INSERT directement.
 *
 * Sur match : UPDATE en mergeant les champs non-null/non-undefined du payload,
 * et APPEND d'une entrée dans `source_chain` (append-only audit log).
 *
 * Idempotent : appeler 2× la même `ContactInput` ne crée qu'une ligne, mais
 * accumule 2 entrées dans `source_chain` (c'est le but : traçabilité passes).
 *
 * Erreurs DB : retournées dans `{ error }`. Le `contactId` peut être null si
 * la création a échoué.
 */
export async function upsertContact(
  supabase: SupabaseClient,
  contact: ContactInput,
): Promise<{ ok: boolean; contactId: string | null; error: string | null }> {
  const client = supabase as unknown as AnyClient

  // 1. Lecture du contact existant — on récupère user_id ET source_chain pour
  // pouvoir append, et id pour pivoter en UPDATE.
  const emailKey = normKey(contact.email)
  const nomKey = normKey(contact.nom)
  const prenomKey = normKey(contact.prenom)

  let existingId: string | null = null
  let existingSourceChain: SourceChainEntry[] = []

  if (emailKey) {
    const { data, error } = await client
      .from(CONTACTS_TABLE)
      .select('id, source_chain')
      .eq('prospect_id', contact.prospect_id)
      .ilike('email', emailKey)
      .limit(1)
      .maybeSingle()
    if (error) {
      return { ok: false, contactId: null, error: error.message }
    }
    if (data) {
      existingId = (data as { id: string }).id
      const chain = (data as { source_chain?: unknown }).source_chain
      if (Array.isArray(chain)) existingSourceChain = chain as SourceChainEntry[]
    }
  } else if (nomKey && prenomKey) {
    const { data, error } = await client
      .from(CONTACTS_TABLE)
      .select('id, source_chain')
      .eq('prospect_id', contact.prospect_id)
      .ilike('nom', nomKey)
      .ilike('prenom', prenomKey)
      .limit(1)
      .maybeSingle()
    if (error) {
      return { ok: false, contactId: null, error: error.message }
    }
    if (data) {
      existingId = (data as { id: string }).id
      const chain = (data as { source_chain?: unknown }).source_chain
      if (Array.isArray(chain)) existingSourceChain = chain as SourceChainEntry[]
    }
  }

  const newSourceEntry: SourceChainEntry = {
    source: contact.source,
    at: nowIso(),
    result: 'hit',
  }
  const nextSourceChain = [...existingSourceChain, newSourceEntry]

  // 2. Payload commun — on n'inclut user_id qu'à l'INSERT (lecture côté serveur
  // via la session ou propagé manuellement par l'appelant via prospect_id).
  // Les champs undefined/null sont omis pour ne pas écraser un champ déjà rempli.
  const basePayload: Record<string, unknown> = {
    source_chain: nextSourceChain,
    last_enriched_at: nowIso(),
  }
  if (contact.nom != null) basePayload.nom = contact.nom
  if (contact.prenom != null) basePayload.prenom = contact.prenom
  if (contact.poste != null) basePayload.poste = contact.poste
  if (contact.email != null) basePayload.email = contact.email
  if (contact.telephone != null) basePayload.telephone = contact.telephone
  if (contact.linkedin != null) basePayload.linkedin = contact.linkedin
  if (contact.is_primary != null) basePayload.is_primary = contact.is_primary
  if (contact.email_status != null) basePayload.email_status = contact.email_status
  if (contact.email_confidence != null) basePayload.email_confidence = contact.email_confidence
  if (contact.email_is_pro != null) basePayload.email_is_pro = contact.email_is_pro
  basePayload.source = contact.source

  if (existingId) {
    // 3a. UPDATE — la ligne existe déjà, on merge + on append la source_chain.
    const { error } = await client
      .from(CONTACTS_TABLE)
      .update(basePayload as never)
      .eq('id', existingId)
    if (error) {
      return { ok: false, contactId: existingId, error: error.message }
    }
    return { ok: true, contactId: existingId, error: null }
  }

  // 3b. INSERT — pas de match. On a besoin du user_id : il doit être déduit
  // côté DB (RLS via session) ou propagé par l'appelant. Comme la table exige
  // user_id NOT NULL, on lit le user_id du prospect parent pour rester admin-compatible.
  const { data: prospectRow, error: prospectErr } = await client
    .from(PROSPECTS_TABLE)
    .select('user_id')
    .eq('id', contact.prospect_id)
    .maybeSingle()
  if (prospectErr || !prospectRow) {
    return {
      ok: false,
      contactId: null,
      error: prospectErr?.message ?? 'prospect_not_found',
    }
  }

  const userId = (prospectRow as { user_id: string }).user_id
  const insertPayload = {
    ...basePayload,
    user_id: userId,
    prospect_id: contact.prospect_id,
  }

  const { data: inserted, error: insertErr } = await client
    .from(CONTACTS_TABLE)
    .insert(insertPayload as never)
    .select('id')
    .single()

  if (insertErr || !inserted) {
    return {
      ok: false,
      contactId: null,
      error: insertErr?.message ?? 'insert_failed',
    }
  }

  return {
    ok: true,
    contactId: (inserted as { id: string }).id,
    error: null,
  }
}

// ------------------------------------------------------------
// API PUBLIQUE — COMPLÉTUDE
// ------------------------------------------------------------

/**
 * Calcule la complétude contact d'un prospect (0-100).
 *
 * Sémantique "max par canal" — on regarde si AU MOINS un contact du prospect
 * porte chaque canal :
 *   - email présent sur ≥ 1 contact     → +33
 *   - telephone présent sur ≥ 1 contact → +33
 *   - linkedin présent sur ≥ 1 contact  → +33
 *   - nom + prenom présents sur ≥ 1 contact → +1 (bonus identité, comble à 100)
 *
 * On ne somme pas par contact (sinon 2 contacts à 33% donneraient 66% = faux
 * positif sur la qualification commerciale réelle, qui est canal-centric).
 *
 * Erreur DB ou aucun contact → 0.
 */
export async function computeProspectCompleteness(
  supabase: SupabaseClient,
  prospectId: string,
): Promise<number> {
  const client = supabase as unknown as AnyClient

  const { data, error } = await client
    .from(CONTACTS_TABLE)
    .select('email, telephone, linkedin, nom, prenom')
    .eq('prospect_id', prospectId)

  if (error || !data) return COMPLETENESS_MIN
  const rows = data as Array<{
    email?: string | null
    telephone?: string | null
    linkedin?: string | null
    nom?: string | null
    prenom?: string | null
  }>
  if (!rows.length) return COMPLETENESS_MIN

  let hasEmail = false
  let hasPhone = false
  let hasLinkedin = false
  let hasIdentity = false

  for (const row of rows) {
    if (row.email && row.email.trim()) hasEmail = true
    if (row.telephone && row.telephone.trim()) hasPhone = true
    if (row.linkedin && row.linkedin.trim()) hasLinkedin = true
    if (row.nom && row.nom.trim() && row.prenom && row.prenom.trim()) {
      hasIdentity = true
    }
  }

  let score = 0
  if (hasEmail) score += POINTS_PER_CHANNEL
  if (hasPhone) score += POINTS_PER_CHANNEL
  if (hasLinkedin) score += POINTS_PER_CHANNEL
  if (hasIdentity) score += IDENTITY_BONUS

  return Math.min(COMPLETENESS_MAX, Math.max(COMPLETENESS_MIN, score))
}

// ------------------------------------------------------------
// API PUBLIQUE — REFRESH AGRÉGATS PROSPECT
// ------------------------------------------------------------

/**
 * Met à jour les colonnes agrégées sur `prospects` après une passe d'enrichissement :
 *   - contact_completeness  : score 0-100 (via computeProspectCompleteness)
 *   - contact_source_origin : 1ère source rencontrée dans source_chain agrégé
 *                             (lue sur les contacts existants, pas sur le payload courant)
 *   - last_enrichment_run_at: NOW()
 *   - contact_tier          : passé en paramètre (déjà calculé via computeTier en amont)
 *
 * Erreur DB → silent (le pipeline continue). Pas de propagation pour ne pas
 * casser la passe complète sur un agrégat raté — la prochaine passe rattrapera.
 */
export async function refreshProspectAggregates(
  supabase: SupabaseClient,
  prospectId: string,
  tier: 'hot' | 'cold',
): Promise<void> {
  const client = supabase as unknown as AnyClient

  const completeness = await computeProspectCompleteness(supabase, prospectId)

  // Détermination de la source primaire : 1ère entrée chronologique de la
  // source_chain agrégée des contacts. À défaut, on prend `source` du 1er contact.
  const { data: contactRows } = await client
    .from(CONTACTS_TABLE)
    .select('source, source_chain, created_at')
    .eq('prospect_id', prospectId)
    .order('created_at', { ascending: true })

  let originSource: ContactSource | null = null
  const rows = (contactRows ?? []) as Array<{
    source?: string | null
    source_chain?: unknown
    created_at?: string
  }>

  for (const row of rows) {
    if (Array.isArray(row.source_chain) && row.source_chain.length > 0) {
      const first = row.source_chain[0] as Partial<SourceChainEntry>
      if (first?.source) {
        originSource = first.source as ContactSource
        break
      }
    }
    if (row.source) {
      originSource = row.source as ContactSource
      break
    }
  }

  const updatePayload: Record<string, unknown> = {
    contact_completeness: completeness,
    contact_tier: tier,
    last_enrichment_run_at: nowIso(),
  }
  if (originSource) updatePayload.contact_source_origin = originSource

  await client
    .from(PROSPECTS_TABLE)
    .update(updatePayload as never)
    .eq('id', prospectId)
}
