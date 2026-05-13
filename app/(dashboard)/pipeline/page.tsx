import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { PipelineClient } from '@/components/pipeline/pipeline-client'
import { PeriodToggle, parseRange } from '@/components/pipeline/period-toggle'
import type { Prospect, ProspectStatus } from '@/lib/types'

// Force le rendu dynamique — KPI + Kanban dépendent des données + searchParams.
export const dynamic = 'force-dynamic'

interface PipelinePageProps {
  searchParams: Promise<{ range?: string; archive?: string }>
}

// Colonnes Kanban dans l'ordre logique du pipeline
const PIPELINE_COLUMNS: { status: ProspectStatus; label: string; color: string }[] = [
  { status: 'sourced', label: 'Sourcé', color: 'gray' },
  { status: 'qualified', label: 'Qualifié', color: 'blue' },
  { status: 'contacted', label: 'Contacté', color: 'yellow' },
  { status: 'rdv', label: 'RDV', color: 'purple' },
  { status: 'converted', label: 'Converti', color: 'green' },
]

// Statuts visibles par défaut. `interested` est visuellement fusionné dans `qualified`
// (cf. PipelineClient + badge "intéressé"). `rejected`/`on_hold` ne sont visibles que
// si l'utilisateur active l'archive toggle — la requête SSR les charge quand même
// pour permettre le toggle côté client sans round-trip.
const KANBAN_STATUSES: ProspectStatus[] = [
  'sourced',
  'qualified',
  'interested',
  'contacted',
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

  const prospectsByStatus: Record<ProspectStatus, Prospect[]> = {
    sourced: [],
    qualified: [],
    contacted: [],
    interested: [],
    rdv: [],
    converted: [],
    rejected: [],
    on_hold: [],
  }

  for (const prospect of (prospects ?? []) as unknown as Prospect[]) {
    const status = prospect.statut
    if (prospectsByStatus[status]) {
      prospectsByStatus[status].push(prospect)
    }
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

      {/* Kanban */}
      <PipelineClient
        columns={PIPELINE_COLUMNS}
        prospectsByStatus={prospectsByStatus}
      />
    </div>
  )
}
