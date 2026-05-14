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
import { PeriodToggle, parseRange } from '@/components/pipeline/period-toggle'
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
const KANBAN_STATUSES: ProspectStatus[] = [
  'sourced',
  'qualified',
  'contacted',
  'interested',
  'rdv',
  'converted',
  'rejected',
  'on_hold',
]

export default async function PipelinePage({ searchParams }: PipelinePageProps) {
  const params = await searchParams
  const range = parseRange(params.range)

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // RLS filtre implicitement sur user_id — pas de .eq('user_id', ...) ici.
  const { data: prospects } = await supabase
    .from('prospects')
    .select('*')
    .in('statut', KANBAN_STATUSES)
    .order('score_priorite', { ascending: false })

  // On clé le Record sur KanbanStatus (qui inclut `offer_sent`). Les prospects
  // en `rdv` (legacy) sont volontairement ignorés du Kanban — accessible via
  // /prospects pour ne pas perdre l'historique commercial.
  const prospectsByStatus: Record<KanbanStatus, Prospect[]> = {
    sourced: [],
    qualified: [],
    contacted: [],
    interested: [],
    offer_sent: [],
    rdv: [],
    converted: [],
    rejected: [],
    on_hold: [],
  }

  for (const prospect of (prospects ?? []) as unknown as Prospect[]) {
    const status = prospect.statut as KanbanStatus
    if (prospectsByStatus[status]) {
      prospectsByStatus[status].push(prospect)
    }
  }

  // Counts par statut pour le funnel — clé sur ProspectStatus (existant).
  // TODO post-merge: étendre funnel + agent-stats pour intégrer `offer_sent`.
  const countsByStatus: Record<ProspectStatus, number> = {
    sourced: prospectsByStatus.sourced.length,
    qualified: prospectsByStatus.qualified.length,
    interested: prospectsByStatus.interested.length,
    contacted: prospectsByStatus.contacted.length,
    rdv: prospectsByStatus.rdv.length,
    offer_sent: prospectsByStatus.offer_sent?.length ?? 0,
    converted: prospectsByStatus.converted.length,
    rejected: prospectsByStatus.rejected.length,
    on_hold: prospectsByStatus.on_hold.length,
  }

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

      {/* KPI cards (Server Component, lazy via Suspense) */}
      <Suspense fallback={<KpiCardsSkeleton />}>
        <KpiCards range={range} />
      </Suspense>

      {/* Analytics — funnel conversion + stats agent côte à côte sur desktop */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ConversionFunnel countsByStatus={countsByStatus} />
        <Suspense fallback={<AgentStatsSkeleton />}>
          <AgentStats range={range} />
        </Suspense>
      </div>

      {/* Kanban */}
      <PipelineClient
        columns={PIPELINE_COLUMNS}
        prospectsByStatus={prospectsByStatus}
      />
    </div>
  )
}
