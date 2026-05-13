import { createClient } from '@/lib/supabase/server'
import type { PipelineRange } from './period-toggle'
import { rangeStartISO } from './period-toggle'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProspectRow {
  statut: string
  beges_publie: boolean
  archived_at: string | null
  created_at: string
}

interface DailyListItemRow {
  call_result: string | null
  called_at: string | null
  created_at: string
}

interface AgentRunRow {
  status: string
  started_at: string
  completed_at: string | null
}

interface Kpis {
  activeCount: number
  activeDelta: number
  qualifiedRate: number
  contactSuccessRate: number
  rdvCount: number
  avgRunMs: number | null
  begesCoverage: number
}

// ── Constantes ────────────────────────────────────────────────────────────────

const QUALIFIED_PLUS: ReadonlySet<string> = new Set([
  'qualified',
  'contacted',
  'interested',
  'rdv',
  'converted',
])

const RDV_PLUS: ReadonlySet<string> = new Set(['rdv', 'converted'])

const MS_PER_SECOND = 1000

// ── Calculs (purs, testables) ─────────────────────────────────────────────────

export function computeKpis(
  prospects: ProspectRow[],
  items: DailyListItemRow[],
  runs: AgentRunRow[],
  windowStartISO: string | null,
): Kpis {
  const inWindow = (iso: string): boolean =>
    windowStartISO === null ? true : iso >= windowStartISO

  // 1. Prospects actifs (archived_at IS NULL)
  const active = prospects.filter((p) => p.archived_at === null)
  const activeCount = active.length

  // Delta = créés dans la fenêtre — la fenêtre `all` donne 0 (pas pertinent)
  const activeDelta =
    windowStartISO === null
      ? 0
      : active.filter((p) => inWindow(p.created_at)).length

  // 2. Taux de qualification : qualified+ / total
  const total = prospects.length
  const qualifiedPlus = prospects.filter((p) => QUALIFIED_PLUS.has(p.statut)).length
  const qualifiedRate = total === 0 ? 0 : Math.round((qualifiedPlus / total) * 100)

  // 3. Taux de contact réussi : items appelés avec resultat / items appelés
  const calledInWindow = items.filter(
    (it) => it.called_at !== null && inWindow(it.called_at),
  )
  const withResult = calledInWindow.filter((it) => it.call_result !== null)
  const contactSuccessRate =
    calledInWindow.length === 0
      ? 0
      : Math.round((withResult.length / calledInWindow.length) * 100)

  // 4. RDV pris dans la fenêtre (prospects statut rdv/converted créés dans la fenêtre)
  const rdvCount = prospects.filter(
    (p) => RDV_PLUS.has(p.statut) && inWindow(p.created_at),
  ).length

  // 5. Durée moyenne run (runs completed dans la fenêtre)
  const completed = runs.filter(
    (r) =>
      r.status === 'completed' &&
      r.completed_at !== null &&
      inWindow(r.started_at),
  )
  const avgRunMs =
    completed.length === 0
      ? null
      : completed.reduce((acc, r) => {
          const start = new Date(r.started_at).getTime()
          const end = new Date(r.completed_at as string).getTime()
          return acc + Math.max(0, end - start)
        }, 0) / completed.length

  // 6. BEGES coverage
  const begesPublished = prospects.filter((p) => p.beges_publie).length
  const begesCoverage = total === 0 ? 0 : Math.round((begesPublished / total) * 100)

  return {
    activeCount,
    activeDelta,
    qualifiedRate,
    contactSuccessRate,
    rdvCount,
    avgRunMs,
    begesCoverage,
  }
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  const totalSec = Math.round(ms / MS_PER_SECOND)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

// ── Composant Server ──────────────────────────────────────────────────────────

interface KpiCardsProps {
  range: PipelineRange
}

export async function KpiCards({ range }: KpiCardsProps) {
  let kpis: ReturnType<typeof computeKpis>
  try {
    const supabase = await createClient()
    const windowStart = rangeStartISO(range)

    // RLS implicite — pas de filtre user_id.
    const [
      { data: prospectsRaw, error: pErr },
      { data: itemsRaw, error: iErr },
      { data: runsRaw, error: rErr },
    ] = await Promise.all([
      supabase.from('prospects').select('statut, beges_publie, archived_at, created_at'),
      supabase.from('daily_list_items').select('call_result, called_at, created_at'),
      supabase.from('agent_runs').select('status, started_at, completed_at'),
    ])

    if (pErr || iErr || rErr) {
      console.error('[KpiCards] Supabase query error', {
        prospects_error: pErr?.message,
        items_error: iErr?.message,
        runs_error: rErr?.message,
      })
      return <KpiCardsError reason={pErr?.message ?? iErr?.message ?? rErr?.message ?? 'unknown'} />
    }

    const prospects = (prospectsRaw ?? []) as unknown as ProspectRow[]
    const items = (itemsRaw ?? []) as unknown as DailyListItemRow[]
    const runs = (runsRaw ?? []) as unknown as AgentRunRow[]

    kpis = computeKpis(prospects, items, runs, windowStart)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[KpiCards] Render error', { message: msg, stack: err instanceof Error ? err.stack : undefined })
    return <KpiCardsError reason={msg} />
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <KpiCard
        label="Prospects actifs"
        value={kpis.activeCount.toLocaleString('fr-FR')}
        sublabel={
          range === 'all'
            ? 'Tous statuts hors archive'
            : kpis.activeDelta > 0
              ? `+${kpis.activeDelta} sur la période`
              : 'Aucun nouveau sur la période'
        }
        deltaPositive={kpis.activeDelta > 0}
        icon={<IconBriefcase />}
      />
      <KpiCard
        label="Taux qualification"
        value={`${kpis.qualifiedRate}%`}
        sublabel="Statut qualified ou plus"
        icon={<IconTarget />}
      />
      <KpiCard
        label="Taux contact réussi"
        value={`${kpis.contactSuccessRate}%`}
        sublabel="Résultat saisi / appels passés"
        icon={<IconPhone />}
      />
      <KpiCard
        label="RDV pris"
        value={kpis.rdvCount.toLocaleString('fr-FR')}
        sublabel="Statut rdv ou converted"
        icon={<IconCalendar />}
      />
      <KpiCard
        label="Durée run moyenne"
        value={formatDuration(kpis.avgRunMs)}
        sublabel="Plus court = mieux"
        inverted
        icon={<IconClock />}
      />
      <KpiCard
        label="BEGES coverage"
        value={`${kpis.begesCoverage}%`}
        sublabel="Prospects avec bilan publié"
        icon={<IconLeaf />}
      />
    </div>
  )
}

// ── Sous-composant carte ──────────────────────────────────────────────────────

interface KpiCardProps {
  label: string
  value: string
  sublabel: string
  icon: React.ReactNode
  deltaPositive?: boolean
  inverted?: boolean
}

function KpiCard({ label, value, sublabel, icon, deltaPositive, inverted }: KpiCardProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {label}
        </p>
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50 text-green-600 dark:bg-green-950/60 dark:text-green-400"
        >
          {icon}
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
        {value}
      </p>
      <p
        className={
          deltaPositive !== undefined
            ? deltaPositive
              ? inverted
                ? 'mt-1 text-xs font-medium text-red-600 dark:text-red-400'
                : 'mt-1 text-xs font-medium text-green-600 dark:text-green-400'
              : 'mt-1 text-xs text-gray-500 dark:text-gray-400'
            : 'mt-1 text-xs text-gray-500 dark:text-gray-400'
        }
      >
        {sublabel}
      </p>
    </div>
  )
}

// ── Fallback erreur (try/catch interne KpiCards) ──────────────────────────────

function KpiCardsError({ reason }: { reason: string }) {
  return (
    <div
      role="alert"
      className="grid grid-cols-1 gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/30 sm:grid-cols-2"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
          KPI indisponibles
        </p>
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
          Le calcul des indicateurs a échoué côté serveur. Le pipeline reste utilisable.
        </p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
          Diagnostic
        </p>
        <p className="mt-1 break-words font-mono text-xs text-amber-700 dark:text-amber-400">
          {reason}
        </p>
      </div>
    </div>
  )
}

// ── Skeleton (Suspense fallback) ──────────────────────────────────────────────

export function KpiCardsSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      aria-busy="true"
      aria-label="Chargement des KPI"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-[104px] animate-pulse rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/50"
        />
      ))}
    </div>
  )
}

// ── Icônes SVG inline ─────────────────────────────────────────────────────────

function IconBriefcase() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  )
}

function IconTarget() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  )
}

function IconPhone() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.5 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 5.27 5.27l1.17-1.17a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.28 15l.64 1.92z" />
    </svg>
  )
}

function IconCalendar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function IconClock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function IconLeaf() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96c.66 5.95.7 9.97-3.1 13.78A7 7 0 0 1 11 20z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6" />
    </svg>
  )
}
