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
 * Stratégie (fix 2026-05-22 — post-migration ADEME) :
 *   1. **Recherche par SIREN** sur `bilans-ges.ademe.fr/bilans?q=<SIREN>` —
 *      c'est l'URL générée par le moteur de recherche du site lui-même
 *      (taper un SIREN dans la barre → URL `?q=<SIREN>`). Garanti reconnu
 *      par le SPA actuel quel que soit l'âge du bilan.
 *   2. **`bilan_ges_data.id`** (UUID Data Fair) en fallback si pas de SIREN —
 *      moins fiable côté frontend ADEME post-migration mais mieux que rien.
 *   3. **`prospect.beges_url`** stocké (UUID CKAN legacy) en dernier recours.
 *   4. `null` si rien d'exploitable.
 *
 * NB : Les URLs `/bilans/<UUID>` directes (Data Fair ou CKAN legacy) ne sont
 * pas systématiquement résolues par le SPA bilans-ges.ademe.fr post-migration
 * janvier 2026 — même un UUID Data Fair valide peut renvoyer une vue vide.
 * La recherche `?q=<SIREN>` reste la voie sûre.
 */
export function buildBegesUrl(
  prospect: Pick<Prospect, 'beges_url' | 'siren' | 'bilan_ges_data'>,
): string | null {
  // 1. Recherche SIREN — voie sûre, garantie de retomber sur le bon bilan.
  if (isValidSiren(prospect.siren)) {
    const url = new URL(BEGES_SEARCH_BASE)
    url.searchParams.set('q', prospect.siren)
    return url.toString()
  }

  // 2. Fallback UUID Data Fair si pas de SIREN exploitable.
  const dataFairUuid = extractDataFairUuid(prospect.bilan_ges_data)
  if (dataFairUuid) {
    return `${BEGES_FICHE_BASE}/${dataFairUuid}`
  }

  // 3. Dernier recours : beges_url stocké tel quel (peut être obsolète).
  if (isUsableBegesUrl(prospect.beges_url)) {
    return prospect.beges_url as string
  }

  return null
}

/**
 * Extrait l'UUID Data Fair (champ `id`) du payload bilan_ges_data.
 * Renvoie `null` si absent ou mal formé.
 */
function extractDataFairUuid(bilanGesData: unknown): string | null {
  if (!bilanGesData || typeof bilanGesData !== 'object') return null
  const data = bilanGesData as Record<string, unknown>
  const id = data.id
  if (typeof id !== 'string') return null
  if (!UUID_REGEX.test(id)) return null
  return id
}
