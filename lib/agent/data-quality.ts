// ============================================================
// DATA QUALITY GATES — Agent IA Prospection Bilan Carbone
//
// Assertions de qualité des données d'un run de sourcing. L'objectif est de
// DÉTECTER et ALERTER sur une dégradation (volume effondré, trop de prospects
// en mode dégradé, taux de match ADEME anormalement bas, chute brutale vs run
// précédent) au lieu de la laisser passer silencieusement.
//
// Ce module est PUR : aucune dépendance réseau, aucune lecture DB, aucun effet
// de bord. Il prend des compteurs/taux en entrée et renvoie un rapport. La
// persistance et le logging sont la responsabilité de l'orchestrateur.
//
// PII : ce module ne manipule QUE des compteurs et des taux agrégés. Aucune
// donnée prospect individuelle (siren, contact, raison sociale) ne transite ici.
// ============================================================

// ------------------------------------------------------------
// TYPES
// ------------------------------------------------------------

/** Statut d'un check individuel ou du rapport agrégé. */
export type DataQualityStatus = 'ok' | 'warn' | 'critical'

/**
 * Métriques d'entrée d'un run, agrégées par l'orchestrateur à partir du
 * `PipelineSourcingOutput`. Tous les champs sont des compteurs entiers.
 *
 * Les champs `previous*` sont optionnels : ils ne sont renseignés que si le
 * run précédent (même user) est connu, permettant la détection de chute
 * brutale. Absents → les checks comparatifs sont skippés (status `ok`).
 */
export interface RunQualityMetrics {
  /** Nombre total de prospects sourcés ce run (scored.length). */
  prospectsSourced: number
  /** Prospects sans aucun point de contact (ni email ni téléphone). */
  prospectsSansContact: number
  /** Prospects sans donnée BEGES exploitable (enrichissement ADEME absent). */
  prospectsSansBeges: number
  /** Prospects pour lesquels un bilan BEGES a été trouvé via ADEME. */
  prospectsAvecBeges: number
  /** true ssi le sourcing a basculé sur le fallback Recherche Entreprises. */
  usedFallback: boolean
  /** true ssi l'univers Sirene était vide pour ces filtres (404 1ère page). */
  universeEmpty: boolean
  /**
   * Volume sourcé du run précédent (même user), si connu. Sert au check de
   * chute brutale. `undefined`/`null` = pas de run précédent → check skippé.
   */
  previousProspectsSourced?: number | null
}

/**
 * Seuils paramétrables des checks. Tous optionnels : les défauts
 * (`DEFAULT_DQ_THRESHOLDS`) s'appliquent champ par champ.
 */
export interface DataQualityThresholds {
  /** Volume sourcé en-dessous duquel on émet un `warn`. */
  minSourcedWarn: number
  /** Volume sourcé en-dessous duquel on émet un `critical`. */
  minSourcedCritical: number
  /** Taux (0-1) de prospects sans contact au-delà duquel → `warn`. */
  maxSansContactRateWarn: number
  /** Taux (0-1) de prospects sans contact au-delà duquel → `critical`. */
  maxSansContactRateCritical: number
  /** Taux (0-1) de prospects sans BEGES au-delà duquel → `warn`. */
  maxSansBegesRateWarn: number
  /** Taux (0-1) de prospects sans BEGES au-delà duquel → `critical`. */
  maxSansBegesRateCritical: number
  /** Taux (0-1) de match ADEME en-dessous duquel → `warn`. */
  minAdemeMatchRateWarn: number
  /** Taux (0-1) de match ADEME en-dessous duquel → `critical`. */
  minAdemeMatchRateCritical: number
  /** Chute relative (0-1) vs run précédent au-delà de laquelle → `warn`. */
  maxDropVsPreviousWarn: number
  /** Chute relative (0-1) vs run précédent au-delà de laquelle → `critical`. */
  maxDropVsPreviousCritical: number
}

/** Résultat d'un check individuel. */
export interface DataQualityCheck {
  /** Identifiant stable du check (SCREAMING_SNAKE pour le logging). */
  name: string
  status: DataQualityStatus
  /** Valeur observée (taux ou compteur selon le check). */
  observed: number
  /** Seuil franchi (ou le plus pertinent), ou `null` si check skippé. */
  threshold: number | null
  /** Message lisible (sans PII), pour les logs et l'UI. */
  message: string
  /** true ssi le check n'a pas pu être évalué (données insuffisantes). */
  skipped: boolean
}

/** Rapport agrégé d'un run. */
export interface DataQualityReport {
  /** Statut global = max gravité des checks non-skippés. */
  status: DataQualityStatus
  checks: DataQualityCheck[]
  /** Compteurs par statut (ok/warn/critical) sur les checks non-skippés. */
  summary: {
    ok: number
    warn: number
    critical: number
    skipped: number
  }
}

// ------------------------------------------------------------
// SEUILS PAR DÉFAUT
// ------------------------------------------------------------

/**
 * Défauts calibrés sur la cible nominale (`sourcing_target_per_run` ~15 →
 * targetCandidates ~50, déperdition au scoring). Un run sain produit
 * typiquement plusieurs dizaines de prospects avec un taux de contact partiel
 * (enrichissement HOT-first plafonné) — d'où des seuils tolérants sur le
 * contact mais stricts sur le volume effondré.
 */
export const DEFAULT_DQ_THRESHOLDS: DataQualityThresholds = {
  minSourcedWarn: 10,
  minSourcedCritical: 1,
  maxSansContactRateWarn: 0.8,
  maxSansContactRateCritical: 0.97,
  maxSansBegesRateWarn: 0.9,
  maxSansBegesRateCritical: 0.99,
  minAdemeMatchRateWarn: 0.1,
  minAdemeMatchRateCritical: 0.02,
  maxDropVsPreviousWarn: 0.5,
  maxDropVsPreviousCritical: 0.8,
}

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

/** Gravité ordinale pour calculer le max d'un set de statuts. */
const STATUS_RANK: Record<DataQualityStatus, number> = {
  ok: 0,
  warn: 1,
  critical: 2,
}

function worstStatus(a: DataQualityStatus, b: DataQualityStatus): DataQualityStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b
}

/** Ratio borné [0,1] tolérant au dénominateur nul (renvoie 0). */
function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  const r = numerator / denominator
  if (r < 0) return 0
  if (r > 1) return 1
  return r
}

// ------------------------------------------------------------
// CHECKS INDIVIDUELS
// ------------------------------------------------------------

/**
 * CHECK VOLUME — détecte un run qui source anormalement peu de prospects.
 *
 * Un univers Sirene vide pour les filtres courants (`universeEmpty`) n'est PAS
 * une dégradation de qualité : c'est un état métier attendu (l'utilisateur a
 * épuisé sa cible). On skippe alors le check pour éviter une fausse alerte.
 */
function checkVolume(
  metrics: RunQualityMetrics,
  t: DataQualityThresholds,
): DataQualityCheck {
  const observed = metrics.prospectsSourced

  if (metrics.universeEmpty) {
    return {
      name: 'SOURCED_VOLUME',
      status: 'ok',
      observed,
      threshold: null,
      message: 'Univers Sirene vide pour ces filtres — check volume non applicable',
      skipped: true,
    }
  }

  if (observed <= t.minSourcedCritical) {
    return {
      name: 'SOURCED_VOLUME',
      status: 'critical',
      observed,
      threshold: t.minSourcedCritical,
      message: `Volume sourcé effondré (${observed} ≤ ${t.minSourcedCritical}) — pipeline probablement cassé`,
      skipped: false,
    }
  }

  if (observed < t.minSourcedWarn) {
    return {
      name: 'SOURCED_VOLUME',
      status: 'warn',
      observed,
      threshold: t.minSourcedWarn,
      message: `Volume sourcé faible (${observed} < ${t.minSourcedWarn})`,
      skipped: false,
    }
  }

  return {
    name: 'SOURCED_VOLUME',
    status: 'ok',
    observed,
    threshold: t.minSourcedWarn,
    message: `Volume sourcé nominal (${observed})`,
    skipped: false,
  }
}

/**
 * CHECK CONTACT — détecte une proportion anormale de prospects sans aucun point
 * de contact (ni email ni téléphone). Un taux élevé signale un échec en cascade
 * de l'enrichissement contact (Recherche Entreprises / Pappers / Hunter down).
 */
function checkSansContact(
  metrics: RunQualityMetrics,
  t: DataQualityThresholds,
): DataQualityCheck {
  if (metrics.prospectsSourced <= 0) {
    return {
      name: 'SANS_CONTACT_RATE',
      status: 'ok',
      observed: 0,
      threshold: null,
      message: 'Aucun prospect sourcé — taux sans-contact non applicable',
      skipped: true,
    }
  }

  const rate = safeRate(metrics.prospectsSansContact, metrics.prospectsSourced)
  const observed = Number(rate.toFixed(4))

  if (rate >= t.maxSansContactRateCritical) {
    return {
      name: 'SANS_CONTACT_RATE',
      status: 'critical',
      observed,
      threshold: t.maxSansContactRateCritical,
      message: `Quasi aucun contact trouvé (${observed} ≥ ${t.maxSansContactRateCritical}) — cascade enrichissement probablement KO`,
      skipped: false,
    }
  }

  if (rate >= t.maxSansContactRateWarn) {
    return {
      name: 'SANS_CONTACT_RATE',
      status: 'warn',
      observed,
      threshold: t.maxSansContactRateWarn,
      message: `Taux de prospects sans contact élevé (${observed} ≥ ${t.maxSansContactRateWarn})`,
      skipped: false,
    }
  }

  return {
    name: 'SANS_CONTACT_RATE',
    status: 'ok',
    observed,
    threshold: t.maxSansContactRateWarn,
    message: `Taux de prospects sans contact nominal (${observed})`,
    skipped: false,
  }
}

/**
 * CHECK MODE DÉGRADÉ BEGES — détecte une proportion anormale de prospects sans
 * donnée BEGES exploitable. Au-delà du seuil, l'enrichissement ADEME a
 * massivement échoué (timeout, cap, API down) et les prospects sont insérés en
 * mode dégradé.
 */
function checkSansBeges(
  metrics: RunQualityMetrics,
  t: DataQualityThresholds,
): DataQualityCheck {
  if (metrics.prospectsSourced <= 0) {
    return {
      name: 'SANS_BEGES_RATE',
      status: 'ok',
      observed: 0,
      threshold: null,
      message: 'Aucun prospect sourcé — taux mode-dégradé non applicable',
      skipped: true,
    }
  }

  const rate = safeRate(metrics.prospectsSansBeges, metrics.prospectsSourced)
  const observed = Number(rate.toFixed(4))

  if (rate >= t.maxSansBegesRateCritical) {
    return {
      name: 'SANS_BEGES_RATE',
      status: 'critical',
      observed,
      threshold: t.maxSansBegesRateCritical,
      message: `Quasi tous les prospects en mode dégradé BEGES (${observed} ≥ ${t.maxSansBegesRateCritical}) — enrichissement ADEME probablement KO`,
      skipped: false,
    }
  }

  if (rate >= t.maxSansBegesRateWarn) {
    return {
      name: 'SANS_BEGES_RATE',
      status: 'warn',
      observed,
      threshold: t.maxSansBegesRateWarn,
      message: `Proportion de prospects en mode dégradé BEGES élevée (${observed} ≥ ${t.maxSansBegesRateWarn})`,
      skipped: false,
    }
  }

  return {
    name: 'SANS_BEGES_RATE',
    status: 'ok',
    observed,
    threshold: t.maxSansBegesRateWarn,
    message: `Proportion de prospects en mode dégradé BEGES nominale (${observed})`,
    skipped: false,
  }
}

/**
 * CHECK MATCH ADEME — détecte un taux de match BEGES anormalement bas. Le taux
 * de match (prospects avec bilan ADEME / total sourcé) est attendu faible (peu
 * d'entreprises publient un BEGES) mais un taux NUL ou quasi-nul sur un volume
 * conséquent signale une panne de la phase ADEME plutôt qu'une réalité métier.
 *
 * On ne déclenche que si le volume est suffisant pour que le taux soit
 * significatif (>= minSourcedWarn), sinon le check est skippé.
 */
function checkAdemeMatch(
  metrics: RunQualityMetrics,
  t: DataQualityThresholds,
): DataQualityCheck {
  if (metrics.prospectsSourced < t.minSourcedWarn) {
    return {
      name: 'ADEME_MATCH_RATE',
      status: 'ok',
      observed: 0,
      threshold: null,
      message: 'Volume insuffisant pour évaluer le taux de match ADEME',
      skipped: true,
    }
  }

  const rate = safeRate(metrics.prospectsAvecBeges, metrics.prospectsSourced)
  const observed = Number(rate.toFixed(4))

  if (rate <= t.minAdemeMatchRateCritical) {
    return {
      name: 'ADEME_MATCH_RATE',
      status: 'critical',
      observed,
      threshold: t.minAdemeMatchRateCritical,
      message: `Taux de match ADEME quasi-nul (${observed} ≤ ${t.minAdemeMatchRateCritical}) sur ${metrics.prospectsSourced} prospects — phase ADEME probablement KO`,
      skipped: false,
    }
  }

  if (rate < t.minAdemeMatchRateWarn) {
    return {
      name: 'ADEME_MATCH_RATE',
      status: 'warn',
      observed,
      threshold: t.minAdemeMatchRateWarn,
      message: `Taux de match ADEME bas (${observed} < ${t.minAdemeMatchRateWarn})`,
      skipped: false,
    }
  }

  return {
    name: 'ADEME_MATCH_RATE',
    status: 'ok',
    observed,
    threshold: t.minAdemeMatchRateWarn,
    message: `Taux de match ADEME nominal (${observed})`,
    skipped: false,
  }
}

/**
 * CHECK CHUTE VS RUN PRÉCÉDENT — détecte un effondrement relatif du volume
 * sourcé par rapport au run précédent du même user. Skippé si pas de run
 * précédent connu, si le run précédent était lui-même vide, ou si le run
 * courant a basculé sur le fallback (volume non comparable par construction).
 */
function checkDropVsPrevious(
  metrics: RunQualityMetrics,
  t: DataQualityThresholds,
): DataQualityCheck {
  const previous = metrics.previousProspectsSourced

  if (previous === undefined || previous === null || previous <= 0) {
    return {
      name: 'DROP_VS_PREVIOUS',
      status: 'ok',
      observed: 0,
      threshold: null,
      message: 'Pas de run précédent exploitable — check de chute non applicable',
      skipped: true,
    }
  }

  if (metrics.usedFallback || metrics.universeEmpty) {
    return {
      name: 'DROP_VS_PREVIOUS',
      status: 'ok',
      observed: 0,
      threshold: null,
      message: 'Run en fallback ou univers vide — volume non comparable au run précédent',
      skipped: true,
    }
  }

  // Chute relative : part du volume perdue vs run précédent, bornée [0,1].
  const drop = safeRate(previous - metrics.prospectsSourced, previous)
  const observed = Number(drop.toFixed(4))

  if (drop >= t.maxDropVsPreviousCritical) {
    return {
      name: 'DROP_VS_PREVIOUS',
      status: 'critical',
      observed,
      threshold: t.maxDropVsPreviousCritical,
      message: `Chute brutale du volume vs run précédent (${observed} ≥ ${t.maxDropVsPreviousCritical} ; ${metrics.prospectsSourced} vs ${previous})`,
      skipped: false,
    }
  }

  if (drop >= t.maxDropVsPreviousWarn) {
    return {
      name: 'DROP_VS_PREVIOUS',
      status: 'warn',
      observed,
      threshold: t.maxDropVsPreviousWarn,
      message: `Baisse notable du volume vs run précédent (${observed} ≥ ${t.maxDropVsPreviousWarn} ; ${metrics.prospectsSourced} vs ${previous})`,
      skipped: false,
    }
  }

  return {
    name: 'DROP_VS_PREVIOUS',
    status: 'ok',
    observed,
    threshold: t.maxDropVsPreviousWarn,
    message: `Volume stable vs run précédent (${observed})`,
    skipped: false,
  }
}

// ------------------------------------------------------------
// POINT D'ENTRÉE
// ------------------------------------------------------------

/**
 * Exécute tous les data-quality checks et agrège un rapport.
 *
 * Pur et total : ne throw jamais (les checks gèrent leurs cas limites), ce qui
 * garantit le caractère non-fatal côté orchestrateur. Les seuils fournis sont
 * fusionnés champ par champ avec `DEFAULT_DQ_THRESHOLDS`.
 *
 * @param metrics Compteurs agrégés du run (PII-free).
 * @param thresholds Surcharge partielle des seuils (optionnel).
 */
export function runDataQualityChecks(
  metrics: RunQualityMetrics,
  thresholds: Partial<DataQualityThresholds> = {},
): DataQualityReport {
  const t: DataQualityThresholds = { ...DEFAULT_DQ_THRESHOLDS, ...thresholds }

  const checks: DataQualityCheck[] = [
    checkVolume(metrics, t),
    checkSansContact(metrics, t),
    checkSansBeges(metrics, t),
    checkAdemeMatch(metrics, t),
    checkDropVsPrevious(metrics, t),
  ]

  const summary = { ok: 0, warn: 0, critical: 0, skipped: 0 }
  let status: DataQualityStatus = 'ok'

  for (const check of checks) {
    if (check.skipped) {
      summary.skipped += 1
      continue
    }
    summary[check.status] += 1
    status = worstStatus(status, check.status)
  }

  return { status, checks, summary }
}
