// ============================================================
// SCORING — Agent IA Prospection Bilan Carbone
// Algorithme de priorisation des prospects (score 0-100)
// ============================================================

import type { Priority, Prospect, ScoreDetails } from '@/lib/types'

// ------------------------------------------------------------
// CONSTANTES — Barème de scoring
// ------------------------------------------------------------

/** Points accordés si l'entreprise est soumise à l'obligation BEGES (≥ 500 sal.) */
const POINTS_OBLIGATION_BEGES = 30

/** Points accordés si le secteur d'activité est prioritaire */
const POINTS_SECTEUR_PRIORITAIRE = 20

/** Points accordés si aucun BEGES n'a jamais été publié sur ADEME */
const POINTS_BEGES_NON_PUBLIE = 20

/**
 * Points accordés si un BEGES a été publié mais est expiré (> 4 ans).
 * Ces entreprises ont l'obligation de renouvellement — cible prioritaire.
 */
const POINTS_BEGES_EXPIRE = 15

/** Points accordés si des signaux d'intention RSE ont été détectés */
const POINTS_SIGNAUX_INTENTION = 15

/** Points maximaux accordés pour la taille de l'entreprise */
const POINTS_TAILLE_MAX = 10

/** Points accordés si un contact téléphonique a été trouvé */
const POINTS_CONTACT_TELEPHONE = 5

/** Pénalité si le prospect a déjà été contacté (statut != sourced/qualified) */
const PENALITE_DEJA_CONTACTE = -20

/** Pénalité si le prospect a été rejeté */
const PENALITE_REJETE = -50

/** Score maximal théorique (sans pénalité) */
const SCORE_MAX = 100

/** Seuils pour les tranches de priorité */
const SEUIL_PRIORITE_HAUTE = 60
const SEUIL_PRIORITE_NORMALE = 30

// ------------------------------------------------------------
// CODES NAF PRIORITAIRES
// ------------------------------------------------------------

// Indexé pour une lookup O(1)
const NAF_PRIORITAIRES = new Set([
  '01.21Z', '01.22Z',         // Viticulture
  '30.30Z',                   // Construction aéronautique
  '52.10B', '52.29A',         // Logistique / entreposage
  '10.11Z', '10.13A', '10.32Z', '10.51A', '10.71A', // Agro-alimentaire
  '46.17B',                   // Commerce intermédiaire agro
  '49.41A', '49.41B', '52.21Z', // Transport routier / services annexes
])

// ------------------------------------------------------------
// FONCTIONS EXPORTÉES
// ------------------------------------------------------------

/**
 * Détermine si un code NAF fait partie des secteurs prioritaires.
 */
export function estSecteurPrioritaire(nafCode: string): boolean {
  if (!nafCode) return false
  // Normalisation : accepte "4941A" → "49.41A" et "49.41a" → "49.41A"
  const cleaned = nafCode.toUpperCase().replace(/\s/g, '')
  const normalised = cleaned.length === 5 && !cleaned.includes('.')
    ? `${cleaned.slice(0, 2)}.${cleaned.slice(2)}`
    : cleaned
  return NAF_PRIORITAIRES.has(normalised)
}

/**
 * Calcule le score composite (0-100) d'un prospect.
 *
 * @param prospect - Données partielles du prospect
 * @param dejaContacte - TRUE si le prospect a déjà été contacté (statut != sourced/qualified)
 */
export function calculerScore(
  prospect: Partial<Prospect>,
  dejaContacte: boolean,
): number {
  const details = _computeDetails(prospect, dejaContacte)
  const raw =
    details.obligation_beges +
    details.secteur_prioritaire +
    details.beges_non_publie +
    details.signaux_intention +
    details.taille_entreprise +
    details.contact_trouve +
    details.penalite_deja_contacte +
    details.penalite_rejete

  // Clamper entre 0 et SCORE_MAX
  return Math.max(0, Math.min(SCORE_MAX, raw))
}

/**
 * Retourne la décomposition détaillée du score.
 * Utile pour l'explication de la priorisation dans le dashboard.
 */
export function getScoreDetails(
  prospect: Partial<Prospect>,
  dejaContacte: boolean,
): ScoreDetails {
  return _computeDetails(prospect, dejaContacte)
}

/**
 * Détermine la priorité qualitative à partir du score numérique.
 */
export function determinerPriorite(score: number): Priority {
  if (score >= SEUIL_PRIORITE_HAUTE) return 'haute'
  if (score >= SEUIL_PRIORITE_NORMALE) return 'normale'
  return 'basse'
}

// ------------------------------------------------------------
// LOGIQUE INTERNE
// ------------------------------------------------------------

/**
 * Calcule les points accordés pour la taille de l'entreprise.
 * Proportionnel à l'effectif maximum, plafonné à POINTS_TAILLE_MAX.
 *
 * Barème :
 *  - 200-499 salariés   : 3 pts
 *  - 500-999 salariés   : 6 pts
 *  - 1000-4999 salariés : 8 pts
 *  - 5000+ salariés     : 10 pts
 */
function _pointsTaille(prospect: Partial<Prospect>): number {
  const max = prospect.effectif_max ?? 0
  if (max >= 5_000) return POINTS_TAILLE_MAX
  if (max >= 1_000) return 8
  if (max >= 500)   return 6
  if (max >= 200)   return 3
  return 0
}

/**
 * Calcule les points pour les signaux d'intention.
 * Chaque signal a un poids propre — on somme jusqu'au plafond.
 */
function _pointsSignaux(prospect: Partial<Prospect>): number {
  const signaux = prospect.signaux ?? []
  if (signaux.length === 0) return 0

  const total = signaux.reduce((sum, signal) => sum + (signal.weight ?? 0), 0)
  return Math.min(POINTS_SIGNAUX_INTENTION, total)
}

/**
 * Fonction centrale de calcul — réutilisée par calculerScore et getScoreDetails.
 */
function _computeDetails(
  prospect: Partial<Prospect>,
  dejaContacte: boolean,
): ScoreDetails {
  const estRejete = prospect.statut === 'rejected'

  const obligationBeges = prospect.obligation_beges ? POINTS_OBLIGATION_BEGES : 0
  const secteurPrioritaire = estSecteurPrioritaire(prospect.secteur_naf ?? '')
    ? POINTS_SECTEUR_PRIORITAIRE
    : 0

  // Logique scoring BEGES à 3 niveaux :
  // - Pas de BEGES du tout     → +20 pts (prospect vierge, fort potentiel)
  // - BEGES publié mais expiré → +15 pts (obligation de renouvellement imminente)
  // - BEGES publié et valide   →  +0 pts (à jour, moins urgent)
  let begesNonPublie: number
  if (!prospect.beges_publie) {
    begesNonPublie = POINTS_BEGES_NON_PUBLIE
  } else if (prospect.beges_valide === false) {
    // beges_publie=true mais beges_valide=false → BEGES expiré (> 4 ans)
    begesNonPublie = POINTS_BEGES_EXPIRE
  } else {
    // beges_publie=true et beges_valide=true (ou indéterminé) → BEGES à jour
    begesNonPublie = 0
  }

  const signauxIntention = _pointsSignaux(prospect)
  const tailleEntreprise = _pointsTaille(prospect)
  const contactTrouve = prospect.contact_telephone ? POINTS_CONTACT_TELEPHONE : 0
  const penaliteDejaContacte = dejaContacte ? PENALITE_DEJA_CONTACTE : 0
  const penaliteRejete = estRejete ? PENALITE_REJETE : 0

  return {
    obligation_beges: obligationBeges,
    secteur_prioritaire: secteurPrioritaire,
    beges_non_publie: begesNonPublie,
    signaux_intention: signauxIntention,
    taille_entreprise: tailleEntreprise,
    contact_trouve: contactTrouve,
    penalite_deja_contacte: penaliteDejaContacte,
    penalite_rejete: penaliteRejete,
  }
}
