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
// Champs ADEME Data Fair exploités :
//   La structure du payload `/datasets/bilan-ges/lines` n'est pas
//   formellement documentée et les noms de champs varient légèrement
//   d'un cru à l'autre. On accepte donc plusieurs synonymes (best-effort)
//   pour rester robuste à l'évolution du dataset :
//     - Scope 3 : `emissions_scope_3` (number > 0) OU présence d'un
//       enregistrement scope 3 dans une éventuelle liste de postes
//       (`emissions_par_poste`, `postes_emissions`, ou variantes).
//     - Plan d'action : `plan_action_transition`, `plan_action`,
//       `plan_de_transition`, `plan_transition`, `objectifs_reduction`,
//       `objectifs_de_reduction`. La présence (string non-vide ou objet
//       non-null) suffit — on ne juge pas la qualité, on juge l'existence.
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
 * Liste des clefs candidates pour le scope 3 numérique direct.
 * Une valeur > 0 = scope 3 mesuré explicitement.
 */
const SCOPE_3_NUMERIC_KEYS = [
  'emissions_scope_3',
  'scope_3_emissions',
  'emissions_ges_scope_3',
  'total_emissions_scope_3',
] as const

/**
 * Liste des clefs candidates pour une liste de postes d'émission
 * (le scope 3 peut alors être inféré par la présence d'un poste catégorie 3).
 */
const EMISSIONS_PAR_POSTE_KEYS = [
  'emissions_par_poste',
  'postes_emissions',
  'emissions_postes',
] as const

/**
 * Liste des clefs candidates pour le plan d'action / plan de transition.
 * Présence d'une valeur non-vide = plan d'action détecté.
 */
const PLAN_ACTION_KEYS = [
  'plan_action_transition',
  'plan_action',
  'plan_de_transition',
  'plan_transition',
  'objectifs_reduction',
  'objectifs_de_reduction',
  'mesures_reduction',
  'plan_actions',
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
function hasScope3(data: Record<string, unknown>): boolean {
  // Cas direct : valeur numérique > 0.
  for (const key of SCOPE_3_NUMERIC_KEYS) {
    const v = data[key]
    if (typeof v === 'number' && v > 0) return true
    // Tolérance : valeur string convertible en nombre (l'API renvoie parfois
    // les emissions en string formaté).
    if (typeof v === 'string') {
      const parsed = Number.parseFloat(v.replace(',', '.'))
      if (Number.isFinite(parsed) && parsed > 0) return true
    }
  }

  // Cas indirect : liste de postes d'émissions, on cherche un poste cat. 3.
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
 * Heuristique : présence non-vide d'un des champs candidats (string ou objet).
 */
function hasPlanAction(data: Record<string, unknown>): boolean {
  const v = pickFirstDefined(data, PLAN_ACTION_KEYS)
  return isNonEmptyString(v) || isNonEmptyObject(v) || isNonEmptyArray(v)
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
  const hasAnyScope3Field = hasAnyKey(data, SCOPE_3_NUMERIC_KEYS) || hasAnyKey(data, EMISSIONS_PAR_POSTE_KEYS)
  const hasAnyPlanField = hasAnyKey(data, PLAN_ACTION_KEYS)
  if (!hasAnyScope3Field && !hasAnyPlanField) return null

  // Évaluation finale : les deux exigences du décret doivent être satisfaites.
  const scope3 = hasScope3(data)
  const planAction = hasPlanAction(data)
  return scope3 && planAction
}
