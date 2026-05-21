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

/**
 * Base URL pour la fiche d'identité d'un bilan via UUID Data Fair.
 * Format validé 2026-05-22 : le SPA bilans-ges.ademe.fr expose les fiches
 * sur `/bilans/consultation/<UUID>/fiche-identite` (et pas `/bilans/<UUID>`
 * comme on aurait pu le penser).
 */
const BEGES_FICHE_BASE = `https://${BEGES_HOST}/bilans/consultation`
const BEGES_FICHE_SUFFIX = '/fiche-identite'

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
 * Stratégie (validée 2026-05-22 via Playwright sur 4 prospects) :
 *   1. **Fiche directe Data Fair** : `bilan_ges_data.id` → URL
 *      `/bilans/consultation/<UUID>/fiche-identite`. C'est le format
 *      reconnu par le SPA bilans-ges.ademe.fr post-migration. Validé
 *      sur EDF ENR + BOEHRINGER + TRIMET.
 *   2. **Recherche par SIREN** sur `/bilans?q=<SIREN>` en fallback —
 *      utilise le moteur de recherche du site (atterrit sur la liste
 *      filtrée). Moins direct mais garanti opérationnel.
 *   3. **`prospect.beges_url`** stocké (UUID CKAN legacy, pré-2026)
 *      en dernier recours — peut ne plus fonctionner depuis la
 *      migration ADEME janvier 2026.
 *   4. `null` si rien d'exploitable.
 *
 * Historique des tentatives :
 *   - `/bilans/<UUID>` direct (commit f9a1a12) → 404 logique côté SPA.
 *   - `/bilans?q=<SIREN>` direct (commit da69b0c) → SPA ignorait le
 *     param et affichait la liste générique non filtrée.
 *   - `/bilans/consultation/<UUID>/fiche-identite` → ✅ marche.
 */
export function buildBegesUrl(
  prospect: Pick<Prospect, 'beges_url' | 'siren' | 'bilan_ges_data'>,
): string | null {
  // 1. UUID Data Fair → fiche-identite directe (format validé prod).
  const dataFairUuid = extractDataFairUuid(prospect.bilan_ges_data)
  if (dataFairUuid) {
    return `${BEGES_FICHE_BASE}/${dataFairUuid}${BEGES_FICHE_SUFFIX}`
  }

  // 2. Fallback recherche SIREN — atterrit sur la liste filtrée par SIREN.
  if (isValidSiren(prospect.siren)) {
    const url = new URL(BEGES_SEARCH_BASE)
    url.searchParams.set('q', prospect.siren)
    return url.toString()
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
