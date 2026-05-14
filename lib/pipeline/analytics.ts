// ============================================================
// Pipeline analytics — fonctions pures pour entonnoir + stats agent
// ============================================================
//
// Pas d'I/O ici (pas de fetch Supabase). Fonctions pures :
//   inputs synthétiques → outputs typés.
// Permet de tester les calculs sans monter une DB.

import type { AgentRun, AgentRunStatus, Prospect, ProspectStatus } from '@/lib/types'

// ── Funnel ──────────────────────────────────────────────────────────────────

/**
 * Les 5 étapes "actives" du pipeline. `interested` est fusionné dans
 * `qualified` côté UI/funnel (décision produit) ; `rejected` et `on_hold`
 * sont exclus du funnel (archive).
 */
export const FUNNEL_STEPS = [
  'sourced',
  'qualified',
  'contacted',
  'rdv',
  'converted',
] as const

export type FunnelStep = (typeof FUNNEL_STEPS)[number]

export interface FunnelStage {
  step: FunnelStep
  label: string
  count: number
  /** Conversion depuis l'étape précédente (0-100, 100 pour la première). */
  stepConversionPct: number
  /** Conversion cumulée depuis "sourced" (0-100). */
  cumulativePct: number
}

const FUNNEL_LABELS: Record<FunnelStep, string> = {
  sourced: 'Sourcé',
  qualified: 'Qualifié',
  contacted: 'Contacté',
  rdv: 'RDV',
  converted: 'Converti',
}

/**
 * Construit les étages du funnel à partir des counts par statut.
 *
 * `interested` est fusionné dans `qualified` (décision produit).
 */
export function buildFunnel(
  countsByStatus: Record<ProspectStatus, number>,
): FunnelStage[] {
  // Défensif : `?? 0` sur chaque accès — si l'appelant construit un Record partiel
  // (oubli d'un statut, ex. `offer_sent` ajouté plus tard), `undefined + n` produit
  // NaN qui se propage dans tous les calculs et casse le SVG du funnel (polygon
  // avec `points="NaN,NaN …"` → crash SSR render observé prod digest 245842919).
  const fused: Record<FunnelStep, number> = {
    sourced: countsByStatus.sourced ?? 0,
    qualified: (countsByStatus.qualified ?? 0) + (countsByStatus.interested ?? 0),
    contacted: countsByStatus.contacted ?? 0,
    rdv: countsByStatus.rdv ?? 0,
    converted: countsByStatus.converted ?? 0,
  }

  const sourced = fused.sourced || 0

  return FUNNEL_STEPS.map((step, idx) => {
    const count = fused[step]
    const prev = idx === 0 ? count : fused[FUNNEL_STEPS[idx - 1]]
    const stepConversionPct = idx === 0 ? 100 : prev > 0 ? (count / prev) * 100 : 0
    const cumulativePct = sourced > 0 ? (count / sourced) * 100 : 0
    return {
      step,
      label: FUNNEL_LABELS[step],
      count,
      stepConversionPct,
      cumulativePct,
    }
  })
}

// ── Top secteurs ────────────────────────────────────────────────────────────

export interface SectorStat {
  label: string
  count: number
  /** Part du total (0-100). */
  sharePct: number
}

/**
 * Agrège les prospects par `secteur_libelle`. Retourne le top N (default 5).
 * Les prospects sans libellé secteur sont regroupés sous "Secteur inconnu".
 */
export function topSectors(prospects: Prospect[], limit = 5): SectorStat[] {
  if (prospects.length === 0) return []

  const counts = new Map<string, number>()
  for (const p of prospects) {
    const key = p.secteur_libelle?.trim() || 'Secteur inconnu'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const total = prospects.length
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)

  return sorted.map(([label, count]) => ({
    label,
    count,
    sharePct: total > 0 ? (count / total) * 100 : 0,
  }))
}

// ── Stats sourcing : Sirene vs fallback ─────────────────────────────────────

export interface SourcingMix {
  sirene: number
  recherche: number
  /** Part Sirene (0-100). 0 si total nul. */
  sirenePct: number
}

/**
 * Devine la répartition Sirene / Recherche Entreprises à partir :
 *   1. de `prospects.source` quand c'est dispo (`sirene_api` vs autre),
 *   2. en backup, du flag `used_fallback` dans `agent_runs.logs`.
 *
 * Volontairement défensif : aucune source connue → on retourne {0,0,0}.
 */
export function sourcingMix(prospects: Prospect[], runs: AgentRun[]): SourcingMix {
  let sirene = 0
  let recherche = 0
  for (const p of prospects) {
    if (p.source === 'sirene_api') sirene += 1
    else if (p.source) recherche += 1
  }

  // Si les sources prospects sont vides, ré-évalue via runs
  if (sirene === 0 && recherche === 0) {
    for (const run of runs) {
      const logs = Array.isArray(run.logs) ? run.logs : []
      for (const log of logs) {
        const meta = log.data
        if (meta && typeof meta === 'object' && 'used_fallback' in meta) {
          if (meta.used_fallback === true) recherche += run.prospects_sourced
          else sirene += run.prospects_sourced
          break
        }
      }
    }
  }

  const total = sirene + recherche
  return {
    sirene,
    recherche,
    sirenePct: total > 0 ? (sirene / total) * 100 : 0,
  }
}

// ── Stats runs : durée + sparkline ──────────────────────────────────────────

export interface RunStat {
  id: string
  startedAt: string
  durationMs: number | null
  prospectsSourced: number
  prospectsQualified: number
  status: AgentRunStatus
  errorMessage: string | null
}

/**
 * Normalise un AgentRun pour la viz time-series.
 * `durationMs` est null si le run n'est pas terminé ou si les timestamps sont incohérents.
 */
export function toRunStat(run: AgentRun): RunStat {
  const start = Date.parse(run.started_at)
  const end = run.completed_at ? Date.parse(run.completed_at) : NaN
  const durationMs =
    Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null
  return {
    id: run.id,
    startedAt: run.started_at,
    durationMs,
    prospectsSourced: run.prospects_sourced,
    prospectsQualified: run.prospects_qualified,
    status: run.status,
    errorMessage: run.error_message ?? null,
  }
}

/** Formatte une durée ms → "Xm Ys" (ou "Xs" si < 1min). */
export function formatDurationShort(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—'
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
}
