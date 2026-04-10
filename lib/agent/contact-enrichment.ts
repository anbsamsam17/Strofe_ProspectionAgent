// ============================================================
// CONTACT ENRICHMENT — Agent IA Prospection Bilan Carbone
// Enrichissement des contacts prospects via APIs tierces
//
// Cascade (s'arrête dès qu'on a email + téléphone) :
//   1. ADEME (déjà fait dans sourcing — données pré-existantes)
//   2. Pappers.fr  — dirigeants + téléphone standard + site web
//   3. Hunter.io Domain Search  — emails par domaine
//   4. Hunter.io Email Finder   — email nominatif si on a un nom
//
// Toutes les sources sont best-effort et silencieuses sur erreur.
// Fonctionne sans API keys (mode dégradé — retourne {} pour chaque prospect).
//
// Variables d'environnement (optionnelles) :
//   PAPPERS_API_KEY  — pappers.fr/api, 100 crédits gratuits
//   HUNTER_API_KEY   — hunter.io, 50 crédits/mois gratuits
// ============================================================

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
// TYPES INTERNES API PAPPERS
// ------------------------------------------------------------

interface PappersRepresentant {
  qualite?: string
  nom?: string
  prenom?: string
  nom_complet?: string
}

interface PappersEntreprise {
  telephone?: string
  sites_internet?: string[]
  representants?: PappersRepresentant[]
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
}

interface HunterDomainSearchResponse {
  data?: {
    emails?: HunterEmail[]
    domain?: string
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
// SOURCE 1 : PAPPERS
// Dirigeants, téléphone standard, site web
// ------------------------------------------------------------

interface PappersResult {
  telephone?: string
  domain?: string
  contact_nom?: string
  contact_prenom?: string
}

/**
 * Requête Pappers pour récupérer les dirigeants, le téléphone standard et le site web.
 * Retourne null si PAPPERS_API_KEY n'est pas configurée ou en cas d'erreur.
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

  if (!consumeCredit('pappers')) return null

  // BUG-FIX 2026-04-06 : Pappers exige "api_token" (pas "api_key")
  // Preuve : réponse 401 "Veuillez indiquer votre api_token" avec api_key
  const url = new URL(`https://api.pappers.fr/v2/entreprise`)
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
      // Timeout explicite : AbortController pour éviter les requêtes pendantes
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
    // Lire le body pour donner un message d'erreur précis dans les logs
    let errorBody = ''
    try { errorBody = await response.text() } catch { /* ignore */ }
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
      // Normalise "www.exemple.fr" ou "https://www.exemple.fr" → "exemple.fr"
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

  // Dirigeant prioritaire : Président ou Directeur général
  const QUALITES_CIBLES = ['président', 'directeur général', 'directeur general', 'gérant', 'gerant']

  const representants = data.representants ?? []

  // Chercher en priorité Président/DG, sinon prendre le premier représentant
  const dirigeant =
    representants.find((r) =>
      QUALITES_CIBLES.some((q) => r.qualite?.toLowerCase().includes(q)),
    ) ?? representants[0]

  if (dirigeant) {
    if (dirigeant.nom?.trim()) result.contact_nom = dirigeant.nom.trim()
    if (dirigeant.prenom?.trim()) result.contact_prenom = dirigeant.prenom.trim()
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
      nb_representants: representants.length,
    }),
  )

  return result
}

// ------------------------------------------------------------
// SOURCE 2 : HUNTER.IO DOMAIN SEARCH
// Emails associés au domaine (département executive)
// ------------------------------------------------------------

/**
 * Recherche des emails liés à un domaine via Hunter.io Domain Search.
 * Retourne le premier email de type "personal" avec confidence > 50.
 * Retourne null si HUNTER_API_KEY n'est pas configurée ou en cas d'erreur.
 */
async function fetchHunterDomainSearch(domain: string): Promise<{
  email?: string
  first_name?: string
  last_name?: string
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
        msg: `Hunter domain-search: erreur réseau pour domaine ${domain}`,
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
      msg: `Hunter domain-search: ${emails.length} emails trouvés pour domaine ${domain}`,
      domain,
      total_emails: emails.length,
      personal_emails: emails.filter((e) => e.type === 'personal').length,
    }),
  )

  // Chercher le premier email personnel avec confidence > 50
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
  }
}

// ------------------------------------------------------------
// SOURCE 3 : HUNTER.IO EMAIL FINDER
// Email nominatif quand on a déjà prénom + nom + domaine
// ------------------------------------------------------------

/**
 * Trouve l'email d'une personne précise via Hunter.io Email Finder.
 * Nécessite un prénom, un nom et un domaine.
 * Retourne null si HUNTER_API_KEY n'est pas configurée, si les paramètres sont insuffisants,
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

  // Confiance insuffisante → on préfère ne pas retourner un email douteux
  if (!email || score < 50) return null

  return email
}

// ------------------------------------------------------------
// FONCTION PRINCIPALE
// ------------------------------------------------------------

/**
 * Enrichit les contacts d'un prospect via APIs tierces (Pappers + Hunter.io).
 * Cascade : ADEME (déjà fait dans sourcing) → Pappers → Hunter.io Domain Search → Hunter.io Email Finder
 *
 * Règles :
 * - Ne remplace JAMAIS les champs déjà renseignés (données ADEME ou sourcing préexistantes).
 * - Retourne uniquement les champs NOUVEAUX à mettre à jour en DB.
 * - Toutes les sources sont best-effort : une erreur ne bloque pas les autres.
 * - Les appels sont séquentiels (pas de parallélisme) pour préserver les quotas gratuits.
 * - Si PAPPERS_API_KEY et HUNTER_API_KEY sont absentes → retourne {} immédiatement.
 *
 * @param siren - SIREN de l'entreprise (9 chiffres)
 * @param existingContact - Champs contact déjà renseignés (depuis ADEME ou sourcing)
 * @returns Champs contact NOUVEAUX uniquement (à merger en DB)
 */
export async function enrichirContact(
  siren: string,
  existingContact: Partial<EnrichedContact>,
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

  // Court-circuit : aucune API key configurée → mode dégradé silencieux
  const hasPappersKey = Boolean(process.env.PAPPERS_API_KEY)
  const hasHunterKey  = Boolean(process.env.HUNTER_API_KEY)

  console.log(
    JSON.stringify({
      level: 'info',
      module: 'contact-enrichment',
      msg: `enrichirContact: démarrage pour SIREN ${siren}`,
      siren,
      has_pappers_key: hasPappersKey,
      has_hunter_key: hasHunterKey,
      already_has_email: Boolean(existingContact.contact_email),
      already_has_phone: Boolean(existingContact.contact_telephone),
      already_has_nom: Boolean(existingContact.contact_nom),
    }),
  )

  if (!hasPappersKey && !hasHunterKey) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'contact-enrichment',
        msg: 'enrichirContact: aucune API key configurée (PAPPERS_API_KEY, HUNTER_API_KEY) — enrichissement désactivé',
        siren,
      }),
    )
    return {}
  }

  const result: Partial<EnrichedContact> = {}

  // Contexte courant (fusionner avec ce qu'on trouve au fil de la cascade)
  // On maintient localement les valeurs pour que les sources suivantes
  // puissent s'appuyer sur ce que les précédentes ont trouvé.
  let resolvedNom    = existingContact.contact_nom
  let resolvedPrenom = existingContact.contact_prenom
  let resolvedEmail  = existingContact.contact_email
  let resolvedPhone  = existingContact.contact_telephone
  let resolvedDomain: string | undefined

  // --------------------------------------------------------
  // SOURCE 1 : PAPPERS
  // --------------------------------------------------------
  if (hasPappersKey && !(_credits.pappers.used >= _credits.pappers.limit)) {
    const pappers = await fetchPappers(siren)

    if (pappers) {
      // Téléphone : ne prend que si absent
      if (!resolvedPhone && pappers.telephone) {
        result.contact_telephone = pappers.telephone
        resolvedPhone = pappers.telephone
      }

      // Dirigeant : ne prend que les champs absents
      if (!resolvedNom && pappers.contact_nom) {
        result.contact_nom = pappers.contact_nom
        resolvedNom = pappers.contact_nom
      }
      if (!resolvedPrenom && pappers.contact_prenom) {
        result.contact_prenom = pappers.contact_prenom
        resolvedPrenom = pappers.contact_prenom
      }

      // Domaine pour Hunter (usage interne, non stocké directement)
      resolvedDomain = pappers.domain

      console.log(
        JSON.stringify({
          level: 'info',
          module: 'contact-enrichment',
          msg: `Pappers: enrichissement partiel pour SIREN ${siren}`,
          telephone_found: Boolean(pappers.telephone),
          domain_found: Boolean(pappers.domain),
          dirigeant_found: Boolean(pappers.contact_nom),
        }),
      )
    }
  }

  // Court-circuit post-Pappers : email ET téléphone trouvés
  if (resolvedEmail && resolvedPhone) return result

  // --------------------------------------------------------
  // SOURCE 2 : HUNTER.IO DOMAIN SEARCH
  // --------------------------------------------------------
  if (hasHunterKey && resolvedDomain && !resolvedEmail) {
    const hunterSearch = await fetchHunterDomainSearch(resolvedDomain)

    if (hunterSearch?.email) {
      result.contact_email = hunterSearch.email
      resolvedEmail = hunterSearch.email

      // Renseigner prénom/nom si trouvés par Hunter et absents
      if (!resolvedNom && hunterSearch.last_name) {
        result.contact_nom = hunterSearch.last_name
        resolvedNom = hunterSearch.last_name
      }
      if (!resolvedPrenom && hunterSearch.first_name) {
        result.contact_prenom = hunterSearch.first_name
        resolvedPrenom = hunterSearch.first_name
      }

      console.log(
        JSON.stringify({
          level: 'info',
          module: 'contact-enrichment',
          msg: `Hunter domain-search: email trouvé pour domaine ${resolvedDomain}`,
          siren,
          email_found: true,
        }),
      )
    }
  }

  // Court-circuit : email trouvé
  if (resolvedEmail) return result

  // --------------------------------------------------------
  // SOURCE 3 : HUNTER.IO EMAIL FINDER
  // Uniquement si on a un nom (Pappers ou ADEME) mais pas encore d'email
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
        msg: `Hunter: domaine introuvable pour SIREN ${siren} — Hunter domain-search et email-finder ignorés`,
        siren,
        has_nom: Boolean(resolvedNom),
        has_prenom: Boolean(resolvedPrenom),
      }),
    )
  }

  // Log de résumé final
  console.log(
    JSON.stringify({
      level: 'info',
      module: 'contact-enrichment',
      msg: `enrichirContact: terminé pour SIREN ${siren}`,
      siren,
      new_fields_count: Object.keys(result).length,
      new_fields: Object.keys(result),
      email_enriched: Boolean(result.contact_email),
      telephone_enriched: Boolean(result.contact_telephone),
      nom_enriched: Boolean(result.contact_nom),
    }),
  )

  return result
}
