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

/** URL de recherche par SIREN (fallback quand on n'a pas l'identifiant du bilan). */
const BEGES_SEARCH_BASE = `https://${BEGES_HOST}/bilans`

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
 * Priorité :
 *   1. `prospect.beges_url` s'il pointe vers une fiche (pas la home ADEME).
 *   2. Fallback : recherche par SIREN sur bilans-ges.ademe.fr.
 *   3. `null` si aucune URL exploitable (pas de SIREN valide).
 *
 * @example
 * buildBegesUrl({ beges_url: 'https://bilans-ges.ademe.fr/bilans/abc123', siren: '123456789' })
 * // => 'https://bilans-ges.ademe.fr/bilans/abc123'
 *
 * buildBegesUrl({ beges_url: undefined, siren: '123456789' })
 * // => 'https://bilans-ges.ademe.fr/bilans?q=123456789'
 *
 * buildBegesUrl({ beges_url: 'https://www.ademe.fr', siren: '123456789' })
 * // => 'https://bilans-ges.ademe.fr/bilans?q=123456789'  (homepage rejetée)
 */
export function buildBegesUrl(
  prospect: Pick<Prospect, 'beges_url' | 'siren'>,
): string | null {
  if (isUsableBegesUrl(prospect.beges_url)) {
    // Garanti non-null par isUsableBegesUrl
    return prospect.beges_url as string
  }

  if (isValidSiren(prospect.siren)) {
    // L'interface publique de bilans-ges.ademe.fr utilise `q` comme paramètre
    // de recherche full-text — un SIREN à 9 chiffres pré-filtre la liste.
    const url = new URL(BEGES_SEARCH_BASE)
    url.searchParams.set('q', prospect.siren)
    return url.toString()
  }

  return null
}
