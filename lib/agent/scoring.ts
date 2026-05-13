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

/**
 * Points accordés si AUCUN BEGES n'a jamais été publié sur ADEME.
 * Prospect "vierge" : potentiel mais cycle plus long (pas de budget historique alloué).
 * Tuning 2026-05-13 : abaissé de 20 → 15 — voir `memory/hindsight.md`.
 */
const POINTS_BEGES_NON_PUBLIE = 15

/**
 * Points accordés si un BEGES a été publié mais est expiré (> 4 ans).
 * Cible LA PLUS CHAUDE commercialement : budget historiquement alloué,
 * projet récurrent, échéance légale de renouvellement quadriennal dépassée.
 * Tuning 2026-05-13 : relevé de 15 → 25 — voir `memory/hindsight.md`.
 */
const POINTS_BEGES_EXPIRE = 25

/** Points accordés si des signaux d'intention RSE ont été détectés (plafond cumulé) */
const POINTS_SIGNAUX_INTENTION = 15

/**
 * Points "sweet spot" effectif 250-800 salariés.
 * Décideur unique accessible (DAF / DG), cycle de vente court vs grands groupes
 * où le Big4 (Deloitte, EY, KPMG, PwC) est incumbent.
 */
const POINTS_TAILLE_SWEET_SPOT = 15
const POINTS_TAILLE_GRAND_MID = 10  // 800-1999 sal.
const POINTS_TAILLE_ETI = 5         // 2000-4999 sal.
const POINTS_TAILLE_CAC = 2         // ≥ 5000 sal. — cycle long, incumbents

/**
 * Points si un téléphone direct est trouvé (multiplie le taux de contact ×3
 * selon le feedback terrain). Augmenté de 5 → 10 le 2026-05-13.
 */
const POINTS_CONTACT_TELEPHONE = 10

/** Bonus pour les secteurs déjà acculturés au BEGES (cycle de vente plus court). */
const POINTS_SECTEUR_BEGES_MATURE = 5

/**
 * Bonus combinatoire (+20) si l'entreprise est OBLIGÉE au BEGES MAIS n'a rien publié.
 *
 * Logique business (feedback expert prospection 2026-05-13) :
 *  - `obligation_beges = true` (≥ 500 sal. ou Région ≥ 250) + `beges_publie = false`
 *  = situation d'INFRACTION à l'Article L. 229-25 du Code de l'environnement
 *  = amende jusqu'à 10 000 € par BEGES manquant (DREAL contrôles)
 *  = argument commercial massif, lead le PLUS CHAUD du marché.
 *
 * Cumul max profil "infraction" minimaliste : 30 (obligation) + 15 (non publié) + 20 (bonus)
 * = 65 points garantis avant tout autre critère → priorité haute systématique
 * (seuil `SEUIL_PRIORITE_HAUTE = 60`).
 *
 * Choix d'implémentation (Option A vs alternatives) :
 *  - Option A (retenue) : bonus additif +20 → préserve la nuance entre 2 leads "infraction"
 *    (avec contact / sweet spot taille / secteur mature) tout en garantissant le top.
 *  - Option B (rejetée) : `Math.max(score, 80)` plancher dur → perd la granularité,
 *    deux profils "infraction" avec et sans téléphone obtiennent le même score.
 *  - Option C (rejetée) : nouvelle macro-priorité `'infraction'` dans `Priority` →
 *    breaking change downstream (UI / filtres / migrations Supabase) pour un effet
 *    déjà atteint par +20 + clamp 100.
 *
 * NB : un BEGES expiré (publié mais beges_valide=false) N'EST PAS une infraction
 * (le bilan existe, l'obligation initiale est remplie — seul le renouvellement
 * quadriennal est dépassé). Couvert par `POINTS_BEGES_EXPIRE = 25`, pas par ce bonus.
 */
const POINTS_BONUS_INFRACTION_LEGALE = 20

/** Pénalité si le prospect a déjà été contacté (statut != sourced/qualified) */
const PENALITE_DEJA_CONTACTE = -20

/** Pénalité si le prospect a été rejeté */
const PENALITE_REJETE = -50

/** Score maximal théorique (clamp final) */
const SCORE_MAX = 100

/** Seuils pour les tranches de priorité */
const SEUIL_PRIORITE_HAUTE = 60
const SEUIL_PRIORITE_NORMALE = 30

// Bornes sweet spot effectif (lower inclusive, upper exclusive)
const EFFECTIF_SWEET_SPOT_MIN = 250
const EFFECTIF_SWEET_SPOT_MAX = 800
const EFFECTIF_GRAND_MID_MAX = 2_000
const EFFECTIF_ETI_MAX = 5_000

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

/**
 * Secteurs déjà acculturés au BEGES : cycle de vente plus court, vocabulaire connu,
 * direction RSE souvent en place. Bonus +5 (cf. POINTS_SECTEUR_BEGES_MATURE).
 *
 * Sources : retours expert prospection (santé hospitalière déjà obligée publique,
 * transport routier sous radar ADEME depuis 2010, agro-alimentaire sous pression
 * grande distribution / scope 3 amont).
 */
export const NAF_BEGES_MATURE = new Set<string>([
  // Santé
  '86.10Z', '86.21Z',
  // Transport routier / logistique
  '49.41A', '49.41B', '52.10B',
])

/** Préfixes NAF traités comme matures (agro-alimentaire 10.xx complet). */
const NAF_BEGES_MATURE_PREFIXES = ['10.']

// ------------------------------------------------------------
// FONCTIONS EXPORTÉES
// ------------------------------------------------------------

function _normaliseNaf(nafCode: string): string {
  if (!nafCode) return ''
  const cleaned = nafCode.toUpperCase().replace(/\s/g, '')
  return cleaned.length === 5 && !cleaned.includes('.')
    ? `${cleaned.slice(0, 2)}.${cleaned.slice(2)}`
    : cleaned
}

/**
 * Détermine si un code NAF fait partie des secteurs prioritaires.
 */
export function estSecteurPrioritaire(nafCode: string): boolean {
  if (!nafCode) return false
  return NAF_PRIORITAIRES.has(_normaliseNaf(nafCode))
}

/**
 * Détermine si un code NAF appartient à un secteur "déjà acculturé BEGES".
 * Bonus +5 (POINTS_SECTEUR_BEGES_MATURE) — cycle de vente plus court.
 */
export function estSecteurBegesMature(nafCode: string): boolean {
  if (!nafCode) return false
  const normalised = _normaliseNaf(nafCode)
  if (NAF_BEGES_MATURE.has(normalised)) return true
  return NAF_BEGES_MATURE_PREFIXES.some((prefix) => normalised.startsWith(prefix))
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
    details.beges_expire +
    details.signaux_intention +
    details.taille_entreprise +
    details.contact_trouve +
    details.secteur_beges_mature +
    details.bonus_infraction_legale +
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
 *
 * Barème (tuning 2026-05-13, feedback expert prospection) :
 *  - < 250 salariés        :  0 pt (pas d'obligation BEGES nationale)
 *  - 250-799 salariés      : 15 pts (sweet spot : décideur unique, cycle court)
 *  - 800-1999 salariés     : 10 pts
 *  - 2000-4999 salariés    :  5 pts
 *  - ≥ 5000 salariés       :  2 pts (CAC40, Big4 incumbent, cycle long)
 */
function _pointsTaille(prospect: Partial<Prospect>): number {
  const max = prospect.effectif_max ?? 0
  if (max >= EFFECTIF_ETI_MAX)          return POINTS_TAILLE_CAC
  if (max >= EFFECTIF_GRAND_MID_MAX)    return POINTS_TAILLE_ETI
  if (max >= EFFECTIF_SWEET_SPOT_MAX)   return POINTS_TAILLE_GRAND_MID
  if (max >= EFFECTIF_SWEET_SPOT_MIN)   return POINTS_TAILLE_SWEET_SPOT
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
 * Détermine les deux composantes BEGES (non publié vs expiré) — mutuellement exclusives.
 *
 * Logique 2026-05-13 :
 *  - !beges_publie                                  → +15 (vierge, potentiel mais froid)
 *  - beges_publie && beges_valide === false         → +25 (EXPIRÉ : budget historique
 *                                                     alloué, projet récurrent, le plus chaud)
 *  - beges_publie && beges_valide !== false         → +0  (à jour, moins urgent)
 */
function _pointsBeges(prospect: Partial<Prospect>): { nonPublie: number; expire: number } {
  if (!prospect.beges_publie) {
    return { nonPublie: POINTS_BEGES_NON_PUBLIE, expire: 0 }
  }
  if (prospect.beges_valide === false) {
    return { nonPublie: 0, expire: POINTS_BEGES_EXPIRE }
  }
  return { nonPublie: 0, expire: 0 }
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

  const beges = _pointsBeges(prospect)
  const signauxIntention = _pointsSignaux(prospect)
  const tailleEntreprise = _pointsTaille(prospect)
  const contactTrouve = prospect.contact_telephone ? POINTS_CONTACT_TELEPHONE : 0
  const secteurBegesMature = estSecteurBegesMature(prospect.secteur_naf ?? '')
    ? POINTS_SECTEUR_BEGES_MATURE
    : 0

  // Profil "infraction Article L. 229-25" : obligé + BEGES totalement absent.
  // Le BEGES expiré (publié mais obsolète) N'EST PAS une infraction — un bilan existe.
  const bonusInfractionLegale =
    prospect.obligation_beges === true && prospect.beges_publie === false
      ? POINTS_BONUS_INFRACTION_LEGALE
      : 0

  const penaliteDejaContacte = dejaContacte ? PENALITE_DEJA_CONTACTE : 0
  const penaliteRejete = estRejete ? PENALITE_REJETE : 0

  return {
    obligation_beges: obligationBeges,
    secteur_prioritaire: secteurPrioritaire,
    beges_non_publie: beges.nonPublie,
    beges_expire: beges.expire,
    signaux_intention: signauxIntention,
    taille_entreprise: tailleEntreprise,
    contact_trouve: contactTrouve,
    secteur_beges_mature: secteurBegesMature,
    bonus_infraction_legale: bonusInfractionLegale,
    penalite_deja_contacte: penaliteDejaContacte,
    penalite_rejete: penaliteRejete,
  }
}
