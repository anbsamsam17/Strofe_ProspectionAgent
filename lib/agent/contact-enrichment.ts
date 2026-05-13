// ============================================================
// CONTACT ENRICHMENT — Agent IA Prospection Bilan Carbone
// Enrichissement des contacts prospects via APIs tierces
//
// Cascade (s'arrête dès qu'on a email + téléphone) :
//   1. API Recherche Entreprises (api.gouv.fr) — dirigeants (gratuit, illimité)
//   2. Pappers.fr — téléphone standard + site web (optionnel, désactivé si crédits épuisés)
//   3. Hunter.io Domain Search par company= — domaine + emails (si pas de domaine via Pappers)
//   4. Hunter.io Email Finder — email nominatif si nom connu + domaine validé
//   5. LinkedIn company URL (dernier recours, gratuit) — page entreprise pour
//      Sales Navigator manuel, uniquement si AUCUN contact direct trouvé
//
// Toutes les sources sont best-effort et silencieuses sur erreur.
// Fonctionne sans API keys (mode dégradé — retourne {} pour chaque prospect).
//
// Variables d'environnement (optionnelles) :
//   PAPPERS_API_KEY  — pappers.fr/api, crédits one-shot
//   HUNTER_API_KEY   — hunter.io, 50 crédits/mois gratuits
// ============================================================

import { findLinkedinCompanyUrl } from './linkedin-company'

// ------------------------------------------------------------
// TYPES
// ------------------------------------------------------------

export interface EnrichedContact {
  contact_nom?: string
  contact_prenom?: string
  contact_poste?: string
  contact_telephone?: string
  contact_email?: string
  contact_linkedin?: string
  /**
   * URL LinkedIn de la PAGE ENTREPRISE (linkedin.com/company/<slug>).
   * Distinct de `contact_linkedin` (profil personnel d'un dirigeant).
   * Renseigné par l'étape 5 quand aucun contact direct n'est trouvé,
   * pour que le consultant puisse rebondir via Sales Navigator manuel.
   */
  contact_linkedin_entreprise?: string
}

// ------------------------------------------------------------
// COMPTEUR DE CRÉDITS (mémoire module — warm instance Vercel)
// Réinitialisé à chaque cold start (déploiement ou instance expirée).
// Pour un suivi persistant, externaliser dans Redis.
// ------------------------------------------------------------

interface CreditCounter {
  used: number
  limit: number
  warnAt: number
}

const _credits: Record<'pappers' | 'hunter', CreditCounter> = {
  pappers: { used: 0, limit: 100, warnAt: 80 },
  hunter:  { used: 0, limit: 50,  warnAt: 40 },
}

/**
 * Flag de session : une fois que Pappers retourne HTTP 401 (crédits épuisés),
 * on désactive Pappers pour tous les appels suivants dans ce process.
 * Réinitialisé uniquement lors d'un cold start.
 */
let _pappersDisabled = false

/**
 * Incrémente le compteur et logge un warning si on approche de la limite.
 * Retourne false si la limite est atteinte (appel à bloquer).
 */
function consumeCredit(source: 'pappers' | 'hunter'): boolean {
  const counter = _credits[source]
  if (counter.used >= counter.limit) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: `Quota ${source} épuisé — enrichissement ignoré`,
        used: counter.used,
        limit: counter.limit,
      }),
    )
    return false
  }

  counter.used += 1

  if (counter.used >= counter.warnAt && counter.used < counter.limit) {
    const remaining = counter.limit - counter.used
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: `Quota ${source} : ${remaining} crédits restants sur ${counter.limit}`,
        used: counter.used,
        limit: counter.limit,
        remaining,
      }),
    )
  }

  return true
}

/** Expose les compteurs courants (pour logging dans l'orchestrateur) */
export function getCreditsUsed(): { pappers: number; hunter: number } {
  return {
    pappers: _credits.pappers.used,
    hunter:  _credits.hunter.used,
  }
}

// ------------------------------------------------------------
// HELPER : NETTOYAGE PRÉNOM
// Les sources externes (Recherche Entreprises, Pappers) retournent souvent
// plusieurs prénoms ("Jean-Marc Pierre", "MARIE SOPHIE") — on ne conserve
// que le premier token, proprement capitalisé.
// ------------------------------------------------------------

/**
 * Extrait le premier prénom propre d'une chaîne brute.
 *
 * Règles :
 *  - Trim + split sur whitespace puis sur tirets
 *  - Conserve le 1er token uniquement
 *  - Capitalise (1ère lettre majuscule, reste minuscule)
 *  - Retourne `undefined` si résultat < 2 caractères
 *
 * Exemples :
 *  - "Jean Marc"     → "Jean"
 *  - "Jean-Marc"     → "Jean"
 *  - "  jean  "      → "Jean"
 *  - "J"             → undefined
 *  - "MARIE SOPHIE"  → "Marie"
 *  - undefined       → undefined
 */
export function cleanFirstName(raw?: string): string | undefined {
  if (!raw) return undefined

  const trimmed = raw.trim()
  if (!trimmed) return undefined

  // Premier token sur whitespace puis sur tiret
  const firstSpaceToken = trimmed.split(/\s+/)[0] ?? ''
  const firstToken = firstSpaceToken.split('-')[0] ?? ''

  if (firstToken.length < 2) return undefined

  return firstToken.charAt(0).toUpperCase() + firstToken.slice(1).toLowerCase()
}

// ------------------------------------------------------------
// HELPER : NORMALISATION NOM ENTREPRISE
// Utilisé pour valider le match Hunter domain-search by company
// ------------------------------------------------------------

const LEGAL_FORMS = [
  'sas', 'sa', 'sarl', 'sasu', 'eurl', 'sci', 'sca', 'snc', 'scp',
  'sel', 'selarl', 'selas', 'selafa', 'selca',
  'gmbh', 'ltd', 'inc', 'llc', 'bv', 'nv', 'ag',
  'groupe', 'group', 'holding', 'france', 'international',
]

/**
 * Normalise un nom d'entreprise pour la comparaison :
 * - Minuscules
 * - Retire les accents
 * - Retire les formes juridiques courantes
 * - Retire la ponctuation
 * - Compacte les espaces multiples
 */
export function normalizeCompanyName(name: string): string {
  if (!name) return ''

  let normalized = name.toLowerCase()

  // Retire les accents
  normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // Retire les formes juridiques (entourées d'espace ou en début/fin)
  for (const form of LEGAL_FORMS) {
    normalized = normalized.replace(new RegExp(`\\b${form}\\b`, 'g'), ' ')
  }

  // Retire la ponctuation (sauf tirets internes)
  normalized = normalized.replace(/[^\w\s-]/g, ' ')

  // Compacte les espaces multiples
  normalized = normalized.replace(/\s+/g, ' ').trim()

  return normalized
}

/**
 * Calcule le score de similarité entre deux noms d'entreprises normalisés.
 * Retourne une valeur entre 0 et 1 (proportion de mots en commun / mots totaux union).
 */
function companySimilarityScore(a: string, b: string): number {
  if (!a || !b) return 0

  const wordsA = new Set(a.split(' ').filter(Boolean))
  const wordsB = new Set(b.split(' ').filter(Boolean))

  if (wordsA.size === 0 || wordsB.size === 0) return 0

  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)))
  const union = new Set([...wordsA, ...wordsB])

  return intersection.size / union.size
}

// ------------------------------------------------------------
// TYPES INTERNES API PAPPERS
// ------------------------------------------------------------

interface PappersRepresentant {
  qualite?: string
  nom?: string
  prenom?: string
  nom_complet?: string
  /** URL de profil LinkedIn (Pappers v2 — champ optionnel sur les dirigeants) */
  lien_linkedin?: string
}

interface PappersEntreprise {
  telephone?: string
  sites_internet?: string[]
  representants?: PappersRepresentant[]
}

// ------------------------------------------------------------
// TYPES INTERNES API RECHERCHE ENTREPRISES (api.gouv.fr)
// ------------------------------------------------------------

interface RechercheEntreprisesDirigeant {
  nom: string
  prenoms: string
  qualite: string
  type_dirigeant: string
}

interface RechercheEntreprisesResult {
  dirigeants?: RechercheEntreprisesDirigeant[]
}

interface RechercheEntreprisesResponse {
  results?: RechercheEntreprisesResult[]
  total_results?: number
}

// ------------------------------------------------------------
// TYPES INTERNES API HUNTER.IO
// ------------------------------------------------------------

interface HunterEmail {
  value?: string
  type?: string
  confidence?: number
  first_name?: string
  last_name?: string
  position?: string
  linkedin?: string
}

interface HunterDomainSearchResponse {
  data?: {
    emails?: HunterEmail[]
    domain?: string
    organization?: string
  }
}

interface HunterEmailFinderResponse {
  data?: {
    email?: string
    first_name?: string
    last_name?: string
    score?: number
  }
}

// ------------------------------------------------------------
// SOURCE 1 : API RECHERCHE ENTREPRISES (api.gouv.fr)
// Gratuit, illimité — retourne les dirigeants (personnes physiques)
// ------------------------------------------------------------

const QUALITES_PRIORITAIRES = ['président', 'directeur général', 'directeur general', 'gérant', 'gerant']

/**
 * Récupère les dirigeants (personnes physiques) depuis l'API Recherche Entreprises de l'État.
 * Priorise Président > Directeur Général > Gérant > premier dirigeant disponible.
 * Retourne null en cas d'erreur réseau ou si aucun dirigeant trouvé.
 */
async function fetchRechercheEntreprisesDirigeant(siren: string): Promise<{
  nom: string
  prenoms: string
  qualite: string
} | null> {
  const url = new URL('https://recherche-entreprises.api.gouv.fr/search')
  url.searchParams.set('q', siren)
  url.searchParams.set('per_page', '1')

  console.log(
    JSON.stringify({
      level: 'info',
      module: 'contact-enrichment',
      msg: `RechercheEntreprises: appel API pour SIREN ${siren}`,
      siren,
    }),
  )

  let response: Response
  try {
    response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: `RechercheEntreprises: erreur réseau pour SIREN ${siren}`,
        siren,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return null
  }

  if (!response.ok) {
    let errorBody = ''
    try { errorBody = await response.text() } catch { /* ignore */ }
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: `RechercheEntreprises: HTTP ${response.status} pour SIREN ${siren}`,
        siren,
        status: response.status,
        body: errorBody.slice(0, 200),
      }),
    )
    return null
  }

  let data: RechercheEntreprisesResponse
  try {
    data = (await response.json()) as RechercheEntreprisesResponse
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: `RechercheEntreprises: impossible de parser la réponse JSON pour SIREN ${siren}`,
        siren,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return null
  }

  const entreprise = data.results?.[0]
  if (!entreprise) {
    console.log(
      JSON.stringify({
        level: 'info',
        module: 'contact-enrichment',
        msg: `RechercheEntreprises: aucun résultat pour SIREN ${siren}`,
        siren,
      }),
    )
    return null
  }

  // Filtre uniquement les personnes physiques
  const personnesPhysiques = (entreprise.dirigeants ?? []).filter(
    (d) => d.type_dirigeant === 'personne physique' && d.nom?.trim(),
  )

  if (personnesPhysiques.length === 0) {
    console.log(
      JSON.stringify({
        level: 'info',
        module: 'contact-enrichment',
        msg: `RechercheEntreprises: aucune personne physique trouvée pour SIREN ${siren}`,
        siren,
        total_dirigeants: entreprise.dirigeants?.length ?? 0,
      }),
    )
    return null
  }

  // Priorise par qualité : Président > DG > Gérant > premier
  const dirigeant =
    personnesPhysiques.find((d) =>
      QUALITES_PRIORITAIRES.some((q) => d.qualite?.toLowerCase().includes(q)),
    ) ?? personnesPhysiques[0]

  console.log(
    JSON.stringify({
      level: 'info',
      module: 'contact-enrichment',
      msg: `RechercheEntreprises: dirigeant trouvé pour SIREN ${siren}`,
      siren,
      nom: dirigeant.nom,
      prenoms: dirigeant.prenoms,
      qualite: dirigeant.qualite,
      nb_personnes_physiques: personnesPhysiques.length,
    }),
  )

  return {
    nom: dirigeant.nom.trim(),
    prenoms: (dirigeant.prenoms ?? '').trim(),
    qualite: (dirigeant.qualite ?? '').trim(),
  }
}

// ------------------------------------------------------------
// SOURCE 2 : PAPPERS (OPTIONNELLE — désactivée si crédits épuisés)
// Téléphone standard + site web
// ------------------------------------------------------------

interface PappersResult {
  telephone?: string
  domain?: string
  contact_nom?: string
  contact_prenom?: string
  /** URL profil LinkedIn du dirigeant (champ Pappers v2 `lien_linkedin`) */
  lien_linkedin?: string
}

/**
 * Requête Pappers pour récupérer le téléphone standard, le site web et les dirigeants.
 * Détecte HTTP 401 comme "crédits épuisés" et désactive Pappers pour la session.
 * Retourne null si PAPPERS_API_KEY n'est pas configurée, crédits épuisés, ou en cas d'erreur.
 */
async function fetchPappers(siren: string): Promise<PappersResult | null> {
  const apiKey = process.env.PAPPERS_API_KEY
  if (!apiKey) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: 'Pappers: PAPPERS_API_KEY non configurée — enrichissement désactivé',
      }),
    )
    return null
  }

  if (_pappersDisabled) {
    console.log(
      JSON.stringify({
        level: 'info',
        module: 'contact-enrichment',
        msg: 'Pappers: désactivé pour cette session (crédits épuisés)',
        siren,
      }),
    )
    return null
  }

  if (!consumeCredit('pappers')) return null

  // BUG-FIX 2026-04-06 : Pappers exige "api_token" (pas "api_key")
  const url = new URL('https://api.pappers.fr/v2/entreprise')
  url.searchParams.set('siren', siren)
  url.searchParams.set('api_token', apiKey)

  console.log(
    JSON.stringify({
      level: 'info',
      module: 'contact-enrichment',
      msg: `Pappers: appel API pour SIREN ${siren}`,
      siren,
      url_path: '/v2/entreprise',
    }),
  )

  let response: Response
  try {
    response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: `Pappers: erreur réseau pour SIREN ${siren}`,
        siren,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return null
  }

  if (!response.ok) {
    let errorBody = ''
    try { errorBody = await response.text() } catch { /* ignore */ }

    // HTTP 401 = crédits épuisés → désactiver Pappers pour le reste de la session
    if (response.status === 401) {
      _pappersDisabled = true
      console.log(
        JSON.stringify({
          level: 'warn',
          module: 'contact-enrichment',
          msg: 'Pappers désactivé : crédits épuisés (HTTP 401)',
          siren,
          status: 401,
          body: errorBody.slice(0, 300),
        }),
      )
      return null
    }

    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: `Pappers: HTTP ${response.status} pour SIREN ${siren}`,
        siren,
        status: response.status,
        body: errorBody.slice(0, 300),
      }),
    )
    return null
  }

  let data: PappersEntreprise
  try {
    data = (await response.json()) as PappersEntreprise
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: `Pappers: impossible de parser la réponse JSON pour SIREN ${siren}`,
        siren,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return null
  }

  const result: PappersResult = {}

  // Téléphone standard
  if (data.telephone?.trim()) {
    result.telephone = data.telephone.trim()
  }

  // Site web → extraction du domaine pour Hunter.io
  const siteWeb = data.sites_internet?.[0]?.trim()
  if (siteWeb) {
    try {
      const normalized = siteWeb.startsWith('http') ? siteWeb : `https://${siteWeb}`
      const parsed = new URL(normalized)
      result.domain = parsed.hostname.replace(/^www\./, '')
    } catch {
      console.log(
        JSON.stringify({
          level: 'warn',
          module: 'contact-enrichment',
          msg: `Pappers: URL site web invalide pour SIREN ${siren}`,
          siren,
          site_web: siteWeb,
        }),
      )
    }
  }

  // Dirigeant (fallback si Recherche Entreprises n'a pas trouvé)
  const representants = data.representants ?? []
  const QUALITES_CIBLES = ['président', 'directeur général', 'directeur general', 'gérant', 'gerant']

  const dirigeant =
    representants.find((r) =>
      QUALITES_CIBLES.some((q) => r.qualite?.toLowerCase().includes(q)),
    ) ?? representants[0]

  if (dirigeant) {
    if (dirigeant.nom?.trim()) result.contact_nom = dirigeant.nom.trim()
    const cleanedPrenom = cleanFirstName(dirigeant.prenom)
    if (cleanedPrenom) result.contact_prenom = cleanedPrenom
    // LinkedIn dirigeant (Pappers v2 — meilleure source de vérité pour une personne nommée)
    if (dirigeant.lien_linkedin?.trim()) {
      result.lien_linkedin = dirigeant.lien_linkedin.trim()
    }
  }

  console.log(
    JSON.stringify({
      level: 'info',
      module: 'contact-enrichment',
      msg: `Pappers: réponse parsée pour SIREN ${siren}`,
      siren,
      telephone_found: Boolean(result.telephone),
      domain_found: Boolean(result.domain),
      domain: result.domain ?? null,
      dirigeant_found: Boolean(result.contact_nom),
      nom: result.contact_nom ?? null,
      prenom: result.contact_prenom ?? null,
      linkedin_found: Boolean(result.lien_linkedin),
      nb_representants: representants.length,
    }),
  )

  return result
}

// ------------------------------------------------------------
// SOURCE 3 : HUNTER.IO DOMAIN SEARCH PAR COMPANY NAME
// Domaine + emails (sans avoir besoin d'un domaine préalable)
// ------------------------------------------------------------

interface HunterDomainSearchResult {
  domain: string
  organization: string
  email?: string
  first_name?: string
  last_name?: string
  position?: string
  linkedin?: string
}

/**
 * Recherche des emails via Hunter.io Domain Search en utilisant le nom d'entreprise.
 * Valide que le résultat correspond bien à l'entreprise demandée (anti-mismatch).
 * Retourne null si HUNTER_API_KEY n'est pas configurée, si le résultat ne matche pas,
 * ou en cas d'erreur.
 */
async function fetchHunterDomainSearchByCompany(
  raisonSociale: string,
): Promise<HunterDomainSearchResult | null> {
  const apiKey = process.env.HUNTER_API_KEY
  if (!apiKey) return null

  if (!consumeCredit('hunter')) return null

  const url = new URL('https://api.hunter.io/v2/domain-search')
  url.searchParams.set('company', raisonSociale)
  url.searchParams.set('department', 'executive')
  url.searchParams.set('api_key', apiKey)

  console.log(
    JSON.stringify({
      level: 'info',
      module: 'contact-enrichment',
      msg: `Hunter domain-search (by company): appel API pour "${raisonSociale}"`,
      raison_sociale: raisonSociale,
    }),
  )

  let response: Response
  try {
    response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: `Hunter domain-search: erreur réseau pour company "${raisonSociale}"`,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return null
  }

  if (!response.ok) {
    let errorBody = ''
    try { errorBody = await response.text() } catch { /* ignore */ }
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: `Hunter domain-search: HTTP ${response.status} pour company "${raisonSociale}"`,
        raison_sociale: raisonSociale,
        status: response.status,
        body: errorBody.slice(0, 300),
      }),
    )
    return null
  }

  let data: HunterDomainSearchResponse
  try {
    data = (await response.json()) as HunterDomainSearchResponse
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: `Hunter domain-search: impossible de parser la réponse JSON pour "${raisonSociale}"`,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return null
  }

  const domain = data.data?.domain
  const organization = data.data?.organization ?? ''
  const emails = data.data?.emails ?? []

  if (!domain) {
    console.log(
      JSON.stringify({
        level: 'info',
        module: 'contact-enrichment',
        msg: `Hunter domain-search: aucun domaine retourné pour "${raisonSociale}"`,
        raison_sociale: raisonSociale,
      }),
    )
    return null
  }

  // Validation anti-mismatch : vérifier que l'organisation retournée correspond bien
  const orgNormalized = normalizeCompanyName(organization)
  const expectedNormalized = normalizeCompanyName(raisonSociale)

  const isContained = orgNormalized.includes(expectedNormalized) ||
    expectedNormalized.includes(orgNormalized)
  const similarity = companySimilarityScore(orgNormalized, expectedNormalized)
  const isValid = isContained || similarity >= 0.6

  if (!isValid) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: `Hunter: mismatch organization — résultat rejeté`,
        organization_reçu: organization,
        organization_normalisé: orgNormalized,
        attendu: raisonSociale,
        attendu_normalisé: expectedNormalized,
        similarity_score: Math.round(similarity * 100) / 100,
        domain_rejeté: domain,
      }),
    )
    return null
  }

  console.log(
    JSON.stringify({
      level: 'info',
      module: 'contact-enrichment',
      msg: `Hunter domain-search: domaine validé pour "${raisonSociale}"`,
      domain,
      organization,
      similarity_score: Math.round(similarity * 100) / 100,
      total_emails: emails.length,
      personal_emails: emails.filter((e) => e.type === 'personal').length,
    }),
  )

  // Meilleur email personnel avec confidence >= 60
  const best = emails
    .filter((e) => e.type === 'personal' && (e.confidence ?? 0) >= 60 && e.value)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0]

  if (!best?.value) {
    console.log(
      JSON.stringify({
        level: 'info',
        module: 'contact-enrichment',
        msg: `Hunter domain-search: aucun email personnel avec confidence >= 60 pour domaine ${domain}`,
        domain,
      }),
    )
    // Retourne quand même le domaine validé (utile pour email-finder)
    return {
      domain,
      organization,
    }
  }

  return {
    domain,
    organization,
    email: best.value,
    first_name: best.first_name ?? undefined,
    last_name: best.last_name ?? undefined,
    position: best.position ?? undefined,
    linkedin: best.linkedin ?? undefined,
  }
}

// ------------------------------------------------------------
// SOURCE 3-BIS : HUNTER.IO DOMAIN SEARCH PAR DOMAINE (legacy)
// Utilisé si on a un domaine depuis Pappers
// ------------------------------------------------------------

/**
 * Recherche des emails liés à un domaine connu via Hunter.io Domain Search.
 * Retourne le premier email de type "personal" avec confidence > 50.
 * Retourne null si HUNTER_API_KEY n'est pas configurée ou en cas d'erreur.
 */
async function fetchHunterDomainSearchByDomain(domain: string): Promise<{
  email?: string
  first_name?: string
  last_name?: string
  linkedin?: string
} | null> {
  const apiKey = process.env.HUNTER_API_KEY
  if (!apiKey) return null

  if (!consumeCredit('hunter')) return null

  const url = new URL('https://api.hunter.io/v2/domain-search')
  url.searchParams.set('domain', domain)
  url.searchParams.set('department', 'executive')
  url.searchParams.set('api_key', apiKey)

  let response: Response
  try {
    response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: `Hunter domain-search (by domain): erreur réseau pour domaine ${domain}`,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return null
  }

  if (!response.ok) {
    let errorBody = ''
    try { errorBody = await response.text() } catch { /* ignore */ }
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: `Hunter domain-search: HTTP ${response.status} pour domaine ${domain}`,
        domain,
        status: response.status,
        body: errorBody.slice(0, 300),
      }),
    )
    return null
  }

  let data: HunterDomainSearchResponse
  try {
    data = (await response.json()) as HunterDomainSearchResponse
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: `Hunter domain-search: impossible de parser la réponse JSON pour domaine ${domain}`,
        domain,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return null
  }

  const emails = data.data?.emails ?? []

  console.log(
    JSON.stringify({
      level: 'info',
      module: 'contact-enrichment',
      msg: `Hunter domain-search (by domain): ${emails.length} emails trouvés pour domaine ${domain}`,
      domain,
      total_emails: emails.length,
      personal_emails: emails.filter((e) => e.type === 'personal').length,
    }),
  )

  const best = emails
    .filter((e) => e.type === 'personal' && (e.confidence ?? 0) > 50 && e.value)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0]

  if (!best?.value) {
    console.log(
      JSON.stringify({
        level: 'info',
        module: 'contact-enrichment',
        msg: `Hunter domain-search: aucun email personnel avec confidence > 50 pour domaine ${domain}`,
        domain,
      }),
    )
    return null
  }

  return {
    email: best.value,
    first_name: best.first_name ?? undefined,
    last_name: best.last_name ?? undefined,
    linkedin: best.linkedin ?? undefined,
  }
}

// ------------------------------------------------------------
// SOURCE 4 : HUNTER.IO EMAIL FINDER
// Email nominatif quand on a prénom + nom + domaine validé
// ------------------------------------------------------------

/**
 * Trouve l'email d'une personne précise via Hunter.io Email Finder.
 * Nécessite un prénom, un nom et un domaine.
 * Retourne null si HUNTER_API_KEY n'est pas configurée, paramètres insuffisants,
 * ou si la confidence est trop faible (< 50).
 */
async function fetchHunterEmailFinder(
  domain: string,
  firstName: string,
  lastName: string,
): Promise<string | null> {
  const apiKey = process.env.HUNTER_API_KEY
  if (!apiKey) return null
  if (!domain || !firstName || !lastName) return null

  if (!consumeCredit('hunter')) return null

  const url = new URL('https://api.hunter.io/v2/email-finder')
  url.searchParams.set('domain', domain)
  url.searchParams.set('first_name', firstName)
  url.searchParams.set('last_name', lastName)
  url.searchParams.set('api_key', apiKey)

  console.log(
    JSON.stringify({
      level: 'info',
      module: 'contact-enrichment',
      msg: `Hunter email-finder: appel pour ${firstName} ${lastName} @ ${domain}`,
      domain,
      first_name: firstName,
      last_name: lastName,
    }),
  )

  let response: Response
  try {
    response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: `Hunter email-finder: erreur réseau pour ${firstName} ${lastName} @ ${domain}`,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return null
  }

  if (!response.ok) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: `Hunter email-finder: HTTP ${response.status} pour ${firstName} ${lastName} @ ${domain}`,
      }),
    )
    return null
  }

  let data: HunterEmailFinderResponse
  try {
    data = (await response.json()) as HunterEmailFinderResponse
  } catch {
    return null
  }

  const email = data.data?.email
  const score = data.data?.score ?? 0

  if (!email || score < 50) {
    console.log(
      JSON.stringify({
        level: 'info',
        module: 'contact-enrichment',
        msg: `Hunter email-finder: confiance insuffisante pour ${firstName} ${lastName} @ ${domain}`,
        score,
        threshold: 50,
        email_found: Boolean(email),
      }),
    )
    return null
  }

  return email
}

// ------------------------------------------------------------
// FONCTION PRINCIPALE
// ------------------------------------------------------------

/**
 * Enrichit les contacts d'un prospect via APIs tierces.
 *
 * Cascade :
 *   1. API Recherche Entreprises (gratuit, illimité) — dirigeants
 *   2. Pappers (optionnel, désactivé si HTTP 401) — téléphone + domaine
 *   3. Hunter domain-search by company — domaine validé + emails
 *   4. Hunter domain-search by domain — emails si domaine connu via Pappers
 *   5. Hunter email-finder — email nominatif si nom + domaine disponibles
 *
 * Règles :
 * - Ne remplace JAMAIS les champs déjà renseignés (données ADEME ou sourcing préexistantes).
 * - Retourne uniquement les champs NOUVEAUX à mettre à jour en DB.
 * - Toutes les sources sont best-effort : une erreur ne bloque pas les autres.
 * - Les appels sont séquentiels pour préserver les quotas gratuits.
 *
 * @param siren          - SIREN de l'entreprise (9 chiffres)
 * @param existingContact - Champs contact déjà renseignés (depuis ADEME ou sourcing)
 * @param raisonSociale  - Raison sociale (nécessaire pour Hunter company search)
 * @returns Champs contact NOUVEAUX uniquement (à merger en DB)
 */
export async function enrichirContact(
  siren: string,
  existingContact: Partial<EnrichedContact>,
  raisonSociale: string,
): Promise<Partial<EnrichedContact>> {
  // Validation SIREN
  if (!siren || !/^\d{9}$/.test(siren)) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: `enrichirContact: SIREN invalide "${siren}"`,
      }),
    )
    return {}
  }

  // Court-circuit : si on a déjà email ET téléphone, rien à enrichir
  if (existingContact.contact_email && existingContact.contact_telephone) {
    return {}
  }

  const hasHunterKey = Boolean(process.env.HUNTER_API_KEY)
  const hasPappersKey = Boolean(process.env.PAPPERS_API_KEY) && !_pappersDisabled

  console.log(
    JSON.stringify({
      level: 'info',
      module: 'contact-enrichment',
      msg: `enrichirContact: démarrage pour SIREN ${siren}`,
      siren,
      raison_sociale: raisonSociale,
      has_pappers_key: hasPappersKey,
      pappers_disabled: _pappersDisabled,
      has_hunter_key: hasHunterKey,
      already_has_email: Boolean(existingContact.contact_email),
      already_has_phone: Boolean(existingContact.contact_telephone),
      already_has_nom: Boolean(existingContact.contact_nom),
    }),
  )

  const result: Partial<EnrichedContact> = {}

  // Contexte courant (fusionné au fil de la cascade pour que les sources suivantes
  // bénéficient de ce que les précédentes ont trouvé)
  let resolvedNom    = existingContact.contact_nom
  let resolvedPrenom = existingContact.contact_prenom
  let resolvedEmail  = existingContact.contact_email
  let resolvedPhone  = existingContact.contact_telephone
  let resolvedDomain: string | undefined

  // --------------------------------------------------------
  // SOURCE 1 : API RECHERCHE ENTREPRISES (toujours appelée, gratuite)
  // Objectif : obtenir le nom du dirigeant pour cibler email-finder
  // --------------------------------------------------------
  if (!resolvedNom || !resolvedPrenom) {
    const dirigeant = await fetchRechercheEntreprisesDirigeant(siren)

    if (dirigeant) {
      if (!resolvedNom && dirigeant.nom) {
        result.contact_nom = dirigeant.nom
        resolvedNom = dirigeant.nom
      }
      if (!resolvedPrenom && dirigeant.prenoms) {
        // Dédup : on garde le 1er prénom propre (ex: "Jean-Marc Pierre" → "Jean")
        const cleaned = cleanFirstName(dirigeant.prenoms)
        if (cleaned) {
          result.contact_prenom = cleaned
          resolvedPrenom = cleaned
        }
      }
      if (!existingContact.contact_poste && !result.contact_poste && dirigeant.qualite) {
        result.contact_poste = dirigeant.qualite
      }
    }
  }

  // --------------------------------------------------------
  // SOURCE 2 : PAPPERS (optionnelle — si crédits disponibles)
  // Objectif : téléphone standard + domaine web
  // --------------------------------------------------------
  if (hasPappersKey && !resolvedPhone) {
    const pappers = await fetchPappers(siren)

    if (pappers) {
      if (!resolvedPhone && pappers.telephone) {
        result.contact_telephone = pappers.telephone
        resolvedPhone = pappers.telephone
      }

      // Dirigeant Pappers — fallback si Recherche Entreprises n'a rien trouvé
      if (!resolvedNom && pappers.contact_nom) {
        result.contact_nom = pappers.contact_nom
        resolvedNom = pappers.contact_nom
      }
      if (!resolvedPrenom && pappers.contact_prenom) {
        const cleaned = cleanFirstName(pappers.contact_prenom)
        if (cleaned) {
          result.contact_prenom = cleaned
          resolvedPrenom = cleaned
        }
      }

      // LinkedIn dirigeant — Pappers est prioritaire (source de vérité personne nommée).
      // Renseigné AVANT Hunter pour éviter d'être écrasé par un LinkedIn générique.
      if (!existingContact.contact_linkedin && !result.contact_linkedin && pappers.lien_linkedin) {
        result.contact_linkedin = pappers.lien_linkedin
      }

      // Domaine web (usage interne pour Hunter)
      resolvedDomain = pappers.domain
    }
  }

  // Court-circuit post-Pappers : email ET téléphone trouvés
  if (resolvedEmail && resolvedPhone) {
    logSummary(siren, result)
    return result
  }

  // --------------------------------------------------------
  // SOURCE 3A : HUNTER DOMAIN SEARCH PAR DOMAINE (si Pappers a fourni un domaine)
  // --------------------------------------------------------
  if (hasHunterKey && resolvedDomain && !resolvedEmail) {
    const hunterByDomain = await fetchHunterDomainSearchByDomain(resolvedDomain)

    if (hunterByDomain?.email) {
      result.contact_email = hunterByDomain.email
      resolvedEmail = hunterByDomain.email

      if (!resolvedNom && hunterByDomain.last_name) {
        result.contact_nom = hunterByDomain.last_name
        resolvedNom = hunterByDomain.last_name
      }
      if (!resolvedPrenom && hunterByDomain.first_name) {
        const cleaned = cleanFirstName(hunterByDomain.first_name)
        if (cleaned) {
          result.contact_prenom = cleaned
          resolvedPrenom = cleaned
        }
      }
      if (!existingContact.contact_linkedin && !result.contact_linkedin && hunterByDomain.linkedin) {
        result.contact_linkedin = hunterByDomain.linkedin
      }

      console.log(
        JSON.stringify({
          level: 'info',
          module: 'contact-enrichment',
          msg: `Hunter domain-search (by domain): email trouvé pour domaine ${resolvedDomain}`,
          siren,
          email_found: true,
        }),
      )
    }
  }

  // Court-circuit : email trouvé
  if (resolvedEmail) {
    logSummary(siren, result)
    return result
  }

  // --------------------------------------------------------
  // SOURCE 3B : HUNTER DOMAIN SEARCH PAR COMPANY NAME
  // Appelée si pas de domaine via Pappers ET pas encore d'email
  // --------------------------------------------------------
  if (hasHunterKey && !resolvedDomain && !resolvedEmail && raisonSociale) {
    const hunterByCompany = await fetchHunterDomainSearchByCompany(raisonSociale)

    if (hunterByCompany) {
      // Le domaine validé devient disponible pour email-finder
      resolvedDomain = hunterByCompany.domain

      if (hunterByCompany.email) {
        result.contact_email = hunterByCompany.email
        resolvedEmail = hunterByCompany.email

        // Enrichir prénom/nom depuis Hunter si absents
        if (!resolvedNom && hunterByCompany.last_name) {
          result.contact_nom = hunterByCompany.last_name
          resolvedNom = hunterByCompany.last_name
        }
        if (!resolvedPrenom && hunterByCompany.first_name) {
          const cleaned = cleanFirstName(hunterByCompany.first_name)
          if (cleaned) {
            result.contact_prenom = cleaned
            resolvedPrenom = cleaned
          }
        }
        if (!existingContact.contact_poste && !result.contact_poste && hunterByCompany.position) {
          result.contact_poste = hunterByCompany.position
        }
        if (!existingContact.contact_linkedin && !result.contact_linkedin && hunterByCompany.linkedin) {
          result.contact_linkedin = hunterByCompany.linkedin
        }

        console.log(
          JSON.stringify({
            level: 'info',
            module: 'contact-enrichment',
            msg: `Hunter domain-search (by company): email trouvé pour "${raisonSociale}"`,
            siren,
            domain: resolvedDomain,
            email_found: true,
          }),
        )
      }
    }
  }

  // Court-circuit : email trouvé
  if (resolvedEmail) {
    logSummary(siren, result)
    return result
  }

  // --------------------------------------------------------
  // SOURCE 4 : HUNTER EMAIL FINDER
  // Ciblage nominatif : uniquement si on a nom + prénom + domaine validé
  // --------------------------------------------------------
  if (
    hasHunterKey &&
    resolvedDomain &&
    resolvedPrenom &&
    resolvedNom &&
    !resolvedEmail
  ) {
    const hunterEmail = await fetchHunterEmailFinder(
      resolvedDomain,
      resolvedPrenom,
      resolvedNom,
    )

    if (hunterEmail) {
      result.contact_email = hunterEmail

      console.log(
        JSON.stringify({
          level: 'info',
          module: 'contact-enrichment',
          msg: `Hunter email-finder: email nominatif trouvé`,
          siren,
          prenom: resolvedPrenom,
          nom: resolvedNom,
          domain: resolvedDomain,
        }),
      )
    } else {
      console.log(
        JSON.stringify({
          level: 'info',
          module: 'contact-enrichment',
          msg: `Hunter email-finder: aucun email trouvé pour ${resolvedPrenom} ${resolvedNom} @ ${resolvedDomain}`,
          siren,
        }),
      )
    }
  } else if (hasHunterKey && !resolvedDomain) {
    console.log(
      JSON.stringify({
        level: 'info',
        module: 'contact-enrichment',
        msg: `Hunter: domaine introuvable pour SIREN ${siren} — email-finder ignoré`,
        siren,
        has_nom: Boolean(resolvedNom),
        has_prenom: Boolean(resolvedPrenom),
        raison_sociale: raisonSociale,
      }),
    )
  }

  // --------------------------------------------------------
  // SOURCE 5 (POST-CASCADE) : LINKEDIN PAGE ENTREPRISE
  // Dernier recours quand AUCUN canal de contact direct n'a été trouvé
  // (ni email, ni téléphone, ni LinkedIn dirigeant). On forge l'URL de
  // la page entreprise LinkedIn pour permettre au consultant de
  // chercher manuellement le bon contact via Sales Navigator.
  //
  // Conditions :
  //  - raisonSociale disponible (slug-builder)
  //  - pas de contact_linkedin_entreprise déjà renseigné (idempotence)
  //  - aucun contact direct (email, téléphone, LinkedIn perso) trouvé
  //    par les sources 1-4 ni dans existingContact
  //
  // Gratuit, pas de quota — mais respect d'un timeout court (3s) pour
  // ne pas allonger la phase d'enrichissement.
  // --------------------------------------------------------
  const hasNoDirectContact =
    !resolvedEmail &&
    !resolvedPhone &&
    !existingContact.contact_linkedin &&
    !result.contact_linkedin
  const alreadyHasEntrepriseUrl =
    Boolean(existingContact.contact_linkedin_entreprise) ||
    Boolean(result.contact_linkedin_entreprise)

  if (raisonSociale && hasNoDirectContact && !alreadyHasEntrepriseUrl) {
    const linkedinUrl = await findLinkedinCompanyUrl(raisonSociale)
    if (linkedinUrl) {
      result.contact_linkedin_entreprise = linkedinUrl
      console.log(
        JSON.stringify({
          level: 'info',
          module: 'contact-enrichment',
          msg: 'LinkedIn page entreprise trouvé (fallback Sales Nav)',
          siren,
        }),
      )
    }
  }

  logSummary(siren, result)
  return result
}

// ------------------------------------------------------------
// HELPER INTERNE : LOG DE RÉSUMÉ FINAL
// ------------------------------------------------------------

function logSummary(siren: string, result: Partial<EnrichedContact>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      module: 'contact-enrichment',
      msg: `enrichirContact: terminé`,
      siren,
      new_fields_count: Object.keys(result).length,
      new_fields: Object.keys(result),
      email_enriched: Boolean(result.contact_email),
      telephone_enriched: Boolean(result.contact_telephone),
      nom_enriched: Boolean(result.contact_nom),
      linkedin_enriched: Boolean(result.contact_linkedin),
      linkedin_entreprise_enriched: Boolean(result.contact_linkedin_entreprise),
    }),
  )
}
