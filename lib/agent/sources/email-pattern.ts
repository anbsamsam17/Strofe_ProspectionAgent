// ============================================================
// SOURCE — Email Pattern Generator (FR)
// Pure compute, déterministe, gratuit.
//
// À partir de (prenom, nom, domain), génère les emails candidats
// selon les 7 patterns statistiquement dominants en France B2B
// (~95% de couverture observée sur PME/ETI).
//
// Utilisé par contact-enrichment.ts en fallback si Hunter.io ne
// retourne pas de pattern connu pour le domaine.
// ============================================================

// ------------------------------------------------------------
// TYPES
// ------------------------------------------------------------

export type PatternName =
  | 'prenom.nom'
  | 'pnom'
  | 'prenom'
  | 'nom.prenom'
  | 'prenom_nom'
  | 'prenomnom'
  | 'p.nom'

export interface EmailCandidate {
  email: string
  pattern: PatternName
  /** Fréquence statistique FR en % (utilisé pour le scoring). */
  frequency: number
}

// ------------------------------------------------------------
// CONSTANTES — fréquences statistiques observées (PME FR B2B)
// Total ~95% : les 5% restants couvrent des patterns custom
// (alias, initiales doubles, prénoms multiples, etc.).
// ------------------------------------------------------------

const PATTERN_FREQUENCIES: ReadonlyArray<{
  name: PatternName
  frequency: number
  build: (first: string, last: string, firstInitial: string) => string
}> = [
  { name: 'prenom.nom', frequency: 47, build: (f, l) => `${f}.${l}` },
  { name: 'pnom', frequency: 20, build: (_f, l, fi) => `${fi}${l}` },
  { name: 'prenom', frequency: 15, build: (f) => `${f}` },
  { name: 'prenomnom', frequency: 6, build: (f, l) => `${f}${l}` },
  { name: 'nom.prenom', frequency: 5, build: (f, l) => `${l}.${f}` },
  { name: 'prenom_nom', frequency: 4, build: (f, l) => `${f}_${l}` },
  { name: 'p.nom', frequency: 4, build: (_f, l, fi) => `${fi}.${l}` },
]

// Patterns Hunter.io supportés (cf. https://hunter.io docs).
// Chaque entrée mappe un template Hunter vers une fonction de build.
const HUNTER_PATTERNS: ReadonlyArray<{
  template: string
  build: (first: string, last: string, firstInitial: string, lastInitial: string) => string
}> = [
  { template: '{first}.{last}', build: (f, l) => `${f}.${l}` },
  { template: '{first}_{last}', build: (f, l) => `${f}_${l}` },
  { template: '{first}-{last}', build: (f, l) => `${f}-${l}` },
  { template: '{first}{last}', build: (f, l) => `${f}${l}` },
  { template: '{last}.{first}', build: (f, l) => `${l}.${f}` },
  { template: '{last}_{first}', build: (f, l) => `${l}_${f}` },
  { template: '{last}{first}', build: (f, l) => `${l}${f}` },
  { template: '{first}', build: (f) => f },
  { template: '{last}', build: (_f, l) => l },
  { template: '{f}{last}', build: (_f, l, fi) => `${fi}${l}` },
  { template: '{f}.{last}', build: (_f, l, fi) => `${fi}.${l}` },
  { template: '{f}_{last}', build: (_f, l, fi) => `${fi}_${l}` },
  { template: '{f}-{last}', build: (_f, l, fi) => `${fi}-${l}` },
  { template: '{first}{l}', build: (f, _l, _fi, li) => `${f}${li}` },
  { template: '{first}.{l}', build: (f, _l, _fi, li) => `${f}.${li}` },
  { template: '{f}{l}', build: (_f, _l, fi, li) => `${fi}${li}` },
  { template: '{f}.{l}', build: (_f, _l, fi, li) => `${fi}.${li}` },
]

// ------------------------------------------------------------
// NORMALISATION
// ------------------------------------------------------------

/**
 * Normalise un nom : strip accents (NFD), lowercase, retire
 * ponctuation/espaces/tirets/apostrophes.
 * Exporté pour tests + réutilisation.
 */
export function normalizeName(name: string): string {
  if (!name) return ''
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // strip diacritiques (Unicode property)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // retire tout sauf alphanumérique
    .trim()
}

/**
 * Normalise un domain : strip protocole, www., lowercase, trim.
 * Retourne '' si invalide (pas de point, vide, …).
 */
function normalizeDomain(domain: string): string {
  if (!domain) return ''
  const cleaned = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '') // strip path
    .replace(/:\d+$/, '') // strip port

  // Validation minimale : au moins un point et caractères valides
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleaned)) return ''
  return cleaned
}

// ------------------------------------------------------------
// API PUBLIQUE
// ------------------------------------------------------------

/**
 * Pour un prénom composé ('Jean-Pierre', 'Marie Claire'), retourne
 * [prenom_complet_normalisé, prenom_court_normalisé].
 * Pour un prénom simple, retourne juste [prenom_normalisé].
 * Les variantes sont dédupliquées.
 */
function firstNameVariants(firstName: string): string[] {
  if (!firstName) return []
  const full = normalizeName(firstName)
  if (!full) return []

  // Détecte un séparateur (tiret, espace, apostrophe) AVANT normalisation
  const hasSplit = /[\s\-'’]/.test(firstName.trim())
  if (!hasSplit) return [full]

  // Première sous-chaîne : avant le premier séparateur
  const shortRaw = firstName.trim().split(/[\s\-'’]+/)[0]
  const short = normalizeName(shortRaw)
  if (!short || short === full) return [full]
  return [full, short]
}

/**
 * Génère les emails candidats pour un dirigeant + domain.
 * Ordonnés par fréquence statistique décroissante.
 * Inputs vides ou domain invalide → retourne [].
 *
 * Pour les prénoms composés (ex. 'Jean-Pierre'), inclut à la fois
 * les variantes avec le prénom complet ('jeanpierre') et le prénom
 * court ('jean'). Les doublons sont éliminés.
 */
export function generateEmailCandidates(
  firstName: string,
  lastName: string,
  domain: string,
): EmailCandidate[] {
  const firstVariants = firstNameVariants(firstName)
  const last = normalizeName(lastName)
  const cleanDomain = normalizeDomain(domain)

  if (firstVariants.length === 0 || !last || !cleanDomain) return []

  const candidates: EmailCandidate[] = []
  const seen = new Set<string>()

  for (const first of firstVariants) {
    const firstInitial = first.charAt(0)
    for (const { name, frequency, build } of PATTERN_FREQUENCIES) {
      const local = build(first, last, firstInitial)
      if (!local) continue
      const email = `${local}@${cleanDomain}`
      if (seen.has(email)) continue
      seen.add(email)
      candidates.push({ email, pattern: name, frequency })
    }
  }

  // Tri stable par frequency décroissante.
  return candidates.sort((a, b) => b.frequency - a.frequency)
}

/**
 * Si Hunter (ou autre source) retourne un pattern connu de l'organisation,
 * cette fonction génère UN seul email selon le pattern donné.
 * Inputs : pattern Hunter au format {first}.{last}@... etc.
 * Retourne null si pattern non reconnu.
 */
export function applyKnownPattern(
  hunterPattern: string,
  firstName: string,
  lastName: string,
  domain: string,
): string | null {
  if (!hunterPattern) return null

  const first = normalizeName(firstName)
  const last = normalizeName(lastName)
  const cleanDomain = normalizeDomain(domain)

  if (!first || !last || !cleanDomain) return null

  const firstInitial = first.charAt(0)
  const lastInitial = last.charAt(0)

  // Strip éventuel @domain dans le pattern Hunter (parfois "{first}.{last}@example.com")
  const template = hunterPattern.trim().toLowerCase().split('@')[0]

  const match = HUNTER_PATTERNS.find((p) => p.template === template)
  if (!match) return null

  const local = match.build(first, last, firstInitial, lastInitial)
  if (!local) return null

  return `${local}@${cleanDomain}`
}
