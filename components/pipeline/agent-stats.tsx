import { createClient } from '@/lib/supabase/server'
import type { AgentRun, Prospect } from '@/lib/types'
import {
  formatDurationShort,
  sourcingMix,
  sectorsByNafSection,
  toRunStat,
  topSectors,
  type RunStat,
  type NafSectionStat,
  type SectorStat,
} from '@/lib/pipeline/analytics'
import type { PipelineRange } from '@/lib/pipeline/range'
import { rangeStartISO } from '@/lib/pipeline/range'

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
  let runStats: RunStat[]
  let mix: ReturnType<typeof sourcingMix>
  let sectors: NafSectionStat[]
  try {
    const supabase = await createClient()
    const windowStart = rangeStartISO(range)

    // RLS implicite — pas de filtre user_id côté SSR.
    // ⚠️ Important : on SELECT seulement les colonnes utilisées, pour éviter
    // de récupérer les JSONB lourds (`logs` peut être massif avec heartbeat 30s
    // + Sentry captures). `select('*')` causait un crash Lambda en prod (réponse
    // dépassant les limites Vercel sur des centaines de prospects × JSONB).
    //
    // FIX 2026-05-14 (crash digest 355321305) : `logs` était encore inclus dans
    // le SELECT malgré l'intention de l'éviter — 30 runs × plusieurs MB de logs
    // JSONB faisait OOM la Lambda Vercel (process killed → Server Components
    // render error non capturable par try/catch ou Suspense). `sourcingMix`
    // fallback sur `logs` ne marche plus mais la branche primaire (prospects.source)
    // suffit ; analytics.ts retourne `{0,0,0}` proprement si aucune source connue.
    //
    // Note bug Supabase JS : `.gte()` après l'init du builder retourne un nouveau
    // builder qu'il faut RÉASSIGNER (sinon le filtre est silencieusement ignoré).
    let runsQuery = supabase
      .from('agent_runs')
      .select('id, status, started_at, completed_at, prospects_sourced, prospects_qualified, error_message')
      .order('started_at', { ascending: false })
      .limit(TIMESERIES_MAX_RUNS)

    if (windowStart !== null) {
      runsQuery = runsQuery.gte('started_at', windowStart)
    }

    // Pour `sourcingMix` + `sectorsByNafSection` on n'a besoin que de 3 colonnes — pas
    // de récupérer tout score_details, signaux, contact_*, etc.
    // `secteur_naf` est le code brut (ex. '86.10Z') — sectionFromNaf en dérive la section.
    // Range explicite jusqu'à 50k pour ne pas être coupé à 1000 par PostgREST.
    const prospectsQuery = supabase
      .from('prospects')
      .select('source, secteur_naf')
      .is('archived_at', null)
      .range(0, 49_999)

    const [
      { data: runsRaw, error: rErr },
      { data: prospectsRaw, error: pErr },
    ] = await Promise.all([runsQuery, prospectsQuery])

    if (rErr || pErr) {
      console.error('[AgentStats] Supabase query error', {
        runs_error: rErr?.message,
        prospects_error: pErr?.message,
      })
      return <AgentStatsError reason={rErr?.message ?? pErr?.message ?? 'unknown'} />
    }

    const runs = (runsRaw ?? []) as unknown as AgentRun[]
    const prospects = (prospectsRaw ?? []) as unknown as Prospect[]

    // Inverse les runs pour avoir le plus ancien à gauche dans la viz.
    runStats = runs.slice().reverse().map(toRunStat)
    mix = sourcingMix(prospects, runs)
    sectors = sectorsByNafSection(prospects)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[AgentStats] Render error', { message: msg, stack: err instanceof Error ? err.stack : undefined })
    return <AgentStatsError reason={msg} />
  }

  return (
    <section
      aria-label="Statistiques de l'agent de sourcing"
      className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
    >
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-300">
          Activité agent
        </h2>
        <p className="text-xs text-gray-400 dark:text-gray-400">
          {runStats.length === 0
            ? 'Aucun run sur la période'
            : `${runStats.length} run${runStats.length > 1 ? 's' : ''} affichés`}
        </p>
      </header>

      <div className="space-y-5">
        <RunsTimeSeries runs={runStats} />
        <SourcingMixBar sirene={mix.sirene} recherche={mix.recherche} sirenePct={mix.sirenePct} />
        <NafSectionsChart sections={sectors} />
      </div>
    </section>
  )
}

// ── Time series : barres SVG empilées + sparkline durée ─────────────────────

function RunsTimeSeries({ runs }: { runs: RunStat[] }) {
  if (runs.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] py-8 text-xs text-gray-400">
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
        <p className="font-medium text-gray-200">
          {runs.length} derniers runs · sourcés (clair) + qualifiés (foncé)
        </p>
        <p className="text-gray-400 dark:text-gray-400">durée en sparkline</p>
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
      <div className="flex items-center justify-center rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] py-3 text-xs text-gray-400">
        Source des prospects inconnue (aucun run avec métadonnée détectée).
      </div>
    )
  }

  const rechercheePct = 100 - sirenePct

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-xs">
        <p className="font-medium text-gray-200">Source des prospects</p>
        <p className="tabular-nums text-gray-400">
          {sirene} Sirene · {recherche} Recherche Entreprises
        </p>
      </div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.05] dark:bg-gray-800"
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

// ── Sections NAF (bar chart horizontal, 21 sections INSEE rev. 2) ────────────

function NafSectionsChart({ sections }: { sections: NafSectionStat[] }) {
  if (sections.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] py-3 text-xs text-gray-400">
        Aucune section NAF identifiée pour l&apos;instant.
      </div>
    )
  }

  const maxCount = Math.max(...sections.map((s) => s.count), 1)

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-gray-200">
        Répartition par section NAF ({sections.length} section
        {sections.length > 1 ? 's' : ''})
      </p>
      <ul className="space-y-1.5" aria-label="Répartition des prospects par section NAF">
        {sections.map((s) => (
          <li key={s.code} className="flex items-center gap-2">
            <span
              className="w-5 flex-shrink-0 text-center font-mono text-xs font-semibold text-gray-400"
              aria-hidden="true"
            >
              {s.code}
            </span>
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.05] dark:bg-gray-800"
              role="img"
              aria-label={`${s.libelle} : ${s.count} prospect${s.count > 1 ? 's' : ''} (${Math.round(s.sharePct)} %)`}
              title={`${s.code} — ${s.libelle}`}
            >
              <div
                className="h-full bg-cyan-500"
                style={{ width: `${(s.count / maxCount) * 100}%` }}
              />
            </div>
            <span className="w-7 flex-shrink-0 text-right text-xs tabular-nums text-gray-200">
              {s.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Fallback erreur (try/catch interne AgentStats) ──────────────────────────

function AgentStatsError({ reason }: { reason: string }) {
  return (
    <section
      role="alert"
      className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] p-5"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-300">
        Activité agent — indisponible
      </h2>
      <p className="mt-2 text-sm text-amber-300">
        Le chargement des stats agent a échoué côté serveur. Le pipeline reste utilisable.
      </p>
      <p className="mt-2 break-words font-mono text-xs text-amber-300/80">
        {reason}
      </p>
    </section>
  )
}

// ── Skeleton (Suspense fallback) ────────────────────────────────────────────

export function AgentStatsSkeleton() {
  return (
    <div
      className="h-[280px] animate-pulse rounded-2xl border border-white/[0.08] bg-white/[0.02] dark:border-gray-800 dark:bg-gray-900/50"
      aria-busy="true"
      aria-label="Chargement des stats agent"
    />
  )
}
