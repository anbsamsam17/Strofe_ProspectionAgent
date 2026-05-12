// ============================================================
// SOURCING — Agent IA Prospection Bilan Carbone
// Source : API Sirene INSEE v3.11 + ADEME BEGES (Data Fair)
// ============================================================

import { captureWithContext } from '@/lib/observability/sentry-helpers'
import type {
  Prospect,
  SireneEtablissement,
  SireneResponse,
} from '@/lib/types'

// ------------------------------------------------------------
// ERREURS TYPÉES
// ------------------------------------------------------------

/**
 * Erreur émise quand l'API Sirene répond avec un statut HTTP fatal
 * (>= 500 après retries) ou quand la réponse ne peut pas être parsée.
 * Le caller (orchestrator) doit l'attraper pour basculer en mode dégradé
 * (fallback Recherche Entreprises).
 */
export class SireneApiError extends Error {
  public readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'SireneApiError'
    this.status = status
  }
}

/**
 * Erreur de validation des paramètres d'entrée de `sourcerEntreprises`.
 * Throw avant tout appel réseau pour signaler un mauvais usage côté caller.
 */
export class SireneValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SireneValidationError'
  }
}

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

/**
 * Nombre max de codes NAF dans une seule clause `OR` Lucene envoyée à Sirene.
 *
 * Sirene v3.11 (Solr en backend) refuse les disjonctions trop larges sur les
 * champs multivalués avec HTTP 400 "Erreur de syntaxe dans le paramètre q".
 * La limite empirique observée en prod (2026-05-12) est entre 25 et 32 termes.
 * On vise 20 par marge de sécurité — au-delà on chunke et on construit un
 * curseur composite `chunkN|rawCursor` pour itérer chunk après chunk.
 *
 * Cf. memory/hindsight.md 2026-04-06 (filtre Lucene vide) et 2026-05-12 (41 NAFs).
 */
const SIRENE_MAX_NAF_PER_QUERY = 20

/**
 * Préfixe du curseur composite utilisé quand `nafCodes.length > SIRENE_MAX_NAF_PER_QUERY`.
 * Format : `${COMPOSITE_CURSOR_PREFIX}${chunkIndex}|${rawCursor}`.
 * Détectable côté caller — un curseur ne commençant pas par ce préfixe est traité
 * comme un curseur raw legacy (chunk 0 implicite).
 */
const COMPOSITE_CURSOR_PREFIX = 'chunk:'

// ------------------------------------------------------------
// CIRCUIT BREAKER — Recherche Entreprises (api.gouv.fr)
// ------------------------------------------------------------
//
// Contexte (Vercel timeout 300s 2026-05-12) :
//   `rechercherTelephone()` est appelé pour CHAQUE prospect lors de l'enrichissement
//   ADEME (batches de 20 en parallèle dans `enrichAndScore`). Quand Recherche
//   Entreprises tombe (panne ou rate-limit), chaque appel partait en `fetch failed`
//   → 3 tentatives × backoff cumulatif 1+2s = ~3s par échec. Sur 142 prospects,
//   le timeout Vercel sautait avant la fin de la phase.
//
// Solution : compteur d'échecs consécutifs au niveau module. Au-delà du seuil,
// on coupe `rechercherTelephone` pour le reste du process (warm instance Vercel).
// Le compteur se reset au cold start ET dès qu'un appel réussit (autoreprise).
//
// Le compteur reste in-memory (pas de Redis). Acceptable car :
//   - une instance Vercel sert ~1 user (pas de contention)
//   - le pire cas est un faux positif après warm reuse, ce qui dégrade
//     l'enrichissement téléphone mais ne casse pas le pipeline.
// ------------------------------------------------------------

const RE_PHONE_TIMEOUT_MS = 5_000
const RE_PHONE_CIRCUIT_BREAKER_THRESHOLD = 5
let _rePhoneConsecutiveFailures = 0
let _rePhoneCircuitOpenedAt: number | null = null

/** Indique si le circuit breaker Recherche Entreprises (téléphone) est actuellement ouvert. */
export function isRePhoneCircuitOpen(): boolean {
  return _rePhoneConsecutiveFailures >= RE_PHONE_CIRCUIT_BREAKER_THRESHOLD
}

/** Réinitialise le compteur d'échecs (cold start / tests). */
export function resetRePhoneCircuit(): void {
  _rePhoneConsecutiveFailures = 0
  _rePhoneCircuitOpenedAt = null
}

/** Expose des stats minimales pour le logging orchestrator. */
export function getRePhoneCircuitState(): {
  consecutiveFailures: number
  open: boolean
  openedAt: number | null
} {
  return {
    consecutiveFailures: _rePhoneConsecutiveFailures,
    open: isRePhoneCircuitOpen(),
    openedAt: _rePhoneCircuitOpenedAt,
  }
}

function recordRePhoneFailure(siren: string, errorMsg: string): void {
  _rePhoneConsecutiveFailures += 1
  if (_rePhoneConsecutiveFailures === RE_PHONE_CIRCUIT_BREAKER_THRESHOLD) {
    _rePhoneCircuitOpenedAt = Date.now()
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'sourcing',
        phase: 'enrichment_phone',
        msg: `Circuit breaker Recherche Entreprises (téléphone) ouvert après ${RE_PHONE_CIRCUIT_BREAKER_THRESHOLD} échecs consécutifs — enrichissement téléphone désactivé pour le reste du process`,
        siren_dernier_echec: siren,
        derniere_erreur: errorMsg.slice(0, 200),
      }),
    )
  }
}

function recordRePhoneSuccess(): void {
  if (_rePhoneConsecutiveFailures > 0) {
    _rePhoneConsecutiveFailures = 0
    _rePhoneCircuitOpenedAt = null
  }
}

// Tranches d'effectifs INSEE correspondant à >= 50 salariés (21 = 50-99, 53 = 10 000+)
// On cible tranche >= 21 pour avoir 50+ salariés : les 200+ ont une obligation BEGES légale,
// mais les 50-199 sont des cibles pertinentes pour une démarche volontaire.
const TRANCHE_MIN = '21'
const TRANCHE_MAX = '53'

// Département Gironde
const CODE_POSTAL_QUERY = 'codePostalEtablissement:[33000 TO 33999]'

// ------------------------------------------------------------
// CONSTANTES — DÉFAUTS PARAMETRABLES
// ------------------------------------------------------------

/**
 * Codes tranche INSEE valides (variable `trancheEffectifsEtablissement`).
 * `NN` = "Non précisé" (à exclure par défaut, voir mapping spec §1.4).
 */
const VALID_TRANCHE_CODES: ReadonlySet<string> = new Set([
  'NN', '00', '01', '02', '03',
  '11', '12',
  '21', '22',
  '31', '32',
  '41', '42',
  '51', '52', '53',
])

/** Défaut tranches : 50+ salariés (cible BEGES, cohérent avec comportement legacy). */
const DEFAULT_EFFECTIF_TRANCHES: readonly string[] = [
  '21', '22', '31', '32', '41', '42', '51', '52', '53',
]

/** Défaut : France entière (pas de filtre géographique). */
const DEFAULT_CODE_POSTAL_RANGE: readonly [string, string] = ['00000', '99999']
const DEFAULT_DEPARTEMENTS: readonly string[] = []

/** Limites API Sirene. */
const SIRENE_MAX_PAGE_SIZE = 1000
const DEFAULT_PAGE_SIZE = 100
const DEFAULT_MAX_PAGES = 5

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
  /** Codes tranche INSEE (ex ['21','22','31','32']). Défaut : 50+ salariés. */
  effectifTranches?: string[]
  /** Codes département pour filtrer le fallback. [] = France entière. */
  departements?: string[]
}

/**
 * Paramètres de l'API pagination curseur de `sourcerEntreprises`.
 * Tous les champs sont optionnels avec des défaults compatibles avec l'historique
 * (50+ salariés, Gironde, NAF prioritaires).
 */
export type SourcerEntreprisesParams = {
  /** Codes NAF à cibler. Format avec point ('01.21Z') — sera nettoyé en interne. Défaut : NAF_PRIORITAIRES. */
  nafCodes?: string[]
  /** Codes tranche INSEE (ex. ['21','22','31','32']). Défaut : 50+ salariés. */
  effectifTranches?: string[]
  /** Bornes lexicographiques code postal [min, max]. Défaut : Gironde ['33000','33999']. */
  codePostalRange?: [string, string]
  /** Codes département (utilisé uniquement par le fallback Recherche Entreprises). Défaut : ['33']. */
  departements?: string[]
  /** Curseur Sirene officiel (`*` pour la première page). Défaut : `*`. */
  curseur?: string
  /** Taille d'une page Sirene. Clampé à [1, 1000]. Défaut : 100. */
  pageSize?: number
  /** Nombre max de pages à charger en un appel (safety cap). Défaut : 5. */
  maxPages?: number
  /** SIREN à filtrer côté code après fetch (post-pagination — l'API ne supporte pas NOT IN). */
  excludeSirens?: Set<string>
}

/**
 * Résultat d'un appel à `sourcerEntreprises`.
 * Le caller (orchestrator) peut chaîner les appels en passant `curseurSuivant` comme `curseur`
 * tant que `exhausted === false`.
 */
export type SourcerEntreprisesResult = {
  /** Établissements collectés sur les pages chargées (filtrés via `excludeSirens` si fourni). */
  etablissements: SireneEtablissement[]
  /** Curseur de début de l'appel (input ou `*`). */
  curseur: string
  /** Curseur à passer au prochain appel (ou identique à `curseur` si univers épuisé). */
  curseurSuivant: string
  /** Total de l'univers déclaré par Sirene (`header.total` de la PREMIÈRE page). */
  totalAvailable: number
  /** Nombre de pages effectivement fetchées dans cet appel. */
  pagesLoaded: number
  /** true ssi `curseurSuivant === curseur` (FIN d'univers selon convention Sirene). */
  exhausted: boolean
  /** true ssi 404 Sirene sur la première page (univers vide pour ces filtres). */
  universeEmpty: boolean
}

/**
 * Type local représentant un record ADEME BEGES renvoyé par l'API Data Fair.
 * Les champs correspondent à l'API : https://data.ademe.fr/data-fair/api/v1/datasets/bilan-ges/lines
 * Ce type est plus riche que l'interface AdemeBeges de types.ts (qui reste la surface publique).
 */
export interface AdemeBegesDataFairRecord {
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
// SOURCING SIRENE — Pagination par CURSEUR (INSEE v3.11)
// ------------------------------------------------------------

/**
 * Valide les paramètres de `sourcerEntreprises` et lève `SireneValidationError` si invalides.
 * Retourne une version normalisée avec les défauts appliqués.
 */
function validateSourcerParams(params: SourcerEntreprisesParams): {
  nafCodes: string[]
  effectifTranches: string[]
  codePostalRange: [string, string]
  departements: string[]
  curseur: string
  pageSize: number
  maxPages: number
  excludeSirens: Set<string>
} {
  const nafCodes = params.nafCodes ?? NAF_PRIORITAIRES.slice()
  const effectifTranches = params.effectifTranches ?? DEFAULT_EFFECTIF_TRANCHES.slice()
  const codePostalRange: [string, string] = params.codePostalRange ?? [
    DEFAULT_CODE_POSTAL_RANGE[0],
    DEFAULT_CODE_POSTAL_RANGE[1],
  ]
  const departements = params.departements ?? DEFAULT_DEPARTEMENTS.slice()
  const curseur = params.curseur ?? '*'
  const requestedPageSize = params.pageSize ?? DEFAULT_PAGE_SIZE
  const pageSize = Math.max(1, Math.min(SIRENE_MAX_PAGE_SIZE, Math.floor(requestedPageSize)))
  const maxPages = params.maxPages ?? DEFAULT_MAX_PAGES
  const excludeSirens = params.excludeSirens ?? new Set<string>()

  // 1. Tranches valides
  for (const t of effectifTranches) {
    if (!VALID_TRANCHE_CODES.has(t)) {
      throw new SireneValidationError(
        `effectifTranches: code "${t}" invalide. Codes acceptés : ${[...VALID_TRANCHE_CODES].join(',')}`,
      )
    }
  }
  if (effectifTranches.length === 0) {
    throw new SireneValidationError('effectifTranches: au moins une tranche est requise')
  }

  // 2. codePostalRange : 5 chars + min <= max (lexicographique)
  const [cpMin, cpMax] = codePostalRange
  if (typeof cpMin !== 'string' || typeof cpMax !== 'string' || cpMin.length !== 5 || cpMax.length !== 5) {
    throw new SireneValidationError(
      `codePostalRange: chaque borne doit être une chaîne de 5 caractères (reçu: ["${cpMin}","${cpMax}"])`,
    )
  }
  if (cpMin > cpMax) {
    throw new SireneValidationError(
      `codePostalRange: borne min "${cpMin}" > borne max "${cpMax}" (ordre lexicographique)`,
    )
  }

  // 3. maxPages > 0
  if (!Number.isFinite(maxPages) || maxPages <= 0 || !Number.isInteger(maxPages)) {
    throw new SireneValidationError(`maxPages: entier > 0 requis (reçu: ${maxPages})`)
  }

  return {
    nafCodes,
    effectifTranches,
    codePostalRange,
    departements,
    curseur,
    pageSize,
    maxPages,
    excludeSirens,
  }
}

/**
 * Normalise une liste de codes NAF au format attendu par Sirene (sans point, uppercase).
 * Filtre les entrées vides et déduplique en conservant l'ordre d'entrée (important pour
 * la stabilité du chunking entre runs : tant que `nafCodes` ne change pas, le découpage
 * en chunks reste identique et le curseur composite reste valide).
 */
function normalizeNafCodes(nafCodes: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of nafCodes) {
    const cleaned = c.replace('.', '').trim().toUpperCase()
    if (cleaned.length === 0 || seen.has(cleaned)) continue
    seen.add(cleaned)
    out.push(cleaned)
  }
  return out
}

/**
 * Découpe une liste de codes NAF en chunks de taille fixe (`SIRENE_MAX_NAF_PER_QUERY`).
 * Préserve l'ordre — chunk 0 contient les `N` premiers codes, etc.
 *
 * Retourne `[[]]` (un seul chunk vide) si la liste est vide, pour préserver l'invariant
 * "il y a toujours au moins un chunk à interroger" côté caller.
 */
export function chunkNafCodes(
  nafCodes: string[],
  chunkSize: number = SIRENE_MAX_NAF_PER_QUERY,
): string[][] {
  if (nafCodes.length === 0) return [[]]
  const chunks: string[][] = []
  for (let i = 0; i < nafCodes.length; i += chunkSize) {
    chunks.push(nafCodes.slice(i, i + chunkSize))
  }
  return chunks
}

/**
 * Parse un curseur composite `chunk:<index>|<rawCursor>` ou un curseur raw legacy.
 *
 * - `chunk:0|*`         → `{ chunkIndex: 0, rawCursor: '*' }`
 * - `chunk:2|abc123`    → `{ chunkIndex: 2, rawCursor: 'abc123' }`
 * - `*` (legacy)        → `{ chunkIndex: 0, rawCursor: '*' }`
 * - `someRawCursor`     → `{ chunkIndex: 0, rawCursor: 'someRawCursor' }`
 *
 * Tolérant : un préfixe malformé retombe sur le chunk 0 avec le curseur d'origine
 * (assume curseur raw legacy).
 */
export function parseCompositeCursor(
  cursor: string,
): { chunkIndex: number; rawCursor: string } {
  if (!cursor.startsWith(COMPOSITE_CURSOR_PREFIX)) {
    return { chunkIndex: 0, rawCursor: cursor }
  }
  const body = cursor.slice(COMPOSITE_CURSOR_PREFIX.length)
  const sepIdx = body.indexOf('|')
  if (sepIdx === -1) {
    return { chunkIndex: 0, rawCursor: cursor }
  }
  const indexPart = body.slice(0, sepIdx)
  const rawPart = body.slice(sepIdx + 1)
  const parsed = Number.parseInt(indexPart, 10)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { chunkIndex: 0, rawCursor: cursor }
  }
  return { chunkIndex: parsed, rawCursor: rawPart.length > 0 ? rawPart : '*' }
}

/**
 * Sérialise un curseur composite. Format inverse de `parseCompositeCursor`.
 * Utilisé uniquement quand `totalChunks > 1` (sinon on retourne le rawCursor pour
 * compatibilité descendante avec les callers qui persistent un curseur raw).
 */
function serializeCompositeCursor(chunkIndex: number, rawCursor: string): string {
  return `${COMPOSITE_CURSOR_PREFIX}${chunkIndex}|${rawCursor}`
}

/**
 * Construit la requête Lucene Sirene à partir des filtres fournis.
 * Format attendu par INSEE (codes NAF sans point, range lexicographique).
 *
 * `nafCodes` doit être pré-normalisé (cf. `normalizeNafCodes`) et pré-chunké
 * (cf. `chunkNafCodes`) — cette fonction se contente d'assembler la query.
 */
function buildLuceneQuery(
  nafCodes: string[],
  effectifTranches: string[],
  codePostalRange: [string, string],
): string {
  // Tranches : déduplication + tri + énumération via "OR" (toujours valide même pour 1 élément).
  const uniqueTranches = [...new Set(effectifTranches)].sort()
  const tranchesClause = `trancheEffectifsEtablissement:(${uniqueTranches.join(' OR ')})`

  const queryParts: string[] = [
    `codePostalEtablissement:[${codePostalRange[0]} TO ${codePostalRange[1]}]`,
    tranchesClause,
    'etatAdministratifEtablissement:A',
  ]

  // N'ajouter le filtre NAF que si la liste est non vide — sinon on cible tous les secteurs
  // (éviter le bug HTTP 400 sur `activitePrincipaleEtablissement:()`).
  if (nafCodes.length > 0) {
    queryParts.push(`activitePrincipaleEtablissement:(${nafCodes.join(' OR ')})`)
  }

  return queryParts.join(' AND ')
}

/**
 * Source les établissements depuis l'API Sirene INSEE v3.11 en utilisant la
 * pagination officielle par CURSEUR.
 *
 * Convention INSEE :
 *   - Premier appel : `curseur=*`
 *   - Pages suivantes : passer `header.curseurSuivant` en `curseur`
 *   - Fin d'univers : `curseurSuivant === curseur` (page terminale)
 *
 * Arrêt anticipé : si `pagesLoaded >= maxPages` (safety cap) ou si une page renvoie
 * `etablissements` vide.
 *
 * Throw `SireneValidationError` sur params invalides (pré-flight), `SireneApiError`
 * sur erreur HTTP fatale (>= 500 après retries) ou parse échoué. Les 4xx renvoient
 * un résultat vide avec `exhausted=true` (cohérent : pas de page suivante possible).
 */
export async function sourcerEntreprises(
  params: SourcerEntreprisesParams = {},
): Promise<SourcerEntreprisesResult> {
  const validated = validateSourcerParams(params)
  const { nafCodes, effectifTranches, codePostalRange, curseur, pageSize, maxPages, excludeSirens } = validated

  const apiKey = getInseeApiKey()

  // ----------------------------------------------------------------
  // CHUNKING NAF — contourne la limite Solr Sirene (~25 termes par OR).
  // ----------------------------------------------------------------
  // Sirene v3.11 répond HTTP 400 "Erreur de syntaxe dans le paramètre q" quand
  // `activitePrincipaleEtablissement:(...)` contient trop de codes. On découpe
  // les NAF en chunks de SIRENE_MAX_NAF_PER_QUERY et on itère chunk après chunk,
  // chacun avec son propre curseur Sirene encapsulé dans un curseur composite
  // `chunk:<index>|<rawCursor>` exposé au caller. Quand le dernier chunk est
  // épuisé, on remet `curseurSuivant === curseur` pour signaler `exhausted`.
  //
  // Si nafCodes ≤ SIRENE_MAX_NAF_PER_QUERY, un seul chunk → curseur raw
  // legacy (rétrocompat totale avec les tests Wave 3 et le state stocké en DB).
  const normalizedNaf = normalizeNafCodes(nafCodes)
  const nafChunks = chunkNafCodes(normalizedNaf)
  const isComposite = nafChunks.length > 1

  // Le curseur d'entrée peut être :
  //   - composite `chunk:N|raw` → on extrait chunkIndex + rawCursor
  //   - raw legacy (`*`, `c2`, …) → assume chunk 0
  const parsedCursor = parseCompositeCursor(curseur)
  let currentChunkIndex = Math.min(parsedCursor.chunkIndex, nafChunks.length - 1)
  let currentRawCursor = parsedCursor.rawCursor

  const buildQueryForChunk = (idx: number): string =>
    buildLuceneQuery(nafChunks[idx], effectifTranches, codePostalRange)

  // ----------------------------------------------------------------
  // PAGINATION
  // ----------------------------------------------------------------
  const collected: SireneEtablissement[] = []
  // `curseur` à exposer en sortie : on conserve l'input du caller.
  const inputCurseur = curseur
  // `nextCurseur` final : peut être composite ou raw selon isComposite.
  let nextCurseur = curseur
  let totalAvailable = 0
  let pagesLoaded = 0
  let universeEmpty = false

  for (let page = 1; page <= maxPages; page++) {
    const url = new URL(INSEE_SIRET_URL)
    url.searchParams.set('q', buildQueryForChunk(currentChunkIndex))
    url.searchParams.set('nombre', String(pageSize))
    // URLSearchParams encode automatiquement les caractères spéciaux du curseur (* devient %2A, + → %2B, etc.)
    url.searchParams.set('curseur', currentRawCursor)

    let response: Response
    try {
      response = await fetchWithRetry(url.toString(), {
        headers: {
          'X-INSEE-Api-Key-Integration': apiKey,
          Accept: 'application/json',
        },
      })
    } catch (err) {
      // Erreur réseau / timeout après retries → capturer Sentry + propager pour fallback.
      // Le throw ci-dessous est rattrapé par runAdaptiveSourcing pour basculer sur
      // Recherche Entreprises. Sans ce captureException on ne voit l'erreur Sirene
      // que dans Vercel logs (sans alerting Sentry).
      captureWithContext(err, {
        pipeline_phase: 'sourcing',
        api: 'sirene',
        extra: {
          phase: 'sirene_fetch',
          page,
          curseur: currentRawCursor,
          chunk_index: currentChunkIndex,
          chunk_count: nafChunks.length,
        },
      })
      throw new SireneApiError(
        `Sirene: erreur réseau page ${page} chunk=${currentChunkIndex}/${nafChunks.length} curseur=${currentRawCursor} — ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }

    if (response.status === 404) {
      // 404 sur le chunk courant = aucun résultat pour ce sous-ensemble de NAF.
      // En mode composite, on essaie le chunk suivant avant de conclure à un univers vide.
      // En mode mono-chunk (legacy), 404 sur la 1ère page = univers vide.
      console.log(
        JSON.stringify({
          level: 'info',
          module: 'sourcing',
          phase: 'sirene_page',
          page,
          chunk_index: currentChunkIndex,
          chunk_count: nafChunks.length,
          curseur: currentRawCursor,
          curseurSuivant: currentRawCursor,
          returned: 0,
          header_total: 0,
          msg: 'Sirene 404 — chunk vide',
        }),
      )

      if (isComposite && currentChunkIndex < nafChunks.length - 1) {
        // Passer au chunk suivant sans incrémenter pagesLoaded (404 = pas de page chargée).
        // `page--` neutralise l'incrément de la boucle for : on garde le même budget de
        // pages côté caller, l'advance de chunk ne doit pas consommer une itération
        // (cf. test sourcing-sentry 404 univers vide avec maxPages=1 et 3 chunks).
        currentChunkIndex++
        currentRawCursor = '*'
        nextCurseur = serializeCompositeCursor(currentChunkIndex, '*')
        if (page < maxPages) {
          await sleep(SIRENE_DELAY_MS)
        }
        page--
        continue
      }

      // Dernier chunk (ou mono-chunk) avec 404 : univers déclaré vide UNIQUEMENT
      // si AUCUNE page n'a été chargée jusque-là (cf. hindsight 2026-05-12).
      if (pagesLoaded === 0) {
        universeEmpty = true
      }
      // Convention `exhausted` : nextCurseur === inputCurseur. Un 404 termine la
      // pagination — on signale donc l'exhaustion en remettant nextCurseur=inputCurseur,
      // que l'on soit en mode mono-chunk legacy ou au dernier chunk composite.
      nextCurseur = inputCurseur
      break
    }

    if (response.status >= 400 && response.status < 500) {
      // 4xx hors 404 = erreur de requête (auth, validation, syntaxe q=). On THROW pour
      // que le caller (`runAdaptiveSourcing`) déclenche le fallback Recherche Entreprises.
      const body = await response.text().catch(() => '')
      console.log(
        JSON.stringify({
          level: 'warn',
          module: 'sourcing',
          phase: 'sirene_page',
          page,
          chunk_index: currentChunkIndex,
          chunk_count: nafChunks.length,
          curseur: currentRawCursor,
          status: response.status,
          body: body.slice(0, 200),
          msg: 'Sirene HTTP 4xx — throw SireneApiError pour fallback',
        }),
      )
      const sireneErr = new SireneApiError(
        `Sirene: HTTP ${response.status} page ${page} chunk=${currentChunkIndex}/${nafChunks.length} curseur=${currentRawCursor} body=${body.slice(0, 200)}`,
        response.status,
      )
      // Capture Sentry AVANT le throw — le caller (runAdaptiveSourcing) intercepte
      // SireneApiError pour basculer sur le fallback. Sans capture ici, l'erreur
      // est invisible côté alerting (cas du bug "Erreur de syntaxe dans le paramètre q"
      // découvert uniquement dans Vercel logs le 2026-05-12).
      captureWithContext(sireneErr, {
        pipeline_phase: 'sourcing',
        api: 'sirene',
        http_status: response.status,
        extra: {
          phase: 'sirene_page',
          page,
          curseur: currentRawCursor,
          chunk_index: currentChunkIndex,
          chunk_count: nafChunks.length,
          // body tronqué à 1KB pour Sentry — le body reste utile au debug
          // (message d'erreur INSEE typé), pas de PII attendue dans la réponse.
          body_preview: body.slice(0, 1024),
        },
      })
      throw sireneErr
    }

    if (!response.ok) {
      // 5xx persistants → erreur fatale typée + capture Sentry pour alerting.
      const body = await response.text().catch(() => '')
      const sireneErr = new SireneApiError(
        `Sirene: HTTP ${response.status} page ${page} chunk=${currentChunkIndex}/${nafChunks.length} curseur=${currentRawCursor} body=${body.slice(0, 200)}`,
        response.status,
      )
      captureWithContext(sireneErr, {
        pipeline_phase: 'sourcing',
        api: 'sirene',
        http_status: response.status,
        extra: {
          phase: 'sirene_page',
          page,
          curseur: currentRawCursor,
          chunk_index: currentChunkIndex,
          chunk_count: nafChunks.length,
          body_preview: body.slice(0, 1024),
        },
      })
      throw sireneErr
    }

    let data: SireneResponse
    try {
      data = (await response.json()) as SireneResponse
    } catch (err) {
      const parseErr = new SireneApiError(
        `Sirene: parse JSON échoué page ${page} chunk=${currentChunkIndex}/${nafChunks.length} curseur=${currentRawCursor} — ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
      captureWithContext(parseErr, {
        pipeline_phase: 'sourcing',
        api: 'sirene',
        extra: {
          phase: 'sirene_parse',
          page,
          curseur: currentRawCursor,
          chunk_index: currentChunkIndex,
          chunk_count: nafChunks.length,
        },
      })
      throw parseErr
    }

    pagesLoaded++

    // Le total déclaré est figé sur la PREMIÈRE page chargée dans cet appel.
    // En mode composite, totalAvailable du chunk 0 n'est PAS le total univers complet,
    // mais c'est l'info la plus utile dont on dispose côté caller (header_total premier chunk).
    if (pagesLoaded === 1) {
      totalAvailable = data.header?.total ?? 0
    }

    const etablissements = data.etablissements ?? []
    collected.push(...etablissements)

    // Curseur suivant — Sirene renvoie `curseurSuivant` égal au curseur courant en fin d'univers.
    // Fallback prudent : si absent du header, considérer terminal.
    const headerCurseurSuivant = data.header?.curseurSuivant ?? currentRawCursor

    console.log(
      JSON.stringify({
        level: 'info',
        module: 'sourcing',
        phase: 'sirene_page',
        page,
        chunk_index: currentChunkIndex,
        chunk_count: nafChunks.length,
        curseur: currentRawCursor,
        curseurSuivant: headerCurseurSuivant,
        returned: etablissements.length,
        header_total: data.header?.total ?? 0,
      }),
    )

    // Sérialiser le `curseurSuivant` exposé au caller : composite si on chunke.
    nextCurseur = isComposite
      ? serializeCompositeCursor(currentChunkIndex, headerCurseurSuivant)
      : headerCurseurSuivant

    // Condition d'arrêt INSEE pour le chunk courant : curseurSuivant === curseur courant.
    const chunkExhausted =
      headerCurseurSuivant === currentRawCursor || etablissements.length === 0

    if (chunkExhausted) {
      // En mode composite, passer au chunk suivant si possible — sinon univers global épuisé.
      if (isComposite && currentChunkIndex < nafChunks.length - 1) {
        currentChunkIndex++
        currentRawCursor = '*'
        nextCurseur = serializeCompositeCursor(currentChunkIndex, '*')
        if (page < maxPages) {
          await sleep(SIRENE_DELAY_MS)
        }
        continue
      }
      // Dernier chunk épuisé (ou mono-chunk) → on retourne avec exhausted=true.
      // On force nextCurseur === inputCurseur pour respecter la convention.
      nextCurseur = inputCurseur
      break
    }

    // Page non-terminale : continuer la pagination sur le MÊME chunk.
    currentRawCursor = headerCurseurSuivant

    // Respect du rate-limit Sirene (~28 req/min) entre les pages
    if (page < maxPages) {
      await sleep(SIRENE_DELAY_MS)
    }
  }

  // `exhausted` = vrai ssi le curseur suivant final est égal au curseur d'entrée.
  // Couvre aussi les cas 404 / 4xx / page vide où on a remis nextCurseur = inputCurseur.
  const finalExhausted = nextCurseur === inputCurseur

  // Filtrage post-fetch : exclure les SIREN déjà connus du caller (pas géré côté API Sirene).
  const filtered = excludeSirens.size > 0
    ? collected.filter((e) => !excludeSirens.has(e.siren))
    : collected

  return {
    etablissements: filtered,
    curseur: inputCurseur,
    curseurSuivant: nextCurseur,
    totalAvailable,
    pagesLoaded,
    exhausted: finalExhausted,
    universeEmpty,
  }
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
  const {
    maxResults = 200,
    nafCodes = NAF_PRIORITAIRES,
    excludeSirens,
    effectifTranches = ['21', '22', '31', '32', '41', '42', '51', '52', '53'],
    departements = [], // [] = France entière (pas de filtre)
  } = options

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
      // Filtre département uniquement si l'utilisateur en a fourni un.
      // Liste vide = pas de param `departement` = recherche France entière côté API gouv.
      if (departements.length > 0) {
        url.searchParams.set('departement', departements.join(','))
      }
      // Tranches d'effectifs : configurables (défaut 50+ salariés)
      url.searchParams.set('tranche_effectif_salarie', effectifTranches.join(','))
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
        departements,
        effectifTranches,
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
 * Garanties anti-timeout (Vercel 300s — fix 2026-05-12) :
 *   - 1 tentative SANS retry (les retries amplifiaient la panne d'API gouv).
 *   - `AbortSignal.timeout(5_000)` : appel borné à 5s max (un fetch sans signal
 *     peut hang plusieurs minutes côté Node18 si la connexion TCP traîne).
 *   - Circuit breaker module-level : 5 échecs consécutifs → on coupe pour le
 *     reste du process (warm instance). Auto-reset au premier succès.
 *
 * Note : l'API Entreprise (entreprise.api.gouv.fr/v3) nécessite un token SIRET-specific
 * non public — elle n'est pas utilisée ici.
 * L'API Annuaire Entreprises (annuaire-entreprises.data.gouv.fr) ne retourne pas de champ
 * téléphone dans son format JSON public actuel (2025).
 */
export async function rechercherTelephone(siren: string): Promise<string | null> {
  // Validation SIREN : 9 chiffres
  if (!/^\d{9}$/.test(siren)) return null

  // Circuit breaker : si trop d'échecs consécutifs, on évite de bloquer la phase.
  if (isRePhoneCircuitOpen()) return null

  const url = new URL(RECHERCHE_ENTREPRISES_URL)
  url.searchParams.set('q', siren)
  url.searchParams.set('per_page', '1')
  url.searchParams.set('page', '1')

  let response: Response
  try {
    // Pas de fetchWithRetry ici : c'est l'amplificateur du bug Vercel 300s.
    // Un seul essai, timeout 5s, échec silencieux → enrichment tel best-effort.
    response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(RE_PHONE_TIMEOUT_MS),
    })
  } catch (err) {
    recordRePhoneFailure(siren, err instanceof Error ? err.message : String(err))
    return null
  }

  if (!response.ok) {
    // 4xx/5xx : on incrémente le compteur (un 503 répété justifie aussi le breaker).
    recordRePhoneFailure(siren, `HTTP ${response.status}`)
    return null
  }

  let data: { results?: Array<{ siege?: { telephone?: string }; matching_etablissements?: Array<{ telephone?: string }> }> }
  try {
    data = await response.json()
  } catch (err) {
    recordRePhoneFailure(siren, `parse: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }

  // Succès réseau : on reset le compteur (auto-reprise du breaker).
  recordRePhoneSuccess()

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
