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
  { status: 'sourced', label: 'Nouveau', color: 'gray' },
  { status: 'qualified', label: 'Qualifié', color: 'blue' },
  { status: 'contacted', label: 'Contacté', color: 'yellow' },
  { status: 'interested', label: 'Intéressé', color: 'green' },
  { status: 'offer_sent', label: 'Offre envoyée', color: 'indigo' },
  { status: 'converted', label: 'Affaire conclue', color: 'emerald' },
  { status: 'rejected', label: 'Sans suite', color: 'red' },
  { status: 'on_hold', label: 'En stand-by', color: 'orange' },
  // Migration 017 : opt-out manuel utilisateur. Couleur slate (neutre) pour la
  // distinguer du rouge 'rejected' (refus actif). Ces prospects sont exclus
  // des phases d'enrichissement de contact côté orchestrateur.
  { status: 'do_not_contact', label: 'Ne pas contacter', color: 'slate' },
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
  'do_not_contact',
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
  // Migration 017 : opt-out manuel utilisateur.
  'do_not_contact',
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

// Kanban : limite UX du nombre de cards rendues simultanément.
// Au-delà, la page deviendrait ingérable au navigateur.
const KANBAN_DISPLAY_LIMIT = 2000

async function fetchPipelineData(): Promise<PipelineData> {
  const supabase = await createClient()

  // RLS filtre implicitement sur user_id — pas de .eq('user_id', ...) ici.
  //
  // Stratégie :
  //   1. Counts par statut → `count: 'exact', head: true` (zéro row chargée,
  //      juste un header Content-Range). Contourne la limite serveur PostgREST
  //      `max-rows` (par défaut 1000 sur Supabase) qui bridait les selects.
  //   2. Prospects pour Kanban → range(0, 1999) ordonné par score. Le Kanban
  //      n'a pas besoin des 50k prospects, juste des 2000 meilleurs scores.
  //
  // 9 counts head exact + 1 fetch prospects = 10 round-trips en parallèle.

  // Sprint 3 retour client #13 — Exclure les prospects archivés du pipeline
  // (Kanban + funnel) pour rester cohérent avec la liste /prospects. Les archivés
  // restent comptabilisés dans /archives et accessibles via la fiche.
  const countPromises = ALL_STATUSES.map((statut) =>
    supabase
      .from('prospects')
      .select('id', { count: 'exact', head: true })
      .eq('statut', statut)
      .is('archived_at', null)
      .then((res) => ({ statut, count: res.count ?? 0, error: res.error })),
  )

  const [prospectsRes, ...countResults] = await Promise.all([
    supabase
      .from('prospects')
      .select('*')
      .in('statut', KANBAN_STATUSES)
      .is('archived_at', null)
      .order('score_priorite', { ascending: false })
      .range(0, KANBAN_DISPLAY_LIMIT - 1),
    ...countPromises,
  ])

  const { data: prospects, error } = prospectsRes
  const firstCountErr = countResults.find((r) => r.error)?.error

  if (firstCountErr || error) {
    const err = error ?? firstCountErr
    console.error('[/pipeline] prospects fetch error', {
      code: err?.code,
      message: err?.message,
      details: err?.details,
    })
    throw new Error(`Pipeline DB fetch failed: ${err?.message ?? 'unknown'}`)
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

  // Counts depuis les head exact — source de vérité du funnel, exact à tout
  // moment quelle que soit la volumétrie utilisateur.
  const countsByStatus = emptyCountsByStatus()
  for (const { statut, count } of countResults) {
    countsByStatus[statut] = count
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
      <header className="sticky top-0 z-20 -mx-4 flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.08] bg-white/[0.03] px-4 py-4 backdrop-blur-md supports-[backdrop-filter]:bg-white/[0.04] sm:-mx-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Pipeline
          </h1>
          <p className="mt-1 text-sm text-gray-400">
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
      <header className="sticky top-0 z-20 -mx-4 flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.08] bg-white/[0.03] px-4 py-4 backdrop-blur-md supports-[backdrop-filter]:bg-white/[0.04] sm:-mx-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Pipeline
          </h1>
          <p className="mt-1 text-sm text-gray-400">
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
