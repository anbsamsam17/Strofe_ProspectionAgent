import { createClient } from '@/lib/supabase/server'
import type { AgentRun, Prospect } from '@/lib/types'
import {
  formatDurationShort,
  sourcingMix,
  topSectors,
  toRunStat,
  type RunStat,
  type SectorStat,
} from '@/lib/pipeline/analytics'
import type { PipelineRange } from './period-toggle'
import { rangeStartISO } from './period-toggle'

// ── Constantes de dessin ────────────────────────────────────────────────────

const TIMESERIES_MAX_RUNS = 30
const BAR_WIDTH = 10
const BAR_GAP = 4
const TIMESERIES_HEIGHT = 80
const SPARKLINE_HEIGHT = 24

// ── Composant principal ─────────────────────────────────────────────────────

interface AgentStatsProps {
  range: PipelineRange
}

/**
 * Server Component — affiche les stats de l'agent de sourcing :
 *  - Time series 30 derniers runs (barres SVG empilées qualified solid + sourced opacity)
 *  - Sparkline durée par-dessus
 *  - Sirene vs Recherche Entreprises (stacked bar 2 segments)
 *  - Top 5 secteurs sourcés (liste horizontale)
 */
export async function AgentStats({ range }: AgentStatsProps) {
  const supabase = await createClient()
  const windowStart = rangeStartISO(range)

  // RLS implicite — pas de filtre user_id côté SSR.
  const runsQuery = supabase
    .from('agent_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(TIMESERIES_MAX_RUNS)

  if (windowStart !== null) {
    runsQuery.gte('started_at', windowStart)
  }

  const prospectsQuery = supabase
    .from('prospects')
    .select('*')
    .is('archived_at', null)

  const [{ data: runsRaw }, { data: prospectsRaw }] = await Promise.all([
    runsQuery,
    prospectsQuery,
  ])

  const runs = (runsRaw ?? []) as unknown as AgentRun[]
  const prospects = (prospectsRaw ?? []) as unknown as Prospect[]

  // Inverse les runs pour avoir le plus ancien à gauche dans la viz.
  const runStats: RunStat[] = runs.slice().reverse().map(toRunStat)
  const mix = sourcingMix(prospects, runs)
  const sectors = topSectors(prospects, 5)

  return (
    <section
      aria-label="Statistiques de l'agent de sourcing"
      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
    >
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Activité agent
        </h2>
        <p className="text-xs text-gray-400 dark:text-gray-600">
          {runStats.length === 0
            ? 'Aucun run sur la période'
            : `${runStats.length} run${runStats.length > 1 ? 's' : ''} affichés`}
        </p>
      </header>

      <div className="space-y-5">
        <RunsTimeSeries runs={runStats} />
        <SourcingMixBar sirene={mix.sirene} recherche={mix.recherche} sirenePct={mix.sirenePct} />
        <TopSectors sectors={sectors} />
      </div>
    </section>
  )
}

// ── Time series : barres SVG empilées + sparkline durée ─────────────────────

function RunsTimeSeries({ runs }: { runs: RunStat[] }) {
  if (runs.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 py-8 text-xs text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500">
        Aucun run agent encore enregistré sur cette période.
      </div>
    )
  }

  const maxSourced = Math.max(...runs.map((r) => r.prospectsSourced), 1)
  const maxDuration = Math.max(
    ...runs.map((r) => (r.durationMs ?? 0)),
    1,
  )
  const totalWidth = runs.length * BAR_WIDTH + (runs.length - 1) * BAR_GAP

  // Sparkline durée : polyline depuis le haut du SVG, axe Y secondaire normalisé
  const sparklinePoints = runs
    .map((r, idx) => {
      const x = idx * (BAR_WIDTH + BAR_GAP) + BAR_WIDTH / 2
      const y =
        r.durationMs === null
          ? SPARKLINE_HEIGHT
          : SPARKLINE_HEIGHT - (r.durationMs / maxDuration) * SPARKLINE_HEIGHT
      return `${x},${y}`
    })
    .join(' ')

  const totalHeight = TIMESERIES_HEIGHT + SPARKLINE_HEIGHT + 12

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-xs">
        <p className="font-medium text-gray-700 dark:text-gray-300">
          {runs.length} derniers runs · sourcés (clair) + qualifiés (foncé)
        </p>
        <p className="text-gray-400 dark:text-gray-600">durée en sparkline</p>
      </div>
      <svg
        viewBox={`0 0 ${Math.max(totalWidth, 100)} ${totalHeight}`}
        role="img"
        aria-label={`Historique de ${runs.length} runs agent : sourcés, qualifiés, durée`}
        className="h-auto w-full"
      >
        {/* Sparkline durée — au-dessus des barres */}
        <polyline
          points={sparklinePoints}
          fill="none"
          stroke="rgb(217 119 6)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.8}
        />
        {/* Barres runs : qualified solid + (sourced - qualified) opacity */}
        {runs.map((r, idx) => {
          const x = idx * (BAR_WIDTH + BAR_GAP)
          if (r.status === 'failed') {
            // Failed = barre rouge fixe basse
            const failedHeight = 8
            return (
              <g key={r.id}>
                <title>{`Run ${r.id.slice(0, 8)} · échoué${r.errorMessage ? ` : ${r.errorMessage.slice(0, 80)}` : ''}`}</title>
                <rect
                  x={x}
                  y={SPARKLINE_HEIGHT + 12 + TIMESERIES_HEIGHT - failedHeight}
                  width={BAR_WIDTH}
                  height={failedHeight}
                  fill="rgb(239 68 68)"
                  rx={1}
                />
              </g>
            )
          }
          const qualifiedHeight =
            (r.prospectsQualified / maxSourced) * TIMESERIES_HEIGHT
          const sourcedHeight = (r.prospectsSourced / maxSourced) * TIMESERIES_HEIGHT
          const yBase = SPARKLINE_HEIGHT + 12 + TIMESERIES_HEIGHT
          const yQualified = yBase - qualifiedHeight
          const ySourced = yBase - sourcedHeight
          return (
            <g key={r.id}>
              <title>{`Run ${r.id.slice(0, 8)} · ${r.prospectsSourced} sourcés · ${r.prospectsQualified} qualifiés · ${formatDurationShort(r.durationMs)}`}</title>
              {/* Sourced (clair, opacity) en haut */}
              <rect
                x={x}
                y={ySourced}
                width={BAR_WIDTH}
                height={sourcedHeight - qualifiedHeight}
                fill="rgb(34 197 94)"
                opacity={0.35}
                rx={1}
              />
              {/* Qualified (foncé) en bas */}
              <rect
                x={x}
                y={yQualified}
                width={BAR_WIDTH}
                height={qualifiedHeight}
                fill="rgb(21 128 61)"
                rx={1}
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Sirene vs Recherche Entreprises (stacked bar 2 segments) ────────────────

interface SourcingMixBarProps {
  sirene: number
  recherche: number
  sirenePct: number
}

function SourcingMixBar({ sirene, recherche, sirenePct }: SourcingMixBarProps) {
  const total = sirene + recherche
  if (total === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 py-3 text-xs text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500">
        Source des prospects inconnue (aucun run avec métadonnée détectée).
      </div>
    )
  }

  const rechercheePct = 100 - sirenePct

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-xs">
        <p className="font-medium text-gray-700 dark:text-gray-300">Source des prospects</p>
        <p className="tabular-nums text-gray-500 dark:text-gray-400">
          {sirene} Sirene · {recherche} Recherche Entreprises
        </p>
      </div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
        role="img"
        aria-label={`${Math.round(sirenePct)} % via Sirene, ${Math.round(rechercheePct)} % via Recherche Entreprises`}
      >
        <div
          className="bg-emerald-500"
          style={{ width: `${sirenePct}%` }}
          title={`Sirene : ${Math.round(sirenePct)} %`}
        />
        <div
          className="bg-amber-500"
          style={{ width: `${rechercheePct}%` }}
          title={`Recherche Entreprises : ${Math.round(rechercheePct)} %`}
        />
      </div>
    </div>
  )
}

// ── Top 5 secteurs (liste horizontale) ──────────────────────────────────────

function TopSectors({ sectors }: { sectors: SectorStat[] }) {
  if (sectors.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 py-3 text-xs text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500">
        Aucun secteur identifié pour l&apos;instant.
      </div>
    )
  }
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-300">
        Top {sectors.length} secteurs sourcés
      </p>
      <ul className="space-y-1.5" aria-label="Répartition des prospects par secteur">
        {sectors.map((s) => (
          <li key={s.label} className="flex items-center gap-3">
            <span
              className="min-w-0 flex-1 truncate text-xs text-gray-600 dark:text-gray-400"
              title={s.label}
            >
              {s.label}
            </span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div
                className="h-full bg-green-500"
                style={{ width: `${Math.max(2, s.sharePct)}%` }}
                aria-hidden="true"
              />
            </div>
            <span className="w-8 text-right text-xs tabular-nums text-gray-700 dark:text-gray-300">
              {s.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Skeleton (Suspense fallback) ────────────────────────────────────────────

export function AgentStatsSkeleton() {
  return (
    <div
      className="h-[280px] animate-pulse rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/50"
      aria-busy="true"
      aria-label="Chargement des stats agent"
    />
  )
}
