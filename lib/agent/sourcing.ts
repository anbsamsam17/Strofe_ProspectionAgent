// ============================================================
// SOURCING — Agent IA Prospection Bilan Carbone
// Source : API Sirene INSEE v3.11 + ADEME BEGES (Data Fair)
// ============================================================

import type {
  Prospect,
  SireneEtablissement,
  SireneResponse,
} from '@/lib/types'

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

// Depuis sept. 2025, l'INSEE a remplacé OAuth2 (client_id/secret) par une API Key simple.
// Anciens endpoints (MORTS) : portail-api.insee.fr/token, portail-api.insee.fr/entreprises/sirene/V3.11/siret
const INSEE_SIRET_URL = 'https://api.insee.fr/api-sirene/3.11/siret'

// BUG-01 FIX : l'ancien endpoint CKAN (data.ademe.fr/api/3/action/datastore_search) est mort.
// Nouvel endpoint : API Data Fair (v1), recherche full-text par SIREN.
const ADEME_BEGES_URL = 'https://data.ademe.fr/data-fair/api/v1/datasets/bilan-ges/lines'

// Codes NAF prioritaires (viticulture, aéro, logistique, agro-alimentaire, industrie + secteurs élargis)
const NAF_PRIORITAIRES = [
  '01.21Z', '01.22Z',        // Viticulture
  '30.30Z',                  // Construction aéronautique
  '52.10B', '52.29A',        // Logistique / entreposage
  '10.11Z', '10.13A', '10.32Z', '10.51A', '10.71A', // Agro-alimentaire
  '46.17B',                  // Commerce intermédiaire agro
  '49.41A', '49.41B', '52.21Z', // Transport routier / services annexes
  // Secteurs élargis — pertinents pour le bilan carbone
  '20.11Z', '20.14Z', '20.15Z', // Industrie chimique
  '23.11Z', '23.13Z',        // Verre et produits en verre
  '24.10Z', '24.20Z',        // Sidérurgie / tubes acier
  '25.11Z', '25.29Z',        // Fabrication structures métalliques
  '28.11Z', '28.15Z',        // Fabrication moteurs / engrenages
  '35.11Z', '35.14Z',        // Production / commerce d'électricité
  '38.11Z', '38.21Z',        // Collecte / traitement des déchets
  '41.20A', '41.20B',        // Construction de bâtiments
  '42.11Z', '42.13A',        // Construction routes / ponts
  '43.21A', '43.22A',        // Travaux d'installation
  '46.71Z', '46.72Z',        // Commerce gros combustibles / métaux
  '47.30Z',                  // Commerce carburants
  '55.10Z',                  // Hôtels
  '56.10A',                  // Restauration
  '86.10Z',                  // Activités hospitalières
]

// Max 30 req/min sur Sirene → délai entre les pages
const SIRENE_DELAY_MS = 2_100   // ~28 req/min avec marge de sécurité
const RETRY_ATTEMPTS = 2
const RETRY_DELAY_MS = 1_000

// Tranches d'effectifs INSEE correspondant à >= 50 salariés (21 = 50-99, 53 = 10 000+)
// On cible tranche >= 21 pour avoir 50+ salariés : les 200+ ont une obligation BEGES légale,
// mais les 50-199 sont des cibles pertinentes pour une démarche volontaire.
const TRANCHE_MIN = '21'
const TRANCHE_MAX = '53'

// Département Gironde
const CODE_POSTAL_QUERY = 'codePostalEtablissement:[33000 TO 33999]'

// ------------------------------------------------------------
// TYPES INTERNES
// ------------------------------------------------------------

export interface SourcingOptions {
  /** Nombre maximum d'établissements à ramener (par défaut : 200) */
  maxResults?: number
  /** Codes NAF à cibler — si vide, utilise NAF_PRIORITAIRES */
  nafCodes?: string[]
  /** Code postal min/max sous forme "[33000 TO 33999]" */
  codePostalRange?: string
  /** SIREN déjà en base à exclure des résultats (déduplication en amont du sourcing) */
  excludeSirens?: Set<string>
}

/**
 * Type local représentant un record ADEME BEGES renvoyé par l'API Data Fair.
 * Les champs correspondent à l'API : https://data.ademe.fr/data-fair/api/v1/datasets/bilan-ges/lines
 * Ce type est plus riche que l'interface AdemeBeges de types.ts (qui reste la surface publique).
 */
interface AdemeBegesDataFairRecord {
  siren_principal: string
  raison_sociale: string
  annee_de_reporting: number
  date_de_publication: string
  courriel?: string
  responsable_du_suivi?: string
  fonction?: string
  id: string
  structure_obligee?: string
}

/**
 * Type enrichi pour usage interne : contient les champs supplémentaires
 * renvoyés par l'API Data Fair (contact, URL bilan, validité).
 */
interface AdemeBegesEnrichi {
  siren: string
  raison_sociale: string
  annee_reporting: number
  date_publication: string
  url_bilan: string
  /** Responsable du suivi BEGES (contact ADEME) */
  responsable_du_suivi?: string
  /** Poste / fonction du responsable */
  fonction?: string
  /** Email du responsable */
  courriel?: string
}


// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

/** Pause utilitaire pour respecter les rate limits */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Exécute un fetch avec retry automatique sur erreur réseau.
 * Ne retry PAS sur les erreurs HTTP 4xx (erreurs client).
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  attempts = RETRY_ATTEMPTS,
): Promise<Response> {
  let lastError: unknown

  for (let attempt = 0; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, options)

      // Ne pas retry sur 4xx (erreur client, pas réseau)
      if (response.status >= 400 && response.status < 500) {
        return response
      }

      // Retry sur 5xx
      if (response.status >= 500 && attempt < attempts) {
        console.log(
          JSON.stringify({
            level: 'warn',
            module: 'sourcing',
            msg: `HTTP ${response.status} sur ${url} — tentative ${attempt + 1}/${attempts + 1}`,
          }),
        )
        await sleep(RETRY_DELAY_MS * (attempt + 1))
        continue
      }

      return response
    } catch (err) {
      lastError = err
      if (attempt < attempts) {
        console.log(
          JSON.stringify({
            level: 'warn',
            module: 'sourcing',
            msg: `Erreur réseau sur ${url} — tentative ${attempt + 1}/${attempts + 1}`,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
        await sleep(RETRY_DELAY_MS * (attempt + 1))
      }
    }
  }

  throw new Error(
    `fetchWithRetry: échec après ${attempts + 1} tentatives sur ${url}. Dernière erreur: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  )
}

// ------------------------------------------------------------
// API KEY INSEE (depuis sept. 2025 — remplace OAuth2)
// ------------------------------------------------------------

/**
 * Retourne la clé API INSEE depuis les variables d'environnement.
 * Depuis sept. 2025, l'INSEE utilise une API Key simple au lieu d'OAuth2.
 * La clé se génère sur https://portail-api.insee.fr/ → Applications → API Key.
 */
export function getInseeApiKey(): string {
  const apiKey = process.env.INSEE_API_KEY
  if (!apiKey) {
    throw new Error(
      'getInseeApiKey: INSEE_API_KEY est requis. Générez-la sur https://portail-api.insee.fr/',
    )
  }
  return apiKey
}

// ------------------------------------------------------------
// SOURCING SIRENE
// ------------------------------------------------------------

/**
 * Source les établissements français (Gironde, effectifs ≥ 200)
 * depuis l'API Sirene INSEE v3.11, avec pagination automatique.
 */
export async function sourcerEntreprises(
  options: SourcingOptions = {},
): Promise<SireneEtablissement[]> {
  const {
    maxResults = 200,
    nafCodes = NAF_PRIORITAIRES,
    codePostalRange = CODE_POSTAL_QUERY,
  } = options

  const apiKey = getInseeApiKey()

  // Construction du filtre Lucene
  // L'API Sirene utilise les codes NAF sans point (ex: "4941A" et non "49.41A").
  // On retire le point via replace — mais String.replace() ne remplace que la PREMIÈRE occurrence.
  // "01.21Z" → "0121Z" (correct). Pas de second point dans un code NAF valide.
  // IMPORTANT : si nafCodes est vide après nettoyage, ne PAS inclure le filtre NAF
  // pour éviter un filtre Lucene malformé "activitePrincipaleEtablissement:()" → HTTP 400.
  const cleanedNafCodes = nafCodes
    .map((c) => c.replace('.', '').trim().toUpperCase())
    .filter((c) => c.length > 0)

  const queryParts: string[] = [
    codePostalRange,
    `trancheEffectifsEtablissement:[${TRANCHE_MIN} TO ${TRANCHE_MAX}]`,
    'etatAdministratifEtablissement:A',
  ]

  // N'ajouter le filtre NAF que si la liste est non vide — sinon on cible tous les secteurs
  if (cleanedNafCodes.length > 0) {
    queryParts.push(`activitePrincipaleEtablissement:(${cleanedNafCodes.join(' ')})`)
  }

  const query = queryParts.join(' AND ')

  const allEtablissements: SireneEtablissement[] = []
  const pageSize = 100
  let debut = 0
  let totalAvailable = Infinity

  while (allEtablissements.length < maxResults && debut < totalAvailable) {
    const url = new URL(INSEE_SIRET_URL)
    url.searchParams.set('q', query)
    url.searchParams.set('nombre', String(pageSize))
    url.searchParams.set('debut', String(debut))

    let response: Response
    try {
      response = await fetchWithRetry(url.toString(), {
        headers: {
          'X-INSEE-Api-Key-Integration': apiKey,
          Accept: 'application/json',
        },
      })
    } catch (err) {
      console.log(
        JSON.stringify({
          level: 'error',
          module: 'sourcing',
          msg: `Erreur réseau Sirene page debut=${debut}`,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
      // Arrêter la pagination sur erreur fatale — renvoyer ce qu'on a déjà
      break
    }

    if (response.status === 404) {
      // 404 = aucun résultat pour ce filtre
      break
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      console.log(
        JSON.stringify({
          level: 'error',
          module: 'sourcing',
          msg: `Sirene HTTP ${response.status} sur page debut=${debut}`,
          body,
        }),
      )
      break
    }

    const data = (await response.json()) as SireneResponse

    // Mettre à jour le total disponible depuis le header de la réponse
    totalAvailable = data.header?.total ?? 0

    const etablissements = data.etablissements ?? []
    allEtablissements.push(...etablissements)

    console.log(
      JSON.stringify({
        level: 'info',
        module: 'sourcing',
        msg: `Sirene page chargée`,
        debut,
        nombre: etablissements.length,
        total: totalAvailable,
        cumul: allEtablissements.length,
      }),
    )

    // Pas d'autres résultats
    if (etablissements.length < pageSize) {
      break
    }

    debut += pageSize

    // Respecter le rate limit Sirene (30 req/min max)
    if (debut < totalAvailable && allEtablissements.length < maxResults) {
      await sleep(SIRENE_DELAY_MS)
    }
  }

  return allEtablissements.slice(0, maxResults)
}

// ------------------------------------------------------------
// FALLBACK : API Recherche Entreprises (data.gouv.fr — open data, sans clé)
// Utilisée quand l'API Sirene INSEE est indisponible ou que la clé est invalide.
// ------------------------------------------------------------

const RECHERCHE_ENTREPRISES_URL = 'https://recherche-entreprises.api.gouv.fr/search'

interface RechercheEntreprisesResult {
  siren: string
  nom_complet: string
  nom_raison_sociale: string
  siege: {
    siret: string
    activite_principale: string
    code_postal: string
    libelle_commune: string
    adresse: string
    tranche_effectif_salarie: string
    annee_tranche_effectif_salarie: string
    etat_administratif: string
  }
  activite_principale: string
  tranche_effectif_salarie: string
  etat_administratif: string
}

/**
 * Sourcing fallback via l'API Recherche Entreprises (open data, pas de clé).
 * Convertit les résultats au format SireneEtablissement pour compatibilité.
 *
 * Pagination : parcourt TOUTES les pages disponibles pour chaque code NAF,
 * avec un guard de MAX_PAGES_PER_NAF pour éviter les boucles infinies.
 * Déduplication en amont : les SIREN présents dans options.excludeSirens sont
 * skippés immédiatement sans attendre la phase de déduplication de l'orchestrateur.
 */
export async function sourcerEntreprisesFallback(
  options: SourcingOptions = {},
): Promise<SireneEtablissement[]> {
  const { maxResults = 200, nafCodes = NAF_PRIORITAIRES, excludeSirens } = options

  const allEtablissements: SireneEtablissement[] = []
  const perPage = 25 // max par page de cette API
  const MAX_PAGES_PER_NAF = 10 // guard anti-boucle infinie

  // L'API recherche-entreprises utilise le format NAF AVEC point (49.41A, pas 4941A).
  for (const naf of nafCodes) {
    if (allEtablissements.length >= maxResults) break

    let page = 1
    let hasMore = true

    while (hasMore && allEtablissements.length < maxResults && page <= MAX_PAGES_PER_NAF) {
      const url = new URL(RECHERCHE_ENTREPRISES_URL)
      url.searchParams.set('activite_principale', naf)
      url.searchParams.set('departement', '33')
      // Tranches 21+ = 50 salariés et plus (élargi depuis 31+ = 200+)
      url.searchParams.set('tranche_effectif_salarie', '21,22,31,32,41,42,51,52,53')
      url.searchParams.set('etat_administratif', 'A')
      url.searchParams.set('per_page', String(perPage))
      url.searchParams.set('page', String(page))

      let response: Response
      try {
        response = await fetchWithRetry(url.toString(), {
          headers: { Accept: 'application/json' },
        })
      } catch (err) {
        console.log(JSON.stringify({
          level: 'warn',
          module: 'sourcing',
          msg: `Recherche Entreprises fallback: erreur réseau pour NAF ${naf} page ${page}`,
          error: err instanceof Error ? err.message : String(err),
        }))
        break // Arrêter la pagination pour ce NAF sur erreur réseau
      }

      if (!response.ok) break

      let data: { results?: RechercheEntreprisesResult[] }
      try {
        data = await response.json()
      } catch {
        break
      }

      const results = data?.results ?? []

      // Si la page retourne moins de perPage résultats, c'est la dernière page
      if (results.length < perPage) {
        hasMore = false
      }

      for (const r of results) {
        if (allEtablissements.length >= maxResults) break
        if (!r.siren || !r.siege) continue

        // Déduplication en amont : skiper les SIREN déjà connus en base
        if (excludeSirens?.has(r.siren)) continue

        // Convertir au format SireneEtablissement pour compatibilité avec enrichirProspect
        const etab: SireneEtablissement = {
          siret: r.siege.siret,
          siren: r.siren,
          denominationUniteLegale: r.nom_raison_sociale || r.nom_complet,
          codePostalEtablissement: r.siege.code_postal,
          libelleCommuneEtablissement: r.siege.libelle_commune,
          activitePrincipaleEtablissement: r.siege.activite_principale || r.activite_principale,
          trancheEffectifsEtablissement: r.siege.tranche_effectif_salarie || r.tranche_effectif_salarie,
          etatAdministratifEtablissement: 'A',
          adresseEtablissement: {
            libelleVoieEtablissement: r.siege.adresse,
            codePostalEtablissement: r.siege.code_postal,
            libelleCommuneEtablissement: r.siege.libelle_commune,
          },
        }

        allEtablissements.push(etab)
      }

      console.log(JSON.stringify({
        level: 'info',
        module: 'sourcing',
        msg: `Recherche Entreprises fallback: NAF ${naf} page ${page}`,
        resultats: results.length,
        nouveaux_apres_dedup: results.filter((r) => r.siren && !excludeSirens?.has(r.siren)).length,
        cumul: allEtablissements.length,
      }))

      page++
    }
  }

  return allEtablissements.slice(0, maxResults)
}

// ------------------------------------------------------------
// ADEME BEGES — API Data Fair (remplace CKAN mort)
// ------------------------------------------------------------

/**
 * Vérifie si une entreprise a publié un BEGES dans la base ADEME.
 * Utilise l'API Data Fair (endpoint /bilan-ges/lines) — l'ancien endpoint CKAN est mort.
 * Retourne le record le PLUS RÉCENT (tri par annee_de_reporting desc).
 * Retourne null si aucun résultat ou en cas d'erreur.
 */
export async function verifierBegesAdeme(siren: string): Promise<AdemeBegesEnrichi | null> {
  // L'API Data Fair accepte q= pour la recherche full-text par SIREN,
  // size=5 pour récupérer plusieurs années et choisir la plus récente.
  const url = new URL(ADEME_BEGES_URL)
  url.searchParams.set('q', siren)
  url.searchParams.set('size', '5')

  let response: Response
  try {
    response = await fetchWithRetry(url.toString(), {
      headers: { Accept: 'application/json' },
    })
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'sourcing',
        msg: `ADEME BEGES inaccessible pour SIREN ${siren}`,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return null
  }

  if (!response.ok) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'sourcing',
        msg: `ADEME HTTP ${response.status} pour SIREN ${siren}`,
      }),
    )
    return null
  }

  let data: { results?: AdemeBegesDataFairRecord[]; total?: number }
  try {
    data = await response.json()
  } catch {
    return null
  }

  const results = data?.results
  if (!results || results.length === 0) {
    return null
  }

  // Filtrer sur siren_principal exact pour éviter les faux positifs (full-text peut matcher
  // sur raison_sociale), puis trier par annee_de_reporting DESC pour prendre le plus récent.
  const matches = results
    .filter((r) => r.siren_principal === siren)
    .sort((a, b) => b.annee_de_reporting - a.annee_de_reporting)

  // Si aucun match exact, tenter sans filtre SIREN (certains bilans ont des sous-entités)
  const record = matches.length > 0 ? matches[0] : results.sort((a, b) => b.annee_de_reporting - a.annee_de_reporting)[0]

  return {
    siren: record.siren_principal,
    raison_sociale: record.raison_sociale,
    annee_reporting: record.annee_de_reporting,
    date_publication: record.date_de_publication,
    url_bilan: `https://bilans-ges.ademe.fr/bilans/${record.id}`,
    responsable_du_suivi: record.responsable_du_suivi || undefined,
    fonction: record.fonction || undefined,
    courriel: record.courriel || undefined,
  }
}

// ------------------------------------------------------------
// ENRICHISSEMENT TÉLÉPHONE
// ------------------------------------------------------------

/**
 * Tente de trouver un numéro de téléphone public pour un SIREN donné.
 *
 * Stratégie :
 * 1. API Recherche Entreprises (recherche-entreprises.api.gouv.fr) — champ siege.telephone
 * 2. Retourne null si aucune source ne fournit de téléphone
 *
 * Note : l'API Entreprise (entreprise.api.gouv.fr/v3) nécessite un token SIRET-specific
 * non public — elle n'est pas utilisée ici.
 * L'API Annuaire Entreprises (annuaire-entreprises.data.gouv.fr) ne retourne pas de champ
 * téléphone dans son format JSON public actuel (2025).
 */
export async function rechercherTelephone(siren: string): Promise<string | null> {
  // Validation SIREN : 9 chiffres
  if (!/^\d{9}$/.test(siren)) return null

  const url = new URL(RECHERCHE_ENTREPRISES_URL)
  url.searchParams.set('q', siren)
  url.searchParams.set('per_page', '1')
  url.searchParams.set('page', '1')

  let response: Response
  try {
    response = await fetchWithRetry(url.toString(), {
      headers: { Accept: 'application/json' },
    })
  } catch {
    return null
  }

  if (!response.ok) return null

  let data: { results?: Array<{ siege?: { telephone?: string }; matching_etablissements?: Array<{ telephone?: string }> }> }
  try {
    data = await response.json()
  } catch {
    return null
  }

  const results = data?.results ?? []
  if (results.length === 0) return null

  const premier = results[0]

  // Priorité 1 : téléphone du siège
  const telSiege = premier?.siege?.telephone?.trim()
  if (telSiege && telSiege.length >= 10) return telSiege

  // Priorité 2 : téléphone dans les établissements matchés
  const matchingEtabs = premier?.matching_etablissements ?? []
  for (const etab of matchingEtabs) {
    const tel = etab?.telephone?.trim()
    if (tel && tel.length >= 10) return tel
  }

  return null
}

// ------------------------------------------------------------
// ENRICHISSEMENT PROSPECT
// ------------------------------------------------------------

/**
 * Convertit un établissement Sirene en un objet Prospect partiel.
 * Appelle ADEME pour le statut BEGES.
 * Détermine l'obligation BEGES selon la tranche d'effectifs.
 */
export async function enrichirProspect(
  etab: SireneEtablissement,
): Promise<Partial<Prospect>> {
  // Tranche 41 correspond à 500-999 salariés — seuil obligation BEGES (≥ 500)
  const tranche = parseInt(etab.trancheEffectifsEtablissement ?? '0', 10)
  const obligationBeges = tranche >= 41

  // Résolution des effectifs min/max depuis la tranche INSEE
  const { effectifMin, effectifMax } = trancheToEffectif(tranche)

  // Raison sociale : priorité dénomination usuelle → dénomination légale → nom patronymique
  const raisonSociale =
    etab.denominationUsuelle1UniteLegale ??
    etab.denominationUniteLegale ??
    [etab.prenomUsuelUniteLegale, etab.nomUniteLegale].filter(Boolean).join(' ') ??
    'Inconnu'

  // Construction de l'adresse complète
  const adresse = etab.adresseEtablissement
    ? [
        etab.adresseEtablissement.numeroVoieEtablissement,
        etab.adresseEtablissement.typeVoieEtablissement,
        etab.adresseEtablissement.libelleVoieEtablissement,
      ]
        .filter(Boolean)
        .join(' ')
    : undefined

  // Vérification BEGES ADEME (sans bloquer sur erreur)
  let begesAdeme: AdemeBegesEnrichi | null = null
  try {
    begesAdeme = await verifierBegesAdeme(etab.siren)
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'sourcing',
        msg: `enrichirProspect: ADEME non disponible pour ${etab.siren}`,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }

  // Calcul de la validité BEGES : un BEGES est valide si son année de reporting
  // est dans les 4 dernières années (obligation de renouvellement quadriennal).
  // Ex: en 2026, un BEGES de 2022 est encore valide, un de 2021 ne l'est plus.
  const currentYear = new Date().getFullYear()
  const begesValide = begesAdeme !== null
    ? begesAdeme.annee_reporting >= currentYear - 4
    : undefined

  // Enrichissement téléphone : tentative via Recherche Entreprises (open data).
  // ADEME ne fournit pas de téléphone — on requête l'API de recherche avec le SIREN.
  // Non bloquant : si la source ne retourne rien, contact_telephone reste null.
  let contactTelephone: string | null = null
  try {
    contactTelephone = await rechercherTelephone(etab.siren)
  } catch {
    // Silencieux — le téléphone est une donnée enrichissement best-effort
  }

  const prospect: Partial<Prospect> = {
    siren: etab.siren,
    siret: etab.siret,
    raison_sociale: raisonSociale,
    secteur_naf: etab.activitePrincipaleEtablissement,
    effectif_min: effectifMin,
    effectif_max: effectifMax,
    ville:
      etab.libelleCommuneEtablissement ??
      etab.adresseEtablissement?.libelleCommuneEtablissement,
    code_postal:
      etab.codePostalEtablissement ??
      etab.adresseEtablissement?.codePostalEtablissement,
    adresse,
    beges_publie: begesAdeme !== null,
    beges_derniere_publication: begesAdeme?.date_publication
      ? begesAdeme.date_publication.substring(0, 10)
      : undefined,
    beges_url: begesAdeme?.url_bilan ?? undefined,
    beges_valide: begesValide,
    // Enrichissement contact depuis les données ADEME + téléphone Recherche Entreprises
    contact_nom: begesAdeme?.responsable_du_suivi ?? undefined,
    contact_poste: begesAdeme?.fonction ?? undefined,
    contact_email: begesAdeme?.courriel ?? undefined,
    contact_telephone: contactTelephone ?? undefined,
    obligation_beges: obligationBeges,
    source: 'sirene_api',
    signaux: [],
  }

  return prospect
}

// ------------------------------------------------------------
// UTILITAIRE : tranche → effectifs
// ------------------------------------------------------------

/**
 * Convertit une tranche INSEE en fourchette d'effectifs.
 * Référence : https://www.sirene.fr/sirene/public/variable/trancheEffectifsUniteLegale
 */
function trancheToEffectif(tranche: number): {
  effectifMin: number
  effectifMax: number
} {
  const MAP: Record<number, [number, number]> = {
    0:  [0, 0],
    1:  [1, 2],
    2:  [3, 5],
    3:  [6, 9],
    11: [10, 19],
    12: [20, 49],
    21: [50, 99],
    22: [100, 199],
    31: [200, 249],
    32: [250, 499],
    41: [500, 999],
    42: [1_000, 1_999],
    51: [2_000, 4_999],
    52: [5_000, 9_999],
    53: [10_000, 99_999],
  }

  const entry = MAP[tranche]
  if (!entry) {
    return { effectifMin: 0, effectifMax: 0 }
  }
  return { effectifMin: entry[0], effectifMax: entry[1] }
}
