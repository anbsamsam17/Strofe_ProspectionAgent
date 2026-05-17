// ============================================================
// CONTACT MASKED DETECTOR
// ------------------------------------------------------------
// Détecte les contacts "masqués" — placeholder / RGPD / invalides — qui
// court-circuitent injustement la cascade d'enrichissement (`enrichirContact`
// retourne `no_new_data` car les champs sont "remplis"… avec du vide utile).
//
// Marqueurs reconnus :
//   - email contenant `[Masqué]`, `[Masque]`, `_masque`, `masque@`
//   - nom OU prénom égal exactement à `[Masqué]` (ou variantes)
//   - email_is_pro === false (la migration 015 a marqué l'email comme perso)
//   - email_status === 'invalid' (vérification SMTP/Hunter a échoué)
//   - le contact n'a NI email NI téléphone exploitables
//
// Utilisé côté API (`/api/prospects/[id]/enrich`) pour décider du cleanup
// quand `forceReplace=true`, et côté UI pour proposer le bouton "Remplacer
// les contacts masqués".
// ============================================================

// ------------------------------------------------------------
// SHAPE MINIMALE
// ------------------------------------------------------------

/**
 * Shape minimale d'un contact compatible avec la détection. Volontairement
 * minimal pour accepter à la fois `ProspectContact` (table prospect_contacts)
 * et le fallback construit depuis `prospects.contact_*`.
 */
export interface MaskedDetectableContact {
  nom?: string | null
  prenom?: string | null
  email?: string | null
  telephone?: string | null
  email_is_pro?: boolean | null
  email_status?: string | null
}

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

/**
 * Patterns reconnus dans un email pour le qualifier de "masqué".
 * Toujours appliqués sur une version lowercase de l'email.
 */
const EMAIL_MASKED_PATTERNS = [
  '[masqué]',
  '[masque]',
  '_masque',
  'masque@',
  '@masque',
  'masked@',
  '@masked',
] as const

/**
 * Valeurs exactes (lowercase trim) qui qualifient un nom/prénom de masqué.
 */
const NAME_MASKED_VALUES = new Set([
  '[masqué]',
  '[masque]',
  'masqué',
  'masque',
  'masked',
  '[masked]',
  'rgpd',
  '[rgpd]',
])

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function isMaskedEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const lower = email.toLowerCase().trim()
  if (lower.length === 0) return false
  return EMAIL_MASKED_PATTERNS.some((p) => lower.includes(p))
}

function isMaskedName(value: string | null | undefined): boolean {
  if (!value) return false
  const lower = value.toLowerCase().trim()
  if (lower.length === 0) return false
  return NAME_MASKED_VALUES.has(lower)
}

// ------------------------------------------------------------
// API PUBLIQUE
// ------------------------------------------------------------

/**
 * Retourne `true` si le contact correspond à un placeholder masqué/RGPD
 * (donc inutilisable pour la prospection et bloquant pour la cascade).
 *
 * Cas couverts :
 *   1. Contact null/undefined → false (rien à filtrer)
 *   2. Email contient un marker `[Masqué]` / `_masque` / etc.
 *   3. Nom OU prénom égale exactement `[Masqué]` (variantes incluses)
 *   4. `email_is_pro === false` ET un email est présent (= email perso)
 *   5. `email_status === 'invalid'`
 *   6. AUCUN email ET AUCUN téléphone exploitables (contact vide utile)
 */
export function isMaskedContact(
  contact: MaskedDetectableContact | null | undefined,
): boolean {
  if (!contact) return false

  if (isMaskedEmail(contact.email)) return true
  if (isMaskedName(contact.nom)) return true
  if (isMaskedName(contact.prenom)) return true

  // Email perso explicitement marqué non-pro → on considère le contact
  // comme bloquant car la cascade ne l'écrasera pas (filtre email_is_pro).
  if (
    contact.email_is_pro === false &&
    typeof contact.email === 'string' &&
    contact.email.trim().length > 0
  ) {
    return true
  }

  if (contact.email_status === 'invalid') return true

  const hasUsableEmail =
    typeof contact.email === 'string' && contact.email.trim().length > 0
  const hasUsablePhone =
    typeof contact.telephone === 'string' && contact.telephone.trim().length > 0
  if (!hasUsableEmail && !hasUsablePhone) return true

  return false
}

/**
 * Retourne `true` si la liste de contacts ne comporte QUE des contacts
 * masqués (ou est vide avec des contacts masqués uniquement) — utile pour
 * décider du label du bouton UI ("Remplacer" vs "Chercher").
 */
export function hasOnlyMaskedContacts(
  contacts: ReadonlyArray<MaskedDetectableContact> | null | undefined,
): boolean {
  if (!contacts || contacts.length === 0) return false
  return contacts.every(isMaskedContact)
}

/**
 * Retourne `true` si AU MOINS un contact de la liste est masqué.
 */
export function hasAnyMaskedContact(
  contacts: ReadonlyArray<MaskedDetectableContact> | null | undefined,
): boolean {
  if (!contacts || contacts.length === 0) return false
  return contacts.some(isMaskedContact)
}
