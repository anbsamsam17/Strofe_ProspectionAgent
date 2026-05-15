// ============================================================
// EMAIL IS PRO — Agent IA Prospection Bilan Carbone
//
// Détermine si un email appartient à un domaine professionnel (entreprise)
// ou à un service grand public / disposable (gmail, yahoo, mailinator, etc.).
//
// Utilisé par l'enrichissement v2 pour piloter `prospect_contacts.email_is_pro`
// (voir migration 015) — on filtre les emails free-mail du flux de prospection
// car ils signalent un contact personnel non décisionnaire en B2B.
//
// Conventions :
//   - FREE_EMAIL_DOMAINS est ReadonlySet<string> — verrouillé en mutation.
//   - Comparaisons en lowercase systématique (insensibles à la casse).
//   - Inputs invalides (null/undefined/vide/sans @) → false / null, pas throw.
// ============================================================

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

/**
 * Liste des domaines grand public et disposable à exclure du flux de prospection.
 *
 * Source : combinaison des FAI/webmails grand public français + principaux acteurs
 * internationaux + plateformes "throw-away" connues.
 *
 * À jour 2026-05-15. Si un cas remonte du terrain (false positive), l'ajouter ici
 * et ouvrir une entry dans memory/hindsight.md.
 */
export const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  // Webmails globaux
  'gmail.com', 'googlemail.com',
  'hotmail.com', 'hotmail.fr',
  'outlook.com', 'outlook.fr',
  'yahoo.com', 'yahoo.fr', 'ymail.com',
  'live.fr', 'live.com',
  'icloud.com', 'me.com',
  'aol.com', 'aol.fr',
  'protonmail.com', 'pm.me',
  'gmx.fr', 'gmx.com',

  // FAI / webmails français
  'orange.fr', 'wanadoo.fr',
  'free.fr',
  'laposte.net',
  'sfr.fr', 'neuf.fr',
  'bbox.fr',

  // Disposable / throw-away
  'mailinator.com', '10minutemail.com', 'guerrillamail.com',
  'tempmail.com', 'throwaway.email',
])

// ------------------------------------------------------------
// API PUBLIQUE
// ------------------------------------------------------------

/**
 * Extrait le domaine d'un email, normalisé en lowercase.
 *
 *   'JEAN@Acme.FR'      → 'acme.fr'
 *   'a@b'               → 'b'
 *   'pas-un-email'      → null
 *   '@no-local.fr'      → null (partie locale vide)
 *   'jean@'             → null (partie domaine vide)
 *   null / undefined / '' → null
 */
export function extractDomain(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null
  const trimmed = email.trim()
  if (!trimmed) return null

  const atIndex = trimmed.lastIndexOf('@')
  if (atIndex <= 0) return null // pas de @, ou @ en première position (local vide)

  const domain = trimmed.slice(atIndex + 1).toLowerCase()
  if (!domain) return null

  return domain
}

/**
 * Retourne `true` si l'email cible un domaine professionnel
 * (= pas dans la liste FREE_EMAIL_DOMAINS).
 *
 * Inputs invalides (null, undefined, vide, sans @, format cassé) → `false`
 * (on ne considère pas un email illisible comme un email pro valide).
 */
export function isProfessionalEmail(email: string | null | undefined): boolean {
  const domain = extractDomain(email)
  if (!domain) return false
  return !FREE_EMAIL_DOMAINS.has(domain)
}
