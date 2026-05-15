import { createClient } from '@/lib/supabase/server'
import type { PipelineRange } from '@/lib/pipeline/range'
import { rangeStartISO } from '@/lib/pipeline/range'
import { BentoCell } from '@/components/ui/bento-grid'
import { AnimatedCounter } from '@/components/ui/animated-counter'

// ── Types ─────────────────────────────────────────────────────────────────────

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

const QUALIFIED_PLUS = ['qualified', 'contacted', 'interested', 'rdv', 'converted'] as const
const RDV_PLUS = ['rdv', 'converted'] as const

const MS_PER_SECOND = 1000

// Limite locale au calcul de la durée moyenne — on garde les N derniers runs
// complétés. `.limit(N)` est respecté quel que soit max-rows serveur.
const AVG_RUN_LIMIT = 30

// ── Helpers count exact ───────────────────────────────────────────────────────

/**
 * Lance une query `select('id', { count: 'exact', head: true })` et renvoie
 * uniquement le count, sans charger les rows. Contourne la limite PostgREST
 * `max-rows` (par défaut 1000) qui bride les selects classiques.
 */
type CountQueryFn = () => PromiseLike<{ count: number | null; error: { message: string } | null }>

async function getCount(q: CountQueryFn): Promise<{ value: number; error: string | null }> {
  const { count, error } = await q()
  if (error) return { value: 0, error: error.message }
  return { value: count ?? 0, error: null }
}

// ── Calculs purs (depuis counts pré-agrégés) ──────────────────────────────────

interface KpiCounts {
  totalCount: number
  activeCount: number
  activeDelta: number
  qualifiedPlusCount: number
  rdvCountInWindow: number
  begesPublishedCount: number
  appelsInWindow: number
  appelsWithResultInWindow: number
}

export function computeKpisFromCounts(
  c: KpiCounts,
  runs: AgentRunRow[],
  windowStartISO: string | null,
): Kpis {
  const inWindow = (iso: string): boolean =>
    windowStartISO === null ? true : iso >= windowStartISO

  const qualifiedRate =
    c.totalCount === 0 ? 0 : Math.round((c.qualifiedPlusCount / c.totalCount) * 100)

  const contactSuccessRate =
    c.appelsInWindow === 0
      ? 0
      : Math.round((c.appelsWithResultInWindow / c.appelsInWindow) * 100)

  // Durée moyenne run (runs completed dans la fenêtre)
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

  const begesCoverage =
    c.totalCount === 0 ? 0 : Math.round((c.begesPublishedCount / c.totalCount) * 100)

  return {
    activeCount: c.activeCount,
    activeDelta: c.activeDelta,
    qualifiedRate,
    contactSuccessRate,
    rdvCount: c.rdvCountInWindow,
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
  let kpis: Kpis
  try {
    const supabase = await createClient()
    const windowStart = rangeStartISO(range)

    // RLS implicite (auth.uid()) — pas de filtre user_id manuel.
    //
    // On utilise EXCLUSIVEMENT des `count: 'exact', head: true` pour les
    // agrégats : le payload est juste un header Content-Range, sans aucune
    // contrainte par max-rows. Les comptes restent exacts même au-delà de
    // 50k prospects.
    //
    // 8 counts en parallèle + 1 fetch runs limité à 30 derniers.

    const [
      totalRes,
      activeRes,
      activeDeltaRes,
      qualifiedPlusRes,
      rdvInWindowRes,
      begesPublishedRes,
      appelsInWindowRes,
      appelsWithResultRes,
      { data: runsRaw, error: rErr },
    ] = await Promise.all([
      getCount(() =>
        supabase
          .from('prospects')
          .select('id', { count: 'exact', head: true }),
      ),
      getCount(() =>
        supabase
          .from('prospects')
          .select('id', { count: 'exact', head: true })
          .is('archived_at', null),
      ),
      windowStart === null
        ? Promise.resolve({ value: 0, error: null })
        : getCount(() =>
            supabase
              .from('prospects')
              .select('id', { count: 'exact', head: true })
              .is('archived_at', null)
              .gte('created_at', windowStart),
          ),
      getCount(() =>
        supabase
          .from('prospects')
          .select('id', { count: 'exact', head: true })
          .in('statut', QUALIFIED_PLUS as unknown as string[]),
      ),
      windowStart === null
        ? getCount(() =>
            supabase
              .from('prospects')
              .select('id', { count: 'exact', head: true })
              .in('statut', RDV_PLUS as unknown as string[]),
          )
        : getCount(() =>
            supabase
              .from('prospects')
              .select('id', { count: 'exact', head: true })
              .in('statut', RDV_PLUS as unknown as string[])
              .gte('created_at', windowStart),
          ),
      getCount(() =>
        supabase
          .from('prospects')
          .select('id', { count: 'exact', head: true })
          .eq('beges_publie', true),
      ),
      windowStart === null
        ? getCount(() =>
            supabase
              .from('prospect_exchanges')
              .select('id', { count: 'exact', head: true })
              .eq('type', 'appel'),
          )
        : getCount(() =>
            supabase
              .from('prospect_exchanges')
              .select('id', { count: 'exact', head: true })
              .eq('type', 'appel')
              .gte('occurred_at', windowStart),
          ),
      windowStart === null
        ? getCount(() =>
            supabase
              .from('prospect_exchanges')
              .select('id', { count: 'exact', head: true })
              .eq('type', 'appel')
              .not('result', 'is', null),
          )
        : getCount(() =>
            supabase
              .from('prospect_exchanges')
              .select('id', { count: 'exact', head: true })
              .eq('type', 'appel')
              .not('result', 'is', null)
              .gte('occurred_at', windowStart),
          ),
      supabase
        .from('agent_runs')
        .select('status, started_at, completed_at')
        .order('started_at', { ascending: false })
        .limit(AVG_RUN_LIMIT),
    ])

    const firstErr =
      totalRes.error ??
      activeRes.error ??
      activeDeltaRes.error ??
      qualifiedPlusRes.error ??
      rdvInWindowRes.error ??
      begesPublishedRes.error ??
      appelsInWindowRes.error ??
      appelsWithResultRes.error ??
      rErr?.message ??
      null

    if (firstErr) {
      console.error('[KpiCards] Supabase query error', { error: firstErr })
      return <KpiCardsError reason={firstErr} />
    }

    const counts: KpiCounts = {
      totalCount: totalRes.value,
      activeCount: activeRes.value,
      activeDelta: activeDeltaRes.value,
      qualifiedPlusCount: qualifiedPlusRes.value,
      rdvCountInWindow: rdvInWindowRes.value,
      begesPublishedCount: begesPublishedRes.value,
      appelsInWindow: appelsInWindowRes.value,
      appelsWithResultInWindow: appelsWithResultRes.value,
    }

    const runs = (runsRaw ?? []) as unknown as AgentRunRow[]
    kpis = computeKpisFromCounts(counts, runs, windowStart)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[KpiCards] Render error', { message: msg, stack: err instanceof Error ? err.stack : undefined })
    return <KpiCardsError reason={msg} />
  }

  // Accents tournants : brand · cyan · violet · amber · brand · cyan
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <KpiCard
        index={1}
        accent="brand"
        label="Prospects actifs"
        value={kpis.activeCount.toLocaleString('fr-FR')}
        numericValue={kpis.activeCount}
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
        index={2}
        accent="cyan"
        label="Taux qualification"
        value={`${kpis.qualifiedRate}%`}
        numericValue={kpis.qualifiedRate}
        numericSuffix="%"
        sublabel="Statut qualified ou plus"
        icon={<IconTarget />}
      />
      <KpiCard
        index={3}
        accent="violet"
        label="Taux contact réussi"
        value={`${kpis.contactSuccessRate}%`}
        numericValue={kpis.contactSuccessRate}
        numericSuffix="%"
        sublabel="Résultat saisi / appels passés"
        icon={<IconPhone />}
      />
      <KpiCard
        index={4}
        accent="amber"
        label="RDV pris"
        value={kpis.rdvCount.toLocaleString('fr-FR')}
        numericValue={kpis.rdvCount}
        sublabel="Statut rdv ou converted"
        icon={<IconCalendar />}
      />
      <KpiCard
        index={5}
        accent="brand"
        label="Durée run moyenne"
        value={formatDuration(kpis.avgRunMs)}
        sublabel="Plus court = mieux"
        icon={<IconClock />}
      />
      <KpiCard
        index={6}
        accent="cyan"
        label="BEGES coverage"
        value={`${kpis.begesCoverage}%`}
        numericValue={kpis.begesCoverage}
        numericSuffix="%"
        sublabel="Prospects avec bilan publié"
        icon={<IconLeaf />}
      />
    </div>
  )
}

// ── KpiCard atom ──────────────────────────────────────────────────────────────

type KpiAccent = 'brand' | 'cyan' | 'violet' | 'amber'

interface KpiCardProps {
  index: number
  accent: KpiAccent
  label: string
  value: string
  numericValue?: number
  numericSuffix?: string
  sublabel: string
  deltaPositive?: boolean
  icon: React.ReactNode
}

function KpiCard({
  index,
  accent,
  label,
  value,
  numericValue,
  numericSuffix,
  sublabel,
  deltaPositive,
  icon,
}: KpiCardProps) {
  const displayValue =
    numericValue !== undefined ? (
      <>
        <AnimatedCounter key={numericValue} value={numericValue} />
        {numericSuffix}
      </>
    ) : (
      value
    )

  return (
    <BentoCell accent={accent}>
      <div
        className="opacity-0 animate-fade-in-up"
        style={{ animationDelay: `${index * 0.08}s`, animationFillMode: 'forwards' }}
      >
        <header className="mb-3 flex items-start justify-between gap-3">
          <p className="min-w-0 flex-1 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
            [{index.toString().padStart(2, '0')}] {label}
          </p>
          <span className="flex-shrink-0" aria-hidden="true">{icon}</span>
        </header>
        <p
          className={`text-4xl font-bold tabular-nums tracking-tight text-white ${
            deltaPositive ? 'drop-shadow-[0_0_18px_oklch(70%_0.19_152_/_0.45)]' : ''
          }`}
        >
          {displayValue}
        </p>
        <p className="mt-2 text-xs text-gray-400">{sublabel}</p>
      </div>
    </BentoCell>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

export function KpiCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 backdrop-blur-md"
        >
          <div className="mb-3 h-3 w-24 animate-shimmer rounded bg-gradient-to-r from-white/[0.04] via-white/[0.1] to-white/[0.04] bg-[length:200%_100%]" />
          <div className="h-10 w-32 animate-shimmer rounded bg-gradient-to-r from-white/[0.04] via-white/[0.1] to-white/[0.04] bg-[length:200%_100%]" />
          <div className="mt-3 h-3 w-40 animate-shimmer rounded bg-gradient-to-r from-white/[0.04] via-white/[0.1] to-white/[0.04] bg-[length:200%_100%]" />
        </div>
      ))}
    </div>
  )
}

// ── Fallback error ────────────────────────────────────────────────────────────

function KpiCardsError({ reason }: { reason: string }) {
  return (
    <section
      role="alert"
      className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 backdrop-blur-md"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-300">
        KPI — indisponibles
      </h2>
      <p className="mt-2 text-sm text-amber-200/90">
        Les indicateurs n&apos;ont pas pu être calculés. Le reste du pipeline reste utilisable.
      </p>
      <p className="mt-2 break-words font-mono text-xs text-amber-300/80">{reason}</p>
    </section>
  )
}

// ── Icônes inline ─────────────────────────────────────────────────────────────

function IconBriefcase() {
  return (
    <span className="rounded-lg bg-green-500/15 p-2 text-green-400 ring-1 ring-green-500/25">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    </span>
  )
}
function IconTarget() {
  return (
    <span className="rounded-lg bg-cyan-500/15 p-2 text-cyan-400 ring-1 ring-cyan-500/25">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    </span>
  )
}
function IconPhone() {
  return (
    <span className="rounded-lg bg-violet-500/15 p-2 text-violet-400 ring-1 ring-violet-500/25">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
      </svg>
    </span>
  )
}
function IconCalendar() {
  return (
    <span className="rounded-lg bg-amber-500/15 p-2 text-amber-400 ring-1 ring-amber-500/25">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    </span>
  )
}
function IconClock() {
  return (
    <span className="rounded-lg bg-green-500/15 p-2 text-green-400 ring-1 ring-green-500/25">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    </span>
  )
}
function IconLeaf() {
  return (
    <span className="rounded-lg bg-cyan-500/15 p-2 text-cyan-400 ring-1 ring-cyan-500/25">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z" />
        <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
      </svg>
    </span>
  )
}
