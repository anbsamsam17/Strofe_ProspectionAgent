// ============================================================
// SOURCE — Recherche Entreprises (api.gouv.fr)
// Module standalone : récupère dirigeants + siège pour un SIREN.
//
// API publique : https://recherche-entreprises.api.gouv.fr/search
//   - Gratuit, sans auth
//   - 7 req/sec (rate limit côté provider)
//   - Pas de circuit breaker ici (géré côté orchestrator)
//
// Pattern :
//   - Schema Zod strict pour parser le JSON externe (defensive)
//   - Timeout 5s par défaut via AbortSignal
//   - Retourne null en cas de SIREN inconnu / erreur réseau / parsing KO
//   - Logger JSON structuré (sans PII des dirigeants — uniquement compteurs)
// ============================================================

import { z } from 'zod'

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

const API_URL = 'https://recherche-entreprises.api.gouv.fr/search'
const DEFAULT_TIMEOUT_MS = 5_000
const LOG_MODULE = 'recherche-entreprises'

// Ordre de priorité du dirigeant principal :
//   Président > Directeur Général > Gérant > Administrateur > 1er physique.
// Le tri se fait sur la qualité normalisée (lowercase + trim).
const QUALITES_PRIORITAIRES: ReadonlyArray<{ rank: number; match: string }> = [
  { rank: 0, match: 'président' },
  { rank: 0, match: 'president' },
  { rank: 1, match: 'directeur général' },
  { rank: 1, match: 'directeur general' },
  { rank: 2, match: 'gérant' },
  { rank: 2, match: 'gerant' },
  { rank: 3, match: 'administrateur' },
]

const RANK_FALLBACK = 99

// ------------------------------------------------------------
// TYPES PUBLICS
// ------------------------------------------------------------

export interface Dirigeant {
  nom: string
  prenoms: string
  qualite: string
  type: 'physique' | 'morale'
}

export interface SiegeInfo {
  adresse: string | null
  codePostal: string | null
  commune: string | null
  telephone: string | null
  email: string | null
  siteWeb: string | null
}

export interface RechercheEntreprisesResult {
  siren: string
  raisonSociale: string | null
  dirigeants: Dirigeant[]
  /** Dirigeant principal (tri Président > DG > Gérant > Administrateur > 1er physique). */
  dirigeantPrincipal: Dirigeant | null
  siege: SiegeInfo
}

// ------------------------------------------------------------
// SCHEMA ZOD — defensive parsing de la réponse API
// ------------------------------------------------------------

const DirigeantRawSchema = z
  .object({
    nom: z.string().optional().nullable(),
    prenoms: z.string().optional().nullable(),
    qualite: z.string().optional().nullable(),
    type_dirigeant: z.string().optional().nullable(),
  })
  .passthrough()

const SiegeRawSchema = z
  .object({
    adresse: z.string().optional().nullable(),
    code_postal: z.string().optional().nullable(),
    libelle_commune: z.string().optional().nullable(),
    commune: z.string().optional().nullable(),
  })
  .passthrough()

const EntrepriseRawSchema = z
  .object({
    siren: z.string().optional().nullable(),
    nom_complet: z.string().optional().nullable(),
    nom_raison_sociale: z.string().optional().nullable(),
    dirigeants: z.array(DirigeantRawSchema).optional().nullable(),
    siege: SiegeRawSchema.optional().nullable(),
  })
  .passthrough()

const ApiResponseSchema = z
  .object({
    results: z.array(EntrepriseRawSchema).optional().nullable(),
    total_results: z.number().optional().nullable(),
  })
  .passthrough()

type ApiResponse = z.infer<typeof ApiResponseSchema>

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

/**
 * Normalise une chaîne pour le tri (trim + lowercase). Ne mute pas la valeur
 * d'origine — utilisé uniquement pour la comparaison interne.
 */
function normalizeForSort(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/**
 * Calcule le rang de priorité d'une qualité dirigeant.
 * Plus le rang est bas, plus la qualité est prioritaire.
 */
function rankOfQualite(qualite: string): number {
  const normalized = normalizeForSort(qualite)
  if (!normalized) return RANK_FALLBACK

  for (const { rank, match } of QUALITES_PRIORITAIRES) {
    if (normalized.includes(match)) return rank
  }
  return RANK_FALLBACK
}

function logInfo(siren: string, phase: string, extra: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      level: 'info',
      module: LOG_MODULE,
      siren,
      phase,
      ...extra,
    }),
  )
}

function logWarn(siren: string, phase: string, extra: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      level: 'warn',
      module: LOG_MODULE,
      siren,
      phase,
      ...extra,
    }),
  )
}

// ------------------------------------------------------------
// SORT (exporté pour test isolé)
// ------------------------------------------------------------

/**
 * Trie les dirigeants par ordre de priorité fonctionnelle :
 *   Président > DG > Gérant > Administrateur > autres.
 * Les personnes morales sont placées en fin de liste (rang fallback).
 *
 * Stable : préserve l'ordre d'origine pour les égalités.
 */
export function sortDirigeants(dirigeants: Dirigeant[]): Dirigeant[] {
  return dirigeants
    .map((d, idx) => ({ d, idx, rank: d.type === 'morale' ? RANK_FALLBACK : rankOfQualite(d.qualite) }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank
      return a.idx - b.idx
    })
    .map((x) => x.d)
}

// ------------------------------------------------------------
// MAPPING — raw API → types publics
// ------------------------------------------------------------

function mapDirigeantType(typeDirigeant: string | null | undefined): 'physique' | 'morale' {
  const normalized = normalizeForSort(typeDirigeant)
  // L'API renvoie typiquement "personne physique" ou "personne morale".
  if (normalized.includes('morale')) return 'morale'
  return 'physique'
}

function mapDirigeant(raw: z.infer<typeof DirigeantRawSchema>): Dirigeant {
  return {
    nom: (raw.nom ?? '').trim(),
    prenoms: (raw.prenoms ?? '').trim(),
    qualite: (raw.qualite ?? '').trim(),
    type: mapDirigeantType(raw.type_dirigeant),
  }
}

function mapSiege(raw: z.infer<typeof SiegeRawSchema> | null | undefined): SiegeInfo {
  if (!raw) {
    return {
      adresse: null,
      codePostal: null,
      commune: null,
      telephone: null,
      email: null,
      siteWeb: null,
    }
  }

  const adresse = raw.adresse?.trim() ?? null
  const codePostal = raw.code_postal?.trim() ?? null
  // L'API utilise `libelle_commune` ; fallback éventuel sur `commune`.
  const commune = raw.libelle_commune?.trim() ?? raw.commune?.trim() ?? null

  return {
    adresse: adresse && adresse.length > 0 ? adresse : null,
    codePostal: codePostal && codePostal.length > 0 ? codePostal : null,
    commune: commune && commune.length > 0 ? commune : null,
    // L'API Recherche Entreprises n'expose pas téléphone / email / site web :
    // on les laisse à null (l'enrichissement viendra de Pappers/Hunter).
    telephone: null,
    email: null,
    siteWeb: null,
  }
}

// ------------------------------------------------------------
// FONCTION PRINCIPALE
// ------------------------------------------------------------

/**
 * Récupère les dirigeants + le siège d'une entreprise via l'API Recherche
 * Entreprises (api.gouv.fr).
 *
 * Gratuit, sans auth, 7 req/sec.
 * Timeout configurable (défaut 5s) via AbortSignal.
 *
 * Retourne `null` si :
 *   - SIREN inconnu (aucun résultat)
 *   - Erreur réseau (timeout, DNS, etc.)
 *   - HTTP non-2xx
 *   - JSON mal formé (schema Zod KO)
 *
 * Pas de circuit breaker ici — géré au niveau orchestrator.
 */
export async function fetchRechercheEntreprisesData(
  siren: string,
  options: { timeoutMs?: number } = {},
): Promise<RechercheEntreprisesResult | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (!siren || !/^\d{9}$/.test(siren)) {
    logWarn(siren, 'validate', { msg: 'SIREN invalide' })
    return null
  }

  const url = new URL(API_URL)
  url.searchParams.set('q', siren)
  url.searchParams.set('page', '1')
  url.searchParams.set('per_page', '1')

  logInfo(siren, 'fetch', { msg: 'appel API', timeout_ms: timeoutMs })

  let response: Response
  try {
    response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isAbort = err instanceof Error && err.name === 'AbortError'
    logWarn(siren, 'fetch', {
      msg: isAbort ? 'timeout' : 'erreur réseau',
      error: message,
    })
    return null
  }

  if (!response.ok) {
    logWarn(siren, 'http', {
      msg: 'réponse non-2xx',
      status: response.status,
    })
    return null
  }

  let rawJson: unknown
  try {
    rawJson = await response.json()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logWarn(siren, 'parse', { msg: 'JSON invalide', error: message })
    return null
  }

  const parsed = ApiResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    logWarn(siren, 'schema', {
      msg: 'schema Zod KO',
      issues_count: parsed.error.issues.length,
    })
    return null
  }

  return buildResultFromApi(siren, parsed.data)
}

function buildResultFromApi(siren: string, data: ApiResponse): RechercheEntreprisesResult | null {
  const entreprise = data.results?.[0]
  if (!entreprise) {
    logInfo(siren, 'result', { msg: 'aucun résultat', total_results: data.total_results ?? 0 })
    return null
  }

  const rawDirigeants = entreprise.dirigeants ?? []
  // Conserve uniquement les dirigeants avec au moins un nom non vide.
  const dirigeants: Dirigeant[] = rawDirigeants
    .map(mapDirigeant)
    .filter((d) => d.nom.length > 0)

  // Dirigeant principal : on exclut les personnes morales (cf. spec — un
  // dirigeantPrincipal doit être une personne physique appelable).
  const physiques = dirigeants.filter((d) => d.type === 'physique')
  const sorted = sortDirigeants(physiques)
  const dirigeantPrincipal = sorted[0] ?? null

  const result: RechercheEntreprisesResult = {
    siren,
    raisonSociale:
      entreprise.nom_complet?.trim() ||
      entreprise.nom_raison_sociale?.trim() ||
      null,
    dirigeants,
    dirigeantPrincipal,
    siege: mapSiege(entreprise.siege ?? null),
  }

  logInfo(siren, 'done', {
    msg: 'résultat construit',
    dirigeants_count: dirigeants.length,
    physiques_count: physiques.length,
    has_principal: Boolean(dirigeantPrincipal),
    has_siege_adresse: Boolean(result.siege.adresse),
  })

  return result
}
