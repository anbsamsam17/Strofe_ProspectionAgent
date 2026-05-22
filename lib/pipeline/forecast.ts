// ============================================================
// FORECAST PIPELINE — calcul de la valeur pondérée
// ------------------------------------------------------------
// Ticket : GLN-041 (valeur deal EUR + forecast pipeline pondéré)
//
// Pure functions, sans I/O. Utilisé côté UI (Kanban headers, KPI Pipeline
// value) ET côté formulaire (pré-remplissage probabilité selon statut).
//
// Forecast pondéré standard CRM :
//   forecast(prospect) = deal_value * deal_probability / 100
//
// Mapping statut → probabilité par défaut :
//   sourced       → 10  (lead brut, simple soupçon)
//   qualified     → 25  (BEGES OK + obligation OK)
//   contacted     → 25  (contact pris, pas encore d'engagement)
//   interested    → 50  (intérêt exprimé)
//   rdv           → 75  (rdv pris ou tenu)
//   offer_sent    → 60  (offre envoyée, en attente de signature)
//   converted     → 100 (signé)
//   rejected      → 0
//   do_not_contact → 0
//   on_hold       → 0   (pause — pas de forecast utile)
//
// `offer_sent` est positionné à 60 (et non 75) car l'envoi de proposition
// ne garantit pas la signature — on garde 75 pour le RDV qui est un
// engagement actif du prospect.
// ============================================================

import type { ProspectStatus } from '@/lib/types'

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

/**
 * Probabilité par défaut associée à chaque statut. Source unique de vérité —
 * utilisée à la fois côté UI (pré-remplissage formulaire) et côté backend
 * éventuel (orchestrator pourrait pré-remplir à la création d'un prospect).
 */
export const DEFAULT_PROBABILITY_BY_STATUS: Record<ProspectStatus, number> = {
  sourced: 10,
  qualified: 25,
  // Migration 028 — "À contacter" : décision humaine d'amorce, légèrement
  // au-dessus de 'qualified' (engagement explicite de l'utilisateur) mais
  // sans contact passé, donc en-dessous de 'contacted'.
  to_contact: 30,
  contacted: 25,
  interested: 50,
  rdv: 75,
  offer_sent: 60,
  converted: 100,
  rejected: 0,
  on_hold: 0,
  do_not_contact: 0,
}

/**
 * Paliers de probabilité proposés dans le select UI (en %). Définis comme
 * constantes pour éviter les magic numbers dans le composant.
 */
export const PROBABILITY_STEPS = [0, 10, 25, 50, 60, 75, 100] as const

/** Plafond UI saisie (99 M€) — au-delà, c'est probablement une faute de frappe. */
export const DEAL_VALUE_MAX = 99_999_999.99

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

/**
 * Retourne la probabilité par défaut associée à un statut prospect.
 * Fallback : 0 si le statut n'est pas reconnu (defensive — utile si l'enum
 * DB diverge temporairement de l'enum TS).
 */
export function defaultProbabilityForStatus(statut: string): number {
  if (statut in DEFAULT_PROBABILITY_BY_STATUS) {
    return DEFAULT_PROBABILITY_BY_STATUS[statut as ProspectStatus]
  }
  return 0
}

/**
 * Calcule le forecast pondéré d'un prospect :
 *   forecast = deal_value × deal_probability / 100
 *
 * Retourne `0` si l'une des deux valeurs est manquante / négative.
 * Retourne un nombre arrondi à l'entier (€ — pas de centimes en forecast).
 */
export function computeForecast(
  dealValue: number | null | undefined,
  dealProbability: number | null | undefined,
): number {
  if (typeof dealValue !== 'number' || !Number.isFinite(dealValue) || dealValue <= 0) {
    return 0
  }
  if (
    typeof dealProbability !== 'number' ||
    !Number.isFinite(dealProbability) ||
    dealProbability <= 0
  ) {
    return 0
  }
  // Clamp probabilité 0-100 (defense contre données corrompues).
  const p = Math.max(0, Math.min(100, dealProbability))
  return Math.round((dealValue * p) / 100)
}

/**
 * Somme le forecast d'une liste de prospects. Retourne un entier (€).
 */
export function sumForecast(
  prospects: ReadonlyArray<{
    deal_value?: number | null
    deal_probability?: number | null
  }>,
): number {
  let total = 0
  for (const p of prospects) {
    total += computeForecast(p.deal_value, p.deal_probability)
  }
  return total
}

/**
 * Formate un montant en euros avec séparateur de milliers FR.
 *   12500   → "12 500 €"
 *   0       → "0 €"
 *   1234567 → "1 234 567 €"
 */
export function formatEuros(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return '0 €'
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(Math.round(amount))
}
