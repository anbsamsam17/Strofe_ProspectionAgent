// ============================================================
// SOURCING MAPPING — Helpers UI → Sirene / Recherche Entreprises
// Initiative : fix/sourcing-pagination (Wave 2.2)
// Spec       : .claude/context/sourcing-param-mapping.md
//
// Trois fonctions pures, testables :
//   - mapEffectifToTranches(min, max)    → codes tranche INSEE
//   - mapRegionToCodePostal(label)       → range [cpMin, cpMax]
//   - mapRegionToDepartements(label)     → codes département (fallback)
//   - computeFiltersSignature(params)    → SHA-256 12 chars (invalidation curseur)
// ============================================================

import { createHash } from 'node:crypto'

// ------------------------------------------------------------
// 1. EFFECTIFS — plage humaine → tranches INSEE
// ------------------------------------------------------------

/**
 * Table de référence INSEE — code tranche → [effectif_min, effectif_max].
 * Voir spec §1.1 : https://www.sirene.fr/sirene/public/variable/trancheEffectifsUniteLegale
 */
const INSEE_TRANCHES: ReadonlyArray<readonly [string, number, number]> = [
  ['00', 0, 0],
  ['01', 1, 2],
  ['02', 3, 5],
  ['03', 6, 9],
  ['11', 10, 19],
  ['12', 20, 49],
  ['21', 50, 99],
  ['22', 100, 199],
  ['31', 200, 249],
  ['32', 250, 499],
  ['41', 500, 999],
  ['42', 1_000, 1_999],
  ['51', 2_000, 4_999],
  ['52', 5_000, 9_999],
  ['53', 10_000, 99_999],
]

/** Défaut legacy : 50+ salariés (cible BEGES standard, cohérent avec ancien hardcoded [21 TO 53]). */
const DEFAULT_TRANCHES = ['21', '22', '31', '32', '41', '42', '51', '52', '53']

/**
 * Convertit une plage `[min, max]` d'effectifs humains en codes tranche INSEE.
 * Une tranche est incluse ssi son intervalle [trMin, trMax] chevauche [min, max].
 *
 * Comportement :
 *   - `min` ou `max` `undefined` → défaut legacy 50+ salariés.
 *   - `min > max` → throw (incohérence, doit être validée côté Zod).
 *   - Plage hors bornes (ex. min=20000, max=30000) → retourne `['53']`.
 *
 * @param min effectif minimum (>= 0)
 * @param max effectif maximum (>= min)
 * @returns liste triée de codes tranche INSEE
 */
export function mapEffectifToTranches(
  min: number | undefined,
  max: number | undefined,
): string[] {
  if (min === undefined || max === undefined) {
    return [...DEFAULT_TRANCHES]
  }

  if (min < 0 || max < 0) {
    throw new Error(
      `mapEffectifToTranches: effectif négatif interdit (min=${min}, max=${max})`,
    )
  }

  if (min > max) {
    throw new Error(
      `mapEffectifToTranches: min (${min}) > max (${max}) — incohérence`,
    )
  }

  const tranches = INSEE_TRANCHES
    .filter(([, trMin, trMax]) => trMin <= max && trMax >= min)
    .map(([code]) => code)

  // Fallback : si la plage utilisateur ne chevauche aucune tranche (ex. trous historiques),
  // retomber sur le défaut legacy pour ne pas générer un filtre Lucene vide.
  if (tranches.length === 0) {
    return [...DEFAULT_TRANCHES]
  }

  return tranches
}

// ------------------------------------------------------------
// 2. GÉOGRAPHIE — label/code → codePostalRange + departements
// ------------------------------------------------------------

/**
 * Table de mapping label canonique → liste de départements.
 * Spec §2.2 — toutes les clés sont normalisées (lowercase, sans accents).
 */
const LABEL_TO_DEPARTEMENTS: ReadonlyMap<string, readonly string[]> = new Map([
  // Départements simples (Nouvelle-Aquitaine)
  ['gironde', ['33']],
  ['33', ['33']],
  ['bordeaux', ['33']], // sur-couverture Gironde côté fallback
  ['dordogne', ['24']],
  ['24', ['24']],
  ['landes', ['40']],
  ['40', ['40']],
  ['lot-et-garonne', ['47']],
  ['lot et garonne', ['47']],
  ['47', ['47']],
  ['pyrenees-atlantiques', ['64']],
  ['pyrenees atlantiques', ['64']],
  ['64', ['64']],
  ['charente', ['16']],
  ['16', ['16']],
  ['charente-maritime', ['17']],
  ['charente maritime', ['17']],
  ['17', ['17']],
  ['correze', ['19']],
  ['19', ['19']],
  ['creuse', ['23']],
  ['23', ['23']],
  ['deux-sevres', ['79']],
  ['deux sevres', ['79']],
  ['79', ['79']],
  ['vienne', ['86']],
  ['86', ['86']],
  ['haute-vienne', ['87']],
  ['haute vienne', ['87']],
  ['87', ['87']],
  // Régions
  [
    'nouvelle-aquitaine',
    ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'],
  ],
  [
    'nouvelle aquitaine',
    ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'],
  ],
  ['naq', ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87']],
  // Île-de-France et grandes villes
  ['paris', ['75']],
  ['75', ['75']],
  ['rhone', ['69']],
  ['69', ['69']],
  ['ile-de-france', ['75', '77', '78', '91', '92', '93', '94', '95']],
  ['ile de france', ['75', '77', '78', '91', '92', '93', '94', '95']],
  ['idf', ['75', '77', '78', '91', '92', '93', '94', '95']],
])

/** Défaut legacy : Gironde uniquement (compat historique). */
const DEFAULT_DEPARTEMENTS: readonly string[] = ['33']
const DEFAULT_CODE_POSTAL_RANGE: readonly [string, string] = ['33000', '33999']

/** Sentinelle : pas de filtre géographique (France entière). */
const FRANCE_LABELS: ReadonlySet<string> = new Set(['france', 'fr', ''])

/**
 * Normalise un label région (lowercase, sans accents).
 * Implémentation compatible Node : NFD + suppression des diacritiques.
 */
function normalizeRegionLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Convertit un label région / code département en range de codes postaux `[min, max]`.
 *
 * Comportement :
 *   - `undefined` / vide / `"France"` → range étendue nationale (`['00000','99999']`).
 *   - Label/code reconnu (Gironde, 33, Nouvelle-Aquitaine, etc.) → range borné sur les départements.
 *   - Label non reconnu → fallback Gironde + log warn (compat historique).
 *
 * @param label libellé région ou code département (2-3 chiffres)
 * @returns tuple `[cpMin, cpMax]` à utiliser dans `codePostalRange`
 */
export function mapRegionToCodePostal(
  label: string | undefined,
): [string, string] {
  if (!label?.trim()) {
    return ['00000', '99999']
  }

  const normalized = normalizeRegionLabel(label)

  // France entière → range nationale (pas de filtre effectif)
  if (FRANCE_LABELS.has(normalized)) {
    return ['00000', '99999']
  }

  const depts = LABEL_TO_DEPARTEMENTS.get(normalized)
  if (depts) {
    return computeCodePostalRangeFromDepartements(depts)
  }

  // Code département direct (2 ou 3 chiffres non listé explicitement)
  if (/^\d{2,3}$/.test(normalized)) {
    return computeCodePostalRangeFromDepartements([normalized])
  }

  // Fallback : log warn + Gironde (compat historique)
  console.log(
    JSON.stringify({
      level: 'warn',
      module: 'sourcing-mapping',
      msg: `targetRegion non reconnue: "${label}" — fallback Gironde`,
    }),
  )
  return [DEFAULT_CODE_POSTAL_RANGE[0], DEFAULT_CODE_POSTAL_RANGE[1]]
}

/**
 * Calcule le range CP `[min, max]` à partir d'une liste de départements.
 *
 * Pour un département 2 chiffres : range `[NN000, NN999]`.
 * Pour plusieurs départements : range englobant min/max (sur-couverture acceptable
 * côté Sirene, le filtrage exact se fait côté fallback via `departements`).
 *
 * Note : Lucene `[A TO B]` est une comparaison lexicographique, donc `33000` < `34000`
 * fonctionne comme attendu sur des codes postaux à longueur fixe.
 */
function computeCodePostalRangeFromDepartements(
  depts: readonly string[],
): [string, string] {
  if (depts.length === 0) {
    return ['00000', '99999']
  }

  const ranges = depts.map((d) => {
    // Département à 2 chiffres → CP NN000-NN999. 3 chiffres (DROM) → CP NNN00-NNN99.
    if (d.length === 2) {
      return [`${d}000`, `${d}999`] as const
    }
    if (d.length === 3) {
      return [`${d}00`, `${d}99`] as const
    }
    // Fallback défensif : ne devrait pas arriver (validé en amont)
    return [`${d}`, `${d}`] as const
  })

  const min = ranges.reduce((acc, [a]) => (a < acc ? a : acc), ranges[0][0])
  const max = ranges.reduce((acc, [, b]) => (b > acc ? b : acc), ranges[0][1])
  return [min, max]
}

/**
 * Convertit un label région / code département en liste de codes département INSEE.
 *
 * Utilisé par le fallback Recherche Entreprises qui filtre via `?departement=33,75`.
 *
 * @param label libellé région ou code département
 * @returns liste de codes département (vide si France entière)
 */
export function mapRegionToDepartements(
  label: string | undefined,
): string[] {
  if (!label?.trim()) {
    return []
  }

  const normalized = normalizeRegionLabel(label)

  if (FRANCE_LABELS.has(normalized)) {
    return []
  }

  const depts = LABEL_TO_DEPARTEMENTS.get(normalized)
  if (depts) {
    return [...depts]
  }

  if (/^\d{2,3}$/.test(normalized)) {
    return [normalized]
  }

  // Fallback Gironde (cohérent avec mapRegionToCodePostal)
  return [...DEFAULT_DEPARTEMENTS]
}

// ------------------------------------------------------------
// 3. SIGNATURE FILTRES — invalidation curseur
// ------------------------------------------------------------

/**
 * Calcule une signature stable des filtres effectifs d'un sourcing run.
 * Spec §3.3 : SHA-256 tronqué à 12 caractères hex.
 *
 * Inclus dans la signature : tranches d'effectifs, range CP, codes NAF (normalisés).
 * Exclus : excludeSirens (varie à chaque run), maxResults (non sémantique).
 *
 * @returns hash hex de 12 caractères (collisions négligeables à l'échelle d'un user)
 */
export function computeFiltersSignature(params: {
  tranches: string[]
  codePostalRange: [string, string]
  nafCodes: string[]
}): string {
  const tranchesPart = [...params.tranches].sort().join(',')
  const cpPart = `${params.codePostalRange[0]}-${params.codePostalRange[1]}`
  // Normalisation NAF cohérente avec lib/agent/sourcing.ts (uppercase, sans point)
  const nafPart = [...params.nafCodes]
    .map((c) => c.replace('.', '').trim().toUpperCase())
    .filter((c) => c.length > 0)
    .sort()
    .join(',')

  const payload = `${tranchesPart}|${cpPart}|${nafPart}`
  return createHash('sha256').update(payload).digest('hex').slice(0, 12)
}
