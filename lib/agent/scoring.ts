// ============================================================
// SCORING — Agent IA Prospection Bilan Carbone
//
// 2026-05-14 — Refonte complète vers 3 piliers configurables.
//
// L'ancien barème additif (obligation BEGES +30, secteur prio +20, sweet spot,
// signaux, bonus infraction, etc.) a été abandonné suite au feedback utilisateur :
// trop opaque pour le consultant, et impossible à reconfigurer sans toucher au
// code. Le nouveau modèle :
//   - 3 sous-scores 0-100 (Taille / BEGES / Contact) calculés indépendamment
//   - une pondération configurable par utilisateur (défauts 30/30/40)
//   - somme pondérée → score 0-100
//   - pénalités déjà-contacté (-20) et rejeté (-50) appliquées hors piliers
//
// Le sweet spot taille est désormais centré sur l'effectif "juste au-dessus de
// 500 salariés" (où la cible est intéressante mais le Big4 pas encore incumbent),
// avec une décroissance progressive jusqu'au plancher CAC40 — voir _scoreTaille.
//
// Les sous-scores sont 0-100 AVANT pondération pour permettre une lecture
// indépendante côté UI (jauge par pilier).
// ============================================================

import type { Priority, Prospect, ScoreDetails, ScoringWeights } from '@/lib/types'

// ------------------------------------------------------------
// CONSTANTES — PONDÉRATION PAR DÉFAUT
// ------------------------------------------------------------

/**
 * Pondération par défaut des 3 piliers (somme = 100).
 * Surchargeable par utilisateur via `profile.settings.scoring_weights`.
 *
 * Choix 2026-05-14 (feedback utilisateur) :
 *   - Contact prime (40 %) : sans canal direct, pas de conversion.
 *   - Taille et BEGES à parité (30 %) : taille = obligation potentielle,
 *     BEGES = obligation effective / urgence renouvellement.
 */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  taille: 30,
  beges: 30,
  contact: 40,
}

// ------------------------------------------------------------
// CONSTANTES — PILIER 1 (TAILLE)
// ------------------------------------------------------------

/** Sous-seuil : aucun point taille en dessous (pas d'obligation BEGES nationale). */
const TAILLE_NO_SCORE_MAX = 250
/** Borne haute du ramp d'entrée : 0 → 100 linéaire entre 250 et 450. */
const TAILLE_RAMP_END = 450
/** Borne haute du plateau optimal (sweet spot "juste au-dessus de 500"). */
const TAILLE_PLATEAU_END = 600
/** Borne haute de la décroissance : 100 → 20 linéaire entre 600 et 5000. */
const TAILLE_DECAY_END = 5_000
/** Plancher CAC40+ : encore intéressant mais marché saturé Big4. */
const TAILLE_FLOOR_SCORE = 20

// ------------------------------------------------------------
// CONSTANTES — PILIER 2 (BEGES)
// ------------------------------------------------------------

/** Sous-score max BEGES (infraction L. 229-25 ou renouvellement quadriennal dépassé). */
const BEGES_HOT_SCORE = 100
/** Anticipation commerciale : effectif proche du seuil règlementaire (400-499). */
const BEGES_ANTICIPATION_SCORE = 50
/** Borne basse de la zone d'anticipation (effectif). */
const BEGES_ANTICIPATION_MIN = 400
/** Borne haute exclusive de la zone d'anticipation (effectif). */
const BEGES_ANTICIPATION_MAX = 500
/**
 * Boost Décret 2022-982 (GLN-006) : un BEGES publié post-2023 mais non conforme
 * (scope 3 absent ou plan d'action absent) = signal commercial fort
 * (renouvellement quasi-obligatoire). Ajouté au sous-score BEGES quand
 * l'obligation est levée et qu'un bilan est publié mais non conforme. Plafonné
 * via `clampSubscore` pour rester dans [0, 100].
 */
const BEGES_DECRET_2022_BOOST = 30

// ------------------------------------------------------------
// CONSTANTES — PILIER 3 (CONTACT)
// ------------------------------------------------------------

/** Téléphone direct (conversion ×3 selon feedback terrain). */
const CONTACT_PHONE_SCORE = 100
/** Email seul (canal asynchrone, taux de réponse moyen). */
const CONTACT_EMAIL_SCORE = 50
/** LinkedIn seul (canal social, fallback). */
const CONTACT_LINKEDIN_SCORE = 25

// ------------------------------------------------------------
// CONSTANTES — PÉNALITÉS (hors piliers)
// ------------------------------------------------------------

const PENALITE_DEJA_CONTACTE = -20
const PENALITE_REJETE = -50

// ------------------------------------------------------------
// CONSTANTES — CLAMP & PRIORITÉ
// ------------------------------------------------------------

const SCORE_MAX = 100
const SCORE_MIN = 0
const SUBSCORE_MAX = 100

const SEUIL_PRIORITE_HAUTE = 60
const SEUIL_PRIORITE_MOYENNE = 30

// ------------------------------------------------------------
// PONDÉRATION — normalisation
// ------------------------------------------------------------

/**
 * Normalise une pondération arbitraire vers somme = 100.
 *
 * - `undefined` → DEFAULT_SCORING_WEIGHTS (30/30/40).
 * - Tout poids négatif ou non-fini est remplacé par 0.
 * - Si la somme est nulle après nettoyage, on retombe sur les défauts.
 * - Sinon, re-projection proportionnelle vers 100 (ex. 1/1/2 → 25/25/50,
 *   25/25/25 → 33/33/34 — l'arrondi va au pilier `contact` pour préserver
 *   l'invariant somme = 100 sans casser le poids dominant).
 *
 * On retourne des entiers pour éviter les dérives float côté score final
 * (division par 100 propre, pas de 99.99999).
 */
export function normalizeScoringWeights(
  w?: Partial<ScoringWeights>,
): ScoringWeights {
  if (!w) return { ...DEFAULT_SCORING_WEIGHTS }

  const sanitize = (n: unknown): number => {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 0
    return n
  }

  const taille = sanitize(w.taille)
  const beges = sanitize(w.beges)
  const contact = sanitize(w.contact)
  const sum = taille + beges + contact

  if (sum <= 0) return { ...DEFAULT_SCORING_WEIGHTS }

  // Projection proportionnelle vers 100 puis arrondi avec correction sur `contact`.
  const tailleN = Math.round((taille * 100) / sum)
  const begesN = Math.round((beges * 100) / sum)
  const contactN = SCORE_MAX - tailleN - begesN

  return { taille: tailleN, beges: begesN, contact: contactN }
}

// ------------------------------------------------------------
// PILIERS — fonctions pures, 0-100 chacun
// ------------------------------------------------------------

/**
 * Pilier 1 — Taille (0-100).
 *
 * On note un effectif "juste au-dessus de 500" comme l'optimum commercial :
 *  - < 250        → 0   (pas d'obligation BEGES nationale, hors cible)
 *  - 250 → 450    → ramp linéaire 0 → 100
 *  - 450 → 600    → plateau 100 (sweet spot "juste au-dessus de 500")
 *  - 600 → 5000   → décroissance 100 → 20 (plus c'est gros, plus Big4 est en place)
 *  - ≥ 5000       → 20 (plancher CAC40, marché saturé mais pas nul)
 *
 * On utilise `effectif_max` en priorité (borne haute Sirene déjà côté
 * pessimiste pour le scoring). Fallback `effectif_min` si max absent.
 */
function _scoreTaille(prospect: Partial<Prospect>): number {
  const effectif = prospect.effectif_max ?? prospect.effectif_min ?? 0

  if (effectif < TAILLE_NO_SCORE_MAX) return 0

  if (effectif < TAILLE_RAMP_END) {
    // Ramp linéaire 0 → 100 sur [250, 450[.
    const range = TAILLE_RAMP_END - TAILLE_NO_SCORE_MAX
    return Math.round(((effectif - TAILLE_NO_SCORE_MAX) / range) * SUBSCORE_MAX)
  }

  if (effectif <= TAILLE_PLATEAU_END) return SUBSCORE_MAX

  if (effectif < TAILLE_DECAY_END) {
    // Décroissance linéaire 100 → 20 sur ]600, 5000[.
    const range = TAILLE_DECAY_END - TAILLE_PLATEAU_END
    const drop = SUBSCORE_MAX - TAILLE_FLOOR_SCORE
    const ratio = (effectif - TAILLE_PLATEAU_END) / range
    return Math.round(SUBSCORE_MAX - drop * ratio)
  }

  return TAILLE_FLOOR_SCORE
}

/**
 * Pilier 2 — BEGES (0-100).
 *
 *  - obligation_beges = true && beges_publie = false → 100 (infraction L. 229-25)
 *  - beges_publie = true && beges_valide = false      → 100 (expiré >4 ans)
 *  - effectif ∈ [400, 499] sans obligation déclenchée → 50 (anticipation commerciale)
 *  - sinon                                            → 0
 *
 * Boost Décret 2022-982 (GLN-006) :
 *   obligation_beges = true && beges_publie = true && beges_decret_2022_compliant = false
 *   → +30 (signal "hot lead — bilan obsolète post-Décret 2022"). Clampé [0, 100].
 *
 * Note : on s'appuie sur `obligation_beges` et `beges_valide` calculés en
 * amont (cf. lib/agent/sourcing.ts). Le scoring ne ré-évalue pas les seuils
 * réglementaires (≥500 sal., Région ≥250) lui-même — il consomme.
 */
function _scoreBeges(prospect: Partial<Prospect>): number {
  const obligationBeges = prospect.obligation_beges === true
  const begesPublie = prospect.beges_publie === true
  const begesValide = prospect.beges_valide
  const decret2022NonCompliant =
    prospect.beges_decret_2022_compliant === false

  // Cas 1 : obligé mais aucun bilan publié → infraction.
  if (obligationBeges && !begesPublie) return BEGES_HOT_SCORE

  // Cas 2 : bilan publié mais expiré (renouvellement quadriennal dépassé).
  if (begesPublie && begesValide === false) return BEGES_HOT_SCORE

  // Cas 3 — GLN-006 : bilan publié, valide, MAIS non conforme Décret 2022-982.
  // Score de base 70 (signal moins urgent qu'une infraction L229-25 pure ou
  // qu'un bilan expiré, mais commercialement très exploitable car le décret
  // impose le renouvellement avec scope 3 + plan d'action). +30 via boost.
  if (obligationBeges && begesPublie && decret2022NonCompliant) {
    return Math.min(SUBSCORE_MAX, BEGES_ANTICIPATION_SCORE + BEGES_DECRET_2022_BOOST + 20)
  }

  // Cas 4 : anticipation commerciale — entreprise proche du seuil sans
  // obligation déclenchée. On regarde effectif_max (borne haute) car le
  // déclenchement légal arrive en franchissant le seuil sur 12 mois consécutifs.
  if (!obligationBeges) {
    const effectif = prospect.effectif_max ?? prospect.effectif_min ?? 0
    if (effectif >= BEGES_ANTICIPATION_MIN && effectif < BEGES_ANTICIPATION_MAX) {
      return BEGES_ANTICIPATION_SCORE
    }
  }

  return 0
}

/**
 * Pilier 3 — Contact (0-100).
 *
 * Hiérarchie stricte (le canal le plus chaud l'emporte, pas de cumul) :
 *   téléphone (100) > email (50) > LinkedIn (25) > rien (0)
 *
 * Pourquoi pas un score additif ? Parce que c'est la QUALITÉ du point d'entrée
 * qui pilote la conversion, pas le NOMBRE de canaux disponibles. Un prospect
 * avec téléphone + LinkedIn vaut autant qu'un prospect avec téléphone seul
 * pour l'appel à froid.
 */
function _scoreContact(prospect: Partial<Prospect>): number {
  if (prospect.contact_telephone) return CONTACT_PHONE_SCORE
  if (prospect.contact_email) return CONTACT_EMAIL_SCORE
  if (prospect.contact_linkedin) return CONTACT_LINKEDIN_SCORE
  return 0
}

// ------------------------------------------------------------
// FONCTIONS EXPORTÉES
// ------------------------------------------------------------

/**
 * Calcule le score composite (0-100) d'un prospect.
 *
 * @param prospect - Données partielles du prospect
 * @param dejaContacte - TRUE si le prospect a déjà été contacté (statut != sourced/qualified)
 * @param weights - Pondération optionnelle (défauts 30/30/40)
 */
export function calculerScore(
  prospect: Partial<Prospect>,
  dejaContacte: boolean,
  weights?: Partial<ScoringWeights>,
): number {
  const details = getScoreDetails(prospect, dejaContacte, weights)
  return _composeFinalScore(details)
}

/**
 * Retourne la décomposition détaillée du score.
 * Utilisé par le dashboard pour expliquer la priorisation et alimenter
 * l'UI par-pilier (jauge / barre par sous-score).
 */
export function getScoreDetails(
  prospect: Partial<Prospect>,
  dejaContacte: boolean,
  weights?: Partial<ScoringWeights>,
): ScoreDetails {
  const taille = _scoreTaille(prospect)
  const beges = _scoreBeges(prospect)
  const contact = _scoreContact(prospect)
  const normalizedWeights = normalizeScoringWeights(weights)

  const dejaContactePenalty = dejaContacte ? PENALITE_DEJA_CONTACTE : 0
  const rejetePenalty = prospect.statut === 'rejected' ? PENALITE_REJETE : 0

  return {
    taille,
    beges,
    contact,
    weights: normalizedWeights,
    deja_contacte_penalty: dejaContactePenalty,
    rejete_penalty: rejetePenalty,
  }
}

/**
 * Détermine la priorité qualitative à partir du score numérique.
 *
 * Seuils inchangés vs ancien barème pour préserver l'UI :
 *   ≥ 60 → haute, ≥ 30 → moyenne, sinon basse.
 */
export function determinerPriorite(score: number): Priority {
  if (score >= SEUIL_PRIORITE_HAUTE) return 'haute'
  if (score >= SEUIL_PRIORITE_MOYENNE) return 'moyenne'
  return 'basse'
}

// ------------------------------------------------------------
// LOGIQUE INTERNE — composition du score final
// ------------------------------------------------------------

/**
 * Compose le score final à partir d'un ScoreDetails :
 *   raw = (taille × wTaille + beges × wBeges + contact × wContact) / 100
 *   raw += pénalités (déjà contacté, rejeté)
 *   clamp [0, 100]
 *
 * Diviseur 100 et non somme(weights) : normalizeScoringWeights garantit déjà
 * la somme = 100. On évite ainsi une seconde normalisation.
 */
function _composeFinalScore(details: ScoreDetails): number {
  const { taille, beges, contact, weights, deja_contacte_penalty, rejete_penalty } = details

  const weighted =
    (taille * weights.taille + beges * weights.beges + contact * weights.contact) / SCORE_MAX

  const raw = Math.round(weighted) + deja_contacte_penalty + rejete_penalty

  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, raw))
}
