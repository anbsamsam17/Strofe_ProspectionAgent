// ============================================================
// NAF SECTOR MAPPING — Agent IA Prospection Bilan Carbone
//
// 2026-05-14 — Fix bug "catégorisation NAF". L'UI Settings stocke
// `target_sectors` en libellés français (ex. "Industrie manufacturière")
// alors que `resolveSourcingFilters` attend des codes NAF format `XX.XXX`.
// Sans ce mapping, le filtre regex rejette tous les libellés et l'agent
// retombe silencieusement sur NAF_PRIORITAIRES_DEFAULT — l'utilisateur
// croit cibler "Transport" mais l'agent ramène viticulture, aéro, etc.
//
// Ce module est l'intermédiaire :
//   - `normalizeNafCode(input)` : `0121Z` / `01.21z` / `01.21Z` → `01.21Z`.
//   - `resolveNafFromInput(items)` : mix de codes + libellés → codes NAF.
//   - `matchesAnyNaf(naf, allowed)` : compare deux NAF avec tolérance
//     point/sans point (utilisé pour filtrer les résultats Sirene/fallback).
//
// IMPORTANT : ce module reste indépendant de `lib/constants/naf-codes.ts`
// (livré par Agent N4 — nomenclature complète 700+ codes). Quand cette
// constante existera, on pourra étoffer LABEL_TO_NAF_CODES sans casser
// l'API publique de ce fichier.
// ============================================================

// ------------------------------------------------------------
// REGEX NAF
// ------------------------------------------------------------

/** Format NAF canonique attendu en interne : `XX.XXY` (5 chars + point). */
export const NAF_CODE_REGEX = /^\d{2}\.\d{2}[A-Z]$/

/** Format NAF sans point : `XXXXY` (4 chiffres + 1 lettre). */
const NAF_CODE_NO_DOT_REGEX = /^\d{4}[A-Z]$/

// ------------------------------------------------------------
// TABLE LABEL → CODES NAF
// ------------------------------------------------------------
//
// Chaque libellé UI (cf. `app/(dashboard)/settings/page.tsx:10-26`,
// `SECTEURS_DISPONIBLES`) est mappé vers une liste de codes NAF cohérents
// avec `NAF_PRIORITAIRES_DEFAULT` (cf. `sourcing-runner.ts`).
//
// Les clés sont normalisées (lowercase + diacritiques supprimés) — voir
// `normalizeLabel` pour la fonction.
//
// Cette table est volontairement conservatrice : on privilégie 4-8 codes
// par libellé pour rester compatible avec la limite Solr Sirene (~25
// codes par OR avant chunking). En cas de besoin de couverture plus large,
// l'utilisateur peut sélectionner plusieurs libellés.
// ------------------------------------------------------------

const LABEL_TO_NAF_CODES: ReadonlyMap<string, readonly string[]> = new Map([
  [
    'industrie manufacturiere',
    [
      '10.11Z', '10.13A', '10.32Z', '10.51A', '10.71A', // Agro
      '20.11Z', '20.14Z', '20.15Z',                     // Chimie
      '23.11Z', '23.13Z',                               // Verre
      '24.10Z', '24.20Z',                               // Sidérurgie
      '25.11Z', '25.29Z',                               // Structures métalliques
      '28.11Z', '28.15Z',                               // Moteurs / engrenages
      '30.30Z',                                         // Aéronautique
    ],
  ],
  [
    'transport et logistique',
    [
      '49.41A', '49.41B', // Transport routier
      '52.10B', '52.21Z', // Entreposage / services annexes
      '52.29A',           // Messagerie
    ],
  ],
  [
    'construction et btp',
    [
      '41.20A', '41.20B', // Bâtiments
      '42.11Z', '42.13A', // Routes / ponts
      '43.21A', '43.22A', // Travaux d'installation
    ],
  ],
  [
    'commerce de gros',
    [
      '46.17B', // Commerce intermédiaire agro
      '46.71Z', '46.72Z', // Combustibles / métaux
    ],
  ],
  [
    'commerce de detail',
    [
      '47.30Z', // Carburants
    ],
  ],
  [
    'energie et utilities',
    [
      '35.11Z', '35.14Z', // Production / commerce électricité
      '38.11Z', '38.21Z', // Collecte / traitement déchets
    ],
  ],
  [
    'agriculture',
    [
      '01.21Z', '01.22Z', // Viticulture
    ],
  ],
  [
    'hotellerie et restauration',
    [
      '55.10Z', // Hôtels
      '56.10A', // Restauration
    ],
  ],
  [
    'sante',
    [
      '86.10Z', // Activités hospitalières
    ],
  ],
  // Libellés UI sans mapping NAF prioritaire connu — on les liste explicitement
  // pour les logger comme "non mappés" plutôt que comme "label inconnu".
  // L'utilisateur sait alors que sa sélection est ignorée (pas de codes NAF
  // pertinents pour le bilan carbone dans la nomenclature actuelle).
  ['services aux entreprises', []],
  ['immobilier', []],
  ['finance et assurance', []],
  ['technologies', []],
  ['education', []],
  ['administration publique', []],

  // Aliases legacy — libellés courts utilisés par d'anciens profils onboardés
  // (avant la refonte UI vers les NAF multi-select 501 codes). Sans ces alias,
  // les codes tombent en "unknown_labels" → fallback silencieux sur les 41 codes
  // NAF_PRIORITAIRES_DEFAULT (cf. R5 cause #3).
  [
    'viticulture',
    ['01.21Z', '01.22Z'], // Culture de la vigne, autres fruits à pépins/noyaux
  ],
  [
    'aeronautique',
    ['30.30Z'], // Construction aéronautique et spatiale
  ],
  [
    'logistique',
    ['49.41A', '49.41B', '52.10B', '52.21Z', '52.29A'],
  ],
  [
    'agroalimentaire',
    ['10.11Z', '10.13A', '10.32Z', '10.51A', '10.71A', '46.17B'],
  ],
  [
    'conseil',
    ['70.21Z', '70.22Z'], // Conseil RP / Conseil affaires
  ],
  [
    'bureau d etudes',
    ['71.12B', '71.20B'], // Ingénierie, études techniques / Analyses essais
  ],
])

// ------------------------------------------------------------
// NORMALISATION
// ------------------------------------------------------------

/**
 * Normalise un libellé pour matching (lowercase + diacritiques supprimés).
 * Identique à la stratégie de `normalizeRegionLabel` dans sourcing-mapping.ts.
 */
function normalizeLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Normalise un code NAF vers le format canonique `XX.XXY` (avec point, uppercase).
 *
 * Accepte :
 *   - `01.21Z` (canonique) → `01.21Z`
 *   - `0121Z` (sans point) → `01.21Z`
 *   - `01.21z` (casse) → `01.21Z`
 *   - `0121z` → `01.21Z`
 *
 * Retourne `null` si l'input ne ressemble pas à un code NAF (lettre absente,
 * trop court, contient autre chose).
 */
export function normalizeNafCode(input: string | null | undefined): string | null {
  if (!input) return null
  const cleaned = input.trim().toUpperCase()
  if (cleaned.length === 0) return null

  // Cas 1 : déjà au format canonique
  if (NAF_CODE_REGEX.test(cleaned)) return cleaned

  // Cas 2 : sans point → insertion à la position 2
  if (NAF_CODE_NO_DOT_REGEX.test(cleaned)) {
    return `${cleaned.slice(0, 2)}.${cleaned.slice(2)}`
  }

  // Cas 3 : variantes parasites (espaces internes, points multiples...).
  // On retire tout caractère non alphanumérique, puis on retente.
  const stripped = cleaned.replace(/[^A-Z0-9]/g, '')
  if (NAF_CODE_NO_DOT_REGEX.test(stripped)) {
    return `${stripped.slice(0, 2)}.${stripped.slice(2)}`
  }

  return null
}

/**
 * Indique si une chaîne ressemble (après normalisation) à un code NAF.
 * Utilisé par `resolveNafFromInput` pour distinguer "code NAF" de "libellé secteur".
 */
function looksLikeNafCode(input: string): boolean {
  return normalizeNafCode(input) !== null
}

// ------------------------------------------------------------
// RÉSOLUTION : codes + libellés → codes NAF normalisés
// ------------------------------------------------------------

export interface ResolveNafResult {
  /** Codes NAF résolus au format canonique `XX.XXY`, dédupliqués, ordre préservé. */
  codes: string[]
  /** Libellés non reconnus (ni code NAF valide, ni libellé dans le mapping). */
  unknownLabels: string[]
  /** Libellés mappés mais sans code NAF associé (ex. "Technologies"). */
  unmappedLabels: string[]
}

/**
 * Convertit une liste mixte de codes NAF + libellés UI en codes NAF normalisés.
 *
 * Comportement :
 *   - Une entrée détectée comme code NAF (`01.21Z`, `0121Z`, etc.) est
 *     normalisée et ajoutée à `codes`.
 *   - Une entrée détectée comme libellé est expandée via `LABEL_TO_NAF_CODES`.
 *     Si la liste mappée est vide, le libellé est rapporté dans `unmappedLabels`.
 *   - Une entrée ni-code-ni-libellé reconnu va dans `unknownLabels`.
 *   - Les doublons (après normalisation) sont supprimés en conservant l'ordre
 *     de première apparition (stabilité du chunking Sirene).
 *
 * @param items mix de codes NAF et libellés UI (chaînes brutes du formulaire user)
 */
export function resolveNafFromInput(items: readonly string[]): ResolveNafResult {
  const codes: string[] = []
  const seen = new Set<string>()
  const unknownLabels: string[] = []
  const unmappedLabels: string[] = []

  const pushCode = (raw: string): void => {
    const normalized = normalizeNafCode(raw)
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized)
      codes.push(normalized)
    }
  }

  for (const rawItem of items) {
    if (typeof rawItem !== 'string') continue
    const item = rawItem.trim()
    if (item.length === 0) continue

    if (looksLikeNafCode(item)) {
      pushCode(item)
      continue
    }

    const normalizedLabel = normalizeLabel(item)
    const mapped = LABEL_TO_NAF_CODES.get(normalizedLabel)
    if (mapped === undefined) {
      unknownLabels.push(item)
      continue
    }
    if (mapped.length === 0) {
      unmappedLabels.push(item)
      continue
    }
    for (const nafCode of mapped) {
      pushCode(nafCode)
    }
  }

  return { codes, unknownLabels, unmappedLabels }
}

// ------------------------------------------------------------
// MATCHING POST-FETCH — tolérance point/sans point
// ------------------------------------------------------------

/**
 * Indique si un code NAF d'un établissement correspond à l'un des codes
 * NAF demandés. Tolérant aux variations de format (avec/sans point, casse) :
 * les deux côtés sont normalisés via `normalizeNafCode` avant comparaison.
 *
 * Si `allowedNafs` est vide, retourne `true` (pas de filtre côté NAF — défaut
 * legacy à conserver pour ne pas casser le comportement quand l'utilisateur
 * n'a pas configuré de secteur).
 */
export function matchesAnyNaf(
  naf: string | null | undefined,
  allowedNafs: readonly string[],
): boolean {
  if (allowedNafs.length === 0) return true
  const normalizedNaf = normalizeNafCode(naf ?? null)
  if (!normalizedNaf) return false
  for (const allowed of allowedNafs) {
    const normalizedAllowed = normalizeNafCode(allowed)
    if (normalizedAllowed && normalizedAllowed === normalizedNaf) return true
  }
  return false
}

// ------------------------------------------------------------
// EXPORTS UTILITAIRES
// ------------------------------------------------------------

/**
 * Liste les libellés UI supportés par le mapping (utile pour les tests
 * et les éventuelles validations côté UI).
 */
export function getSupportedLabels(): string[] {
  return Array.from(LABEL_TO_NAF_CODES.keys())
}
