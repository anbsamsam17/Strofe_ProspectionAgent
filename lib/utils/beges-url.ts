// ============================================================
// BEGES URL HELPER
// Construit une URL directe vers le bilan BEGES d'une entreprise
// sur bilans-ges.ademe.fr.
// ============================================================

import type { Prospect } from '@/lib/types'

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

/** Domaine officiel des bilans BEGES publiés par l'ADEME. */
const BEGES_HOST = 'bilans-ges.ademe.fr'

/** Base URL pour les fiches BEGES individuelles (UUID Data Fair). */
const BEGES_FICHE_BASE = `https://${BEGES_HOST}/bilans`

/** URL de recherche par SIREN (fallback quand on n'a pas l'UUID Data Fair). */
const BEGES_SEARCH_BASE = `https://${BEGES_HOST}/bilans`

/** Regex UUID v4 / v1 — accepte les deux formats utilisés par Data Fair. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Préfixe d'une URL ADEME qui n'est PAS un lien direct vers une fiche
 * (home, racine, etc.). On considère qu'un BEGES_URL stocké qui matche
 * ces patterns doit être remplacé par notre fallback siren-based.
 */
const ADEME_HOMEPAGE_PATTERNS: ReadonlyArray<RegExp> = [
  /^https?:\/\/(?:www\.)?ademe\.fr\/?$/i,
  /^https?:\/\/(?:www\.)?bilans-ges\.ademe\.fr\/?$/i,
  /^https?:\/\/(?:www\.)?bilans-ges\.ademe\.fr\/(?:bilans\/?|search\/?|home\/?)?$/i,
]

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

/** Une URL stockée vide / homepage / non valide doit être remplacée. */
function isUsableBegesUrl(url: string | undefined | null): boolean {
  if (!url) return false
  const trimmed = url.trim()
  if (trimmed.length === 0) return false
  if (!/^https?:\/\//i.test(trimmed)) return false
  // Rejet des URLs racine ADEME / bilans-ges qui ne pointent pas sur une fiche.
  for (const pattern of ADEME_HOMEPAGE_PATTERNS) {
    if (pattern.test(trimmed)) return false
  }
  return true
}

/** Vérifie qu'un SIREN est exploitable pour construire une URL de recherche. */
function isValidSiren(siren: string | undefined | null): siren is string {
  return typeof siren === 'string' && /^\d{9}$/.test(siren)
}

// ------------------------------------------------------------
// API PUBLIQUE
// ------------------------------------------------------------

/**
 * Construit l'URL vers le BEGES d'un prospect.
 *
 * Priorité (fix 2026-05-22 — migration ADEME CKAN → Data Fair) :
 *   1. `bilan_ges_data.id` (UUID Data Fair actuel) si présent → fiche directe.
 *   2. `prospect.beges_url` UNIQUEMENT s'il pointe vers `/bilans/<UUID>` —
 *      les anciens UUIDs CKAN (pre-2026) sont obsolètes côté nouveau site
 *      ADEME (404 logiciel), on les rejette même si stockés en DB.
 *   3. Fallback : recherche par SIREN sur bilans-ges.ademe.fr (toujours OK).
 *   4. `null` si aucune URL exploitable (pas de SIREN valide).
 *
 * NB : Les anciens UUIDs CKAN stockés en `beges_url` ressemblent à
 * `9386bece-b1cd-11ed-8fce-005056b7acd1` (avec préfixe TTL CKAN) tandis
 * que les nouveaux UUIDs Data Fair sont des v4 standard. On préfère
 * TOUJOURS `bilan_ges_data.id` quand disponible — c'est le seul UUID
 * garanti reconnu par le site bilans-ges.ademe.fr actuel.
 */
export function buildBegesUrl(
  prospect: Pick<Prospect, 'beges_url' | 'siren' | 'bilan_ges_data'>,
): string | null {
  // 1. UUID Data Fair extrait du JSONB (priorité maximale post-migration 2026).
  const dataFairUuid = extractDataFairUuid(prospect.bilan_ges_data)
  if (dataFairUuid) {
    return `${BEGES_FICHE_BASE}/${dataFairUuid}`
  }

  // 2. beges_url stocké — uniquement si fiche `/bilans/<UUID>` valide.
  if (isUsableBegesUrl(prospect.beges_url)) {
    return prospect.beges_url as string
  }

  // 3. Fallback recherche SIREN — TOUJOURS opérationnel sur bilans-ges.ademe.fr.
  if (isValidSiren(prospect.siren)) {
    const url = new URL(BEGES_SEARCH_BASE)
    url.searchParams.set('q', prospect.siren)
    return url.toString()
  }

  return null
}

/**
 * Extrait l'UUID Data Fair (champ `id`) du payload bilan_ges_data
 * — celui que reconnait le site ADEME actuel. Renvoie `null` si
 * absent ou mal formé.
 */
function extractDataFairUuid(bilanGesData: unknown): string | null {
  if (!bilanGesData || typeof bilanGesData !== 'object') return null
  const data = bilanGesData as Record<string, unknown>
  const id = data.id
  if (typeof id !== 'string') return null
  if (!UUID_REGEX.test(id)) return null
  return id
}
