// ============================================================
// DÉCRET 2022-982 — Détection conformité BEGES (GLN-006)
//
// Référentiel :
//   Décret n°2022-982 du 1er juillet 2022, art. 1 modifiant l'art. R229-46
//   du Code de l'environnement. Depuis le 1er janvier 2023, tout BEGES
//   réglementaire (L229-25) publié doit inclure :
//     1. Les émissions de scope 3 SIGNIFICATIVES (catégorisées par poste).
//     2. Un PLAN DE TRANSITION (plan d'action chiffré avec objectifs de
//        réduction et moyens associés).
//
//   Un BEGES publié POST-2023 sans ces deux éléments n'est PAS conforme :
//   c'est un signal commercial fort (renouvellement quasi-obligatoire).
//
// Champs ADEME Data Fair (validés via inspection prod 2026-05-21) :
//   - Scope 3 : ventilé en postes `emissions_publication_p31..p35` (poste 3),
//     `p41..p45` (poste 4), `p51..p54` (poste 5). Un BEGES méthode v5 cat
//     ces postes en scope 3 (cf. ABC Méthode Bilan Carbone v9). On considère
//     "scope 3 présent" si la somme des valeurs numériques de ces postes > 0.
//     Synonymes legacy gardés pour robustesse (`emissions_scope_3`, etc.)
//     au cas où Data Fair évoluerait ou que l'orchestrateur sauvegarde
//     les bilans v4 sous une autre forme.
//   - Plan d'action : `actions_et_moyens` (texte long) OU
//     `reduction_attendue_des_emissions_directes` (NUMERIC > 0) OU
//     `reduction_attendue_des_emissions_indirectes_significatives` (NUMERIC > 0)
//     OU `analyse_des_resultats_obtenus` (texte explicite). Synonymes legacy
//     gardés au cas où.
//
//   Si AUCUN des champs candidats n'est présent dans le payload (cas où
//   l'API ne les expose pas du tout pour ce bilan), on retourne `null`
//   au lieu de `false` : on évite de stigmatiser un prospect par défaut
//   sur une simple lacune de l'API. Le scoring +30 ne se déclenche QUE
//   sur `false` explicite.
// ============================================================

/**
 * Date charnière du Décret 2022-982 art. 1 (entrée en application des
 * nouvelles exigences). Tout BEGES publié AVANT cette date est hors champ
 * (l'ancien régime n'imposait pas scope 3 + plan d'action).
 */
const DECRET_2022_EFFECTIVE_DATE = new Date('2023-01-01T00:00:00Z')

/**
 * Liste des clefs candidates pour le scope 3 numérique direct (legacy / synonymes).
 * Une valeur > 0 = scope 3 mesuré explicitement.
 */
const SCOPE_3_NUMERIC_KEYS = [
  'emissions_scope_3',
  'scope_3_emissions',
  'emissions_ges_scope_3',
  'total_emissions_scope_3',
] as const

/**
 * Postes BEGES v5 catégorisés en scope 3 (cf. ABC Méthode Bilan Carbone v9
 * + Data Fair ADEME). Postes 3 = déplacements, postes 4 = achats / amont,
 * postes 5 = aval (utilisation produits, fin de vie). Une somme > 0 sur
 * un de ces postes = scope 3 effectivement mesuré.
 *
 * Liste validée 2026-05-21 sur échantillon ALSTOM CRESPIN SAS (bilan 2024).
 */
const SCOPE_3_POSTE_KEYS = [
  'emissions_publication_p31',
  'emissions_publication_p32',
  'emissions_publication_p33',
  'emissions_publication_p34',
  'emissions_publication_p35',
  'emissions_publication_p41',
  'emissions_publication_p42',
  'emissions_publication_p43',
  'emissions_publication_p44',
  'emissions_publication_p45',
  'emissions_publication_p51',
  'emissions_publication_p52',
  'emissions_publication_p53',
  'emissions_publication_p54',
] as const

/**
 * Liste des clefs candidates pour une liste de postes d'émission
 * (cas legacy / synonymes pour rester robuste).
 */
const EMISSIONS_PAR_POSTE_KEYS = [
  'emissions_par_poste',
  'postes_emissions',
  'emissions_postes',
] as const

/**
 * Clefs candidates pour le plan d'action / plan de transition.
 * Présence d'une valeur non-vide = plan d'action détecté.
 *
 * `actions_et_moyens` est le champ Data Fair officiel (string descriptive
 * des mesures). Les autres sont des synonymes legacy / variantes.
 */
const PLAN_ACTION_KEYS = [
  'actions_et_moyens',
  'analyse_des_resultats_obtenus',
  'plan_action_transition',
  'plan_action',
  'plan_de_transition',
  'plan_transition',
  'objectifs_reduction',
  'objectifs_de_reduction',
  'mesures_reduction',
  'plan_actions',
] as const

/**
 * Clefs candidates pour les objectifs de réduction quantifiés.
 * Une valeur numérique > 0 = engagement chiffré = plan d'action effectif.
 */
const PLAN_ACTION_NUMERIC_KEYS = [
  'reduction_attendue_des_emissions_directes',
  'reduction_attendue_des_emissions_indirectes_significatives',
] as const

// ------------------------------------------------------------
// HELPERS de lecture tolérante (forme libre JSONB)
// ------------------------------------------------------------

function pickFirstDefined(
  data: Record<string, unknown>,
  keys: ReadonlyArray<string>,
): unknown {
  for (const k of keys) {
    if (k in data && data[k] !== null && data[k] !== undefined) {
      return data[k]
    }
  }
  return undefined
}

function hasAnyKey(
  data: Record<string, unknown>,
  keys: ReadonlyArray<string>,
): boolean {
  return keys.some((k) => k in data)
}

function isNonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

function isNonEmptyObject(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.keys(v as Record<string, unknown>).length > 0
  )
}

function isNonEmptyArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0
}

/**
 * Parse la date de publication ADEME en Date locale.
 * Accepte format ISO (`YYYY-MM-DD` ou complet) et tronque sur les 10 premiers
 * caractères pour rester robuste à un timestamp complet.
 */
function parseAdemeDate(raw: unknown): Date | null {
  if (typeof raw !== 'string' || raw.length < 10) return null
  const iso = raw.substring(0, 10)
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d
}

// ------------------------------------------------------------
// Détection scope 3 / plan d'action
// ------------------------------------------------------------

/**
 * `true` si le bilan contient des émissions scope 3 mesurées.
 * Heuristique :
 *   - Un des champs `emissions_scope_3` (et synonymes) > 0.
 *   - OU une liste de postes contient au moins un poste catégorie 3
 *     (champ `categorie` / `scope` / `niveau` = 3, ou nom contenant "scope 3").
 */
function readPositiveNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  if (typeof v === 'string') {
    const parsed = Number.parseFloat(v.replace(',', '.'))
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

function hasScope3(data: Record<string, unknown>): boolean {
  // Cas Data Fair officiel : postes BEGES v5 ventilés en p3x/p4x/p5x.
  // Suffit qu'un poste soit > 0 pour considérer scope 3 présent.
  for (const key of SCOPE_3_POSTE_KEYS) {
    if (readPositiveNumber(data[key]) !== null) return true
  }

  // Cas legacy direct : valeur scope_3 agrégée > 0.
  for (const key of SCOPE_3_NUMERIC_KEYS) {
    if (readPositiveNumber(data[key]) !== null) return true
  }

  // Cas indirect legacy : liste de postes d'émissions, on cherche un poste cat. 3.
  for (const key of EMISSIONS_PAR_POSTE_KEYS) {
    const list = data[key]
    if (!Array.isArray(list)) continue
    for (const poste of list) {
      if (typeof poste !== 'object' || poste === null) continue
      const p = poste as Record<string, unknown>
      const categorie = p.categorie ?? p.scope ?? p.niveau ?? p.type
      if (categorie === 3 || categorie === '3' || categorie === 'scope_3') return true
      // Heuristique nom : "scope 3" présent dans un libellé.
      const libelle = p.libelle ?? p.nom ?? p.name
      if (typeof libelle === 'string' && /scope\s*3/i.test(libelle)) return true
    }
  }

  return false
}

/**
 * `true` si le bilan contient un plan d'action / plan de transition.
 * Critères (un seul suffit) :
 *   - Champ texte `actions_et_moyens` non vide (Data Fair officiel).
 *   - Champ texte `analyse_des_resultats_obtenus` non vide.
 *   - Champ numérique `reduction_attendue_des_emissions_directes` > 0.
 *   - Champ numérique `reduction_attendue_des_emissions_indirectes_significatives` > 0.
 *   - Champ legacy synonyme présent et non vide.
 */
function hasPlanAction(data: Record<string, unknown>): boolean {
  // Cas texte : champ rempli côté Data Fair officiel ou legacy.
  const textValue = pickFirstDefined(data, PLAN_ACTION_KEYS)
  if (isNonEmptyString(textValue) || isNonEmptyObject(textValue) || isNonEmptyArray(textValue)) {
    return true
  }

  // Cas numérique : engagement chiffré de réduction.
  for (const key of PLAN_ACTION_NUMERIC_KEYS) {
    if (readPositiveNumber(data[key]) !== null) return true
  }

  return false
}

// ------------------------------------------------------------
// API PUBLIQUE
// ------------------------------------------------------------

/**
 * Détermine si un BEGES est conforme au Décret 2022-982.
 *
 * Retourne :
 *   - `null` si non applicable :
 *       - Pas de `bilan_ges_data` (aucun BEGES publié).
 *       - BEGES publié avant le 1er janvier 2023 (régime antérieur).
 *       - Champs ADEME ne contenant AUCUNE clef candidate exploitable
 *         (l'API ne renvoie pas les infos — on ne peut pas juger).
 *   - `true` si scope 3 ET plan d'action sont présents.
 *   - `false` si BEGES publié post-2023 mais l'un des deux manque.
 *
 * Le retour `false` est exploité par le scoring (`lib/agent/scoring.ts`)
 * pour booster les prospects "hot lead — bilan obsolète post-Décret 2022".
 */
export function isDecret2022Compliant(
  bilanGesData: Record<string, unknown> | null | undefined,
): boolean | null {
  // Pas de bilan publié → non applicable.
  if (bilanGesData == null) return null
  if (typeof bilanGesData !== 'object' || Array.isArray(bilanGesData)) return null

  const data = bilanGesData as Record<string, unknown>

  // Date publication ADEME. Si on ne peut pas la parser, on est prudent
  // et on considère le bilan hors champ (null) plutôt que de mal qualifier.
  const datePublication =
    parseAdemeDate(data.date_de_publication) ??
    parseAdemeDate(data.date_publication)

  if (datePublication === null) return null
  if (datePublication < DECRET_2022_EFFECTIVE_DATE) return null

  // Vérifier qu'on a AU MOINS un signal exploitable. Si l'API ne renvoie
  // ni scope 3 ni plan d'action ni postes émissions, on n'a pas l'info
  // → null (best-effort, on ne stigmatise pas).
  const hasAnyScope3Field =
    hasAnyKey(data, SCOPE_3_POSTE_KEYS) ||
    hasAnyKey(data, SCOPE_3_NUMERIC_KEYS) ||
    hasAnyKey(data, EMISSIONS_PAR_POSTE_KEYS)
  const hasAnyPlanField =
    hasAnyKey(data, PLAN_ACTION_KEYS) || hasAnyKey(data, PLAN_ACTION_NUMERIC_KEYS)
  if (!hasAnyScope3Field && !hasAnyPlanField) return null

  // Évaluation finale : les deux exigences du décret doivent être satisfaites.
  const scope3 = hasScope3(data)
  const planAction = hasPlanAction(data)
  return scope3 && planAction
}
