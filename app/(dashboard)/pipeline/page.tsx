import { Suspense } from 'react'
import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { KpiCards, KpiCardsSkeleton } from '@/components/pipeline/kpi-cards'
import { ConversionFunnel } from '@/components/pipeline/conversion-funnel'
import { AgentStats, AgentStatsSkeleton } from '@/components/pipeline/agent-stats'
import {
  PipelineClient,
  type KanbanStatus,
} from '@/components/pipeline/pipeline-client'
import { PeriodToggle } from '@/components/pipeline/period-toggle'
import { parseRange, type PipelineRange } from '@/lib/pipeline/range'
import type { Prospect, ProspectStatus } from '@/lib/types'

// Force le rendu dynamique — KPI + Kanban dépendent des données + searchParams.
export const dynamic = 'force-dynamic'

interface PipelinePageProps {
  searchParams: Promise<{ range?: string }>
}

// Colonnes Kanban — 8 colonnes alignées sur la spec utilisateur.
// - `offer_sent` est un nouveau statut ajouté par Agent A à `ProspectStatus`.
//   TODO(coord-A): typage natif `ProspectStatus` une fois le merge effectué.
// - `rdv` (legacy) reste en DB mais n'est plus exposé comme colonne distincte ;
//   à terme on pourra requalifier ces prospects en `interested`.
const PIPELINE_COLUMNS: { status: KanbanStatus; label: string; color: string }[] = [
  { status: 'sourced', label: 'Pas de contact identifié', color: 'gray' },
  { status: 'qualified', label: 'Qualifié', color: 'blue' },
  { status: 'contacted', label: 'Contacté', color: 'yellow' },
  { status: 'interested', label: 'Intéressé', color: 'green' },
  { status: 'offer_sent', label: 'Offre envoyée', color: 'indigo' },
  { status: 'converted', label: 'Affaire conclue', color: 'emerald' },
  { status: 'rejected', label: 'Sans suite', color: 'red' },
  { status: 'on_hold', label: 'En stand-by', color: 'orange' },
]

// Statuts chargés côté SSR. On inclut `rdv` pour ne pas perdre les prospects
// legacy (ils sont fetchés mais pas affichés tant qu'une colonne dédiée n'est
// pas créée — ils restent visibles via /prospects).
// `offer_sent` est aussi inclus pour charger les prospects qui ont déjà été
// promus dans cette colonne post-migration 010.
const KANBAN_STATUSES: ProspectStatus[] = [
  'sourced',
  'qualified',
  'contacted',
  'interested',
  'rdv',
  'offer_sent',
  'converted',
  'rejected',
  'on_hold',
]

// Tous les statuts attendus dans `countsByStatus` — alignés sur `ProspectStatus`.
// Source unique de vérité pour initialiser le Record et éviter qu'un statut
// orphelin en DB (ou un nouveau ajouté à l'enum sans MAJ du code) corrompe le
// Record en y injectant une clé sans initialisation à `0`.
const ALL_STATUSES: readonly ProspectStatus[] = [
  'sourced',
  'qualified',
  'contacted',
  'interested',
  'rdv',
  'offer_sent',
  'converted',
  'rejected',
  'on_hold',
] as const

function emptyCountsByStatus(): Record<ProspectStatus, number> {
  return ALL_STATUSES.reduce(
    (acc, s) => {
      acc[s] = 0
      return acc
    },
    {} as Record<ProspectStatus, number>,
  )
}

function emptyProspectsByStatus(): Record<KanbanStatus, Prospect[]> {
  // KanbanStatus == ProspectStatus depuis la migration 010 ; ALL_STATUSES couvre déjà tout.
  return ALL_STATUSES.reduce(
    (acc, s) => {
      acc[s as KanbanStatus] = []
      return acc
    },
    {} as Record<KanbanStatus, Prospect[]>,
  )
}

interface PipelineData {
  prospectsByStatus: Record<KanbanStatus, Prospect[]>
  countsByStatus: Record<ProspectStatus, number>
}

async function fetchPipelineData(): Promise<PipelineData> {
  const supabase = await createClient()

  // RLS filtre implicitement sur user_id — pas de .eq('user_id', ...) ici.
  const { data: prospects, error } = await supabase
    .from('prospects')
    .select('*')
    .in('statut', KANBAN_STATUSES)
    .order('score_priorite', { ascending: false })

  if (error) {
    // Log structuré (pas de PII) puis re-throw pour pouvoir afficher un fallback
    // côté page sans bubble silencieux à l'error boundary.
    console.error('[/pipeline] prospects fetch error', {
      code: error.code,
      message: error.message,
      details: error.details,
    })
    throw new Error(`Pipeline DB fetch failed: ${error.message}`)
  }

  const prospectsByStatus = emptyProspectsByStatus()

  for (const prospect of (prospects ?? []) as unknown as Prospect[]) {
    const status = prospect.statut as KanbanStatus
    // Garde défensive : un statut hors enum (legacy / data corrompue) est ignoré
    // au lieu de cracher (Object indexing TS-safe via hasOwn).
    if (Object.prototype.hasOwnProperty.call(prospectsByStatus, status)) {
      prospectsByStatus[status].push(prospect)
    }
  }

  // Counts par statut pour le funnel — initialisation exhaustive depuis ALL_STATUSES
  // (évite tout undefined si un statut était oublié dans la littérale).
  const countsByStatus = emptyCountsByStatus()
  for (const s of ALL_STATUSES) {
    // Cast safe : KanbanStatus == ProspectStatus.
    countsByStatus[s] = prospectsByStatus[s as KanbanStatus]?.length ?? 0
  }

  return { prospectsByStatus, countsByStatus }
}

export default async function PipelinePage({ searchParams }: PipelinePageProps) {
  const params = await searchParams
  const range = parseRange(params.range)

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Try/catch global pour éviter qu'une erreur de fetch / mapping bubble vers
  // /pipeline/error.tsx (le contrat UX est : la page reste utilisable, on
  // affiche un fallback explicite avec diagnostic).
  let data: PipelineData
  try {
    data = await fetchPipelineData()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/pipeline] data fetch error — render fallback', {
      message: msg,
      stack: err instanceof Error ? err.stack : undefined,
    })
    return <PipelinePageFallback range={range} reason={msg} />
  }

  const { prospectsByStatus, countsByStatus } = data

  return (
    <div className="space-y-6">
      {/* Header sticky */}
      <header className="sticky top-0 z-20 -mx-4 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 bg-white/80 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-gray-800 dark:bg-gray-950/80 dark:supports-[backdrop-filter]:bg-gray-950/60 sm:-mx-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            Pipeline
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Vue d&apos;ensemble du pipeline CRM et de l&apos;activité agent
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodToggle current={range} />
        </div>
      </header>

      {/* Pattern Next.js 15 standard : Suspense pour le pending, try/catch
          interne dans chaque Server Component pour les errors. Pas de wrapper
          custom — les wrappers précédents (ServerErrorBoundary async,
          ClientErrorBoundary avec prop fonction) introduisaient des
          violations RSC (fonctions passées au wire serializer) qui faisaient
          crash le rendu avant même que la défense ne joue. KpiCards et
          AgentStats ont déjà chacun leur fallback interne (KpiCardsError /
          AgentStatsError). Si pipeline-client.tsx (Client Component) throw,
          c'est l'error.tsx du segment qui prend la main — comportement
          standard Next.js. */}
      <Suspense fallback={<KpiCardsSkeleton />}>
        <KpiCards range={range} />
      </Suspense>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SafeConversionFunnel countsByStatus={countsByStatus} />
        <Suspense fallback={<AgentStatsSkeleton />}>
          <AgentStats range={range} />
        </Suspense>
      </div>

      <PipelineClient
        columns={PIPELINE_COLUMNS}
        prospectsByStatus={prospectsByStatus}
      />
    </div>
  )
}

// ── Defensive wrappers ─────────────────────────────────────────────────────────

/**
 * Wrapper try/catch synchrone autour de <ConversionFunnel> — `buildFunnel` est
 * une fonction pure mais on se protège d'un éventuel throw au render SVG
 * (computeFunnelGeometry sur counts non finis, etc.).
 */
function SafeConversionFunnel({
  countsByStatus,
}: {
  countsByStatus: Record<ProspectStatus, number>
}) {
  try {
    return <ConversionFunnel countsByStatus={countsByStatus} />
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/pipeline] ConversionFunnel render error', {
      message: msg,
      stack: err instanceof Error ? err.stack : undefined,
    })
    return (
      <section
        role="alert"
        className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/40 dark:bg-amber-950/30"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
          Entonnoir de conversion — indisponible
        </h2>
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
          Le graphique n&apos;a pas pu être généré. Le reste du pipeline reste
          utilisable.
        </p>
        <p className="mt-2 break-words font-mono text-xs text-amber-700 dark:text-amber-400">
          {msg}
        </p>
      </section>
    )
  }
}

/**
 * Fallback complet de la page si le fetch DB des prospects échoue. On garde le
 * header + PeriodToggle pour ne pas casser la navigation, et on encadre le
 * diagnostic dans un panel d'erreur. Le KpiCards/AgentStats sous Suspense
 * gardent leur propre try/catch interne et restent fonctionnels.
 */
function PipelinePageFallback({
  range,
  reason,
}: {
  range: PipelineRange
  reason: string
}) {
  return (
    <div className="space-y-6">
      <header className="sticky top-0 z-20 -mx-4 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 bg-white/80 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-gray-800 dark:bg-gray-950/80 dark:supports-[backdrop-filter]:bg-gray-950/60 sm:-mx-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            Pipeline
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Vue d&apos;ensemble du pipeline CRM et de l&apos;activité agent
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodToggle current={range} />
        </div>
      </header>

      <section
        role="alert"
        className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/40 dark:bg-amber-950/30"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
          Pipeline — chargement partiel
        </h2>
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
          La liste des prospects n&apos;a pas pu être chargée. Les KPI et stats
          agent ci-dessous restent disponibles si la requête associée a réussi.
        </p>
        <p className="mt-2 break-words font-mono text-xs text-amber-700 dark:text-amber-400">
          {reason}
        </p>
      </section>

      <Suspense fallback={<KpiCardsSkeleton />}>
        <KpiCards range={range} />
      </Suspense>

      <Suspense fallback={<AgentStatsSkeleton />}>
        <AgentStats range={range} />
      </Suspense>
    </div>
  )
}
