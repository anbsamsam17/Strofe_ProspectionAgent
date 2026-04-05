// ============================================================
// SOURCING — Agent IA Prospection Bilan Carbone
// Source : API Sirene INSEE v3.11 + ADEME BEGES
// ============================================================

import type {
  AdemeBeges,
  Prospect,
  SireneEtablissement,
  SireneResponse,
} from '@/lib/types'

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

const INSEE_TOKEN_URL = 'https://api.insee.fr/token'
const INSEE_SIRET_URL = 'https://api.insee.fr/entreprises/sirene/V3.11/siret'
const ADEME_BEGES_URL = 'https://data.ademe.fr/api/3/action/datastore_search'
const ADEME_RESOURCE_ID = 'dbe07a87-8a2b-47d3-a0ca-f2a7b5e4f3c2'

// Codes NAF prioritaires (viticulture, aéro, logistique, agro-alimentaire, industrie)
const NAF_PRIORITAIRES = [
  '01.21Z', '01.22Z',        // Viticulture
  '30.30Z',                  // Construction aéronautique
  '52.10B', '52.29A',        // Logistique / entreposage
  '10.11Z', '10.13A', '10.32Z', '10.51A', '10.71A', // Agro-alimentaire
  '46.17B',                  // Commerce intermédiaire agro
  '49.41A', '49.41B', '52.21Z', // Transport routier / services annexes
]

// Max 30 req/min sur Sirene → délai entre les pages
const SIRENE_DELAY_MS = 2_100   // ~28 req/min avec marge de sécurité
const RETRY_ATTEMPTS = 2
const RETRY_DELAY_MS = 1_000

// Tranches d'effectifs INSEE correspondant à >= 200 salariés (31 = 200-249, 53 = 10 000+)
// On cible tranche >= 31 pour avoir 200+ salariés
const TRANCHE_MIN = '31'
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
}

interface InseeBearerCache {
  token: string
  expiresAt: number
}

// Cache mémoire du token (valide 7 jours, donc on peut le garder en mémoire
// dans un process long comme un cron serverless Edge Function warm)
let _inseeTokenCache: InseeBearerCache | null = null

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
// OAUTH2 TOKEN INSEE
// ------------------------------------------------------------

/**
 * Obtient un Bearer token OAuth2 pour l'API Sirene INSEE.
 * Utilise un cache mémoire — le token est valide 7 jours.
 * Renouvelle automatiquement si expiré (avec 1 min de marge).
 */
export async function getInseeBearerToken(): Promise<string> {
  const now = Date.now()
  const ONE_MINUTE_MS = 60_000

  // Retourner le token en cache s'il est encore valide (avec 1 min de marge)
  if (_inseeTokenCache && _inseeTokenCache.expiresAt - ONE_MINUTE_MS > now) {
    return _inseeTokenCache.token
  }

  const clientId = process.env.INSEE_CLIENT_ID
  const clientSecret = process.env.INSEE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error(
      'getInseeBearerToken: INSEE_CLIENT_ID et INSEE_CLIENT_SECRET sont requis',
    )
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  let response: Response
  try {
    response = await fetchWithRetry(INSEE_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    })
  } catch (err) {
    throw new Error(
      `getInseeBearerToken: impossible d'obtenir le token INSEE. ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '(body illisible)')
    throw new Error(
      `getInseeBearerToken: HTTP ${response.status} — ${body}`,
    )
  }

  const data = (await response.json()) as { access_token: string; expires_in: number }

  if (!data.access_token) {
    throw new Error('getInseeBearerToken: access_token absent dans la réponse INSEE')
  }

  // Mettre en cache (expires_in est en secondes)
  _inseeTokenCache = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1_000,
  }

  console.log(
    JSON.stringify({
      level: 'info',
      module: 'sourcing',
      msg: 'Token INSEE renouvelé',
      expires_in_hours: Math.floor(data.expires_in / 3600),
    }),
  )

  return data.access_token
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

  const token = await getInseeBearerToken()

  // Construction du filtre Lucene
  // L'API Sirene utilise les codes NAF sans point (ex: "4941A" et non "49.41A")
  const nafFilter = `activitePrincipaleEtablissement:(${nafCodes
    .map((c) => c.replace('.', ''))
    .join(' ')})`

  const query = [
    codePostalRange,
    `trancheEffectifsEtablissement:[${TRANCHE_MIN} TO ${TRANCHE_MAX}]`,
    'etatAdministratifEtablissement:A',
    nafFilter,
  ].join(' AND ')

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
          Authorization: `Bearer ${token}`,
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
// ADEME BEGES
// ------------------------------------------------------------

/**
 * Vérifie si une entreprise a publié un BEGES dans la base ADEME.
 * Retourne null si aucun résultat ou en cas d'erreur.
 */
export async function verifierBegesAdeme(siren: string): Promise<AdemeBeges | null> {
  const url = new URL(ADEME_BEGES_URL)
  url.searchParams.set('resource_id', ADEME_RESOURCE_ID)
  url.searchParams.set('q', siren)
  url.searchParams.set('limit', '1')

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

  let data: {
    result?: {
      records?: Array<Record<string, unknown>>
    }
  }
  try {
    data = await response.json()
  } catch {
    return null
  }

  const records = data?.result?.records
  if (!records || records.length === 0) {
    return null
  }

  const record = records[0]

  return {
    siren: String(record['siren'] ?? record['SIREN'] ?? siren),
    raison_sociale: String(record['raison_sociale'] ?? record['Raison_Sociale'] ?? ''),
    annee_reporting: Number(
      record['annee_reporting'] ?? record['Annee_Reporting'] ?? 0,
    ),
    statut_publication: String(
      record['statut_publication'] ?? record['Statut_Publication'] ?? 'publié',
    ),
    url_bilan: record['url_bilan']
      ? String(record['url_bilan'])
      : undefined,
    date_publication: record['date_publication']
      ? String(record['date_publication'])
      : undefined,
  }
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
  let begesAdeme: AdemeBeges | null = null
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
