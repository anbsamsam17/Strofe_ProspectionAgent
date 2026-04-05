import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Prospect, ProspectStatus } from '@/lib/types'
import { PipelineClient } from '@/components/pipeline/pipeline-client'

// Colonnes Kanban dans l'ordre logique du pipeline
const PIPELINE_COLUMNS: { status: ProspectStatus; label: string; color: string }[] = [
  { status: 'sourced', label: 'Sourcé', color: 'gray' },
  { status: 'qualified', label: 'Qualifié', color: 'blue' },
  { status: 'contacted', label: 'Contacté', color: 'yellow' },
  { status: 'rdv', label: 'RDV', color: 'purple' },
  { status: 'converted', label: 'Converti', color: 'green' },
]

export default async function PipelinePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Récupère tous les prospects présents dans les colonnes pipeline
  const { data: prospects } = await supabase
    .from('prospects')
    .select('*')
    .eq('user_id', user.id)
    .in('statut', PIPELINE_COLUMNS.map((c) => c.status))
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
    const status = prospect.statut as ProspectStatus
    if (prospectsByStatus[status]) {
      prospectsByStatus[status].push(prospect)
    }
  }

  const totalCount = (prospects ?? []).length

  return (
    <div className="space-y-5">
      {/* En-tête */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            Pipeline CRM
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-gray-700 dark:text-gray-300">{totalCount}</span>{' '}
            prospect{totalCount > 1 ? 's' : ''} dans le pipeline
          </p>
        </div>

        {/* Légende rapide */}
        <div className="hidden items-center gap-3 sm:flex">
          {PIPELINE_COLUMNS.map((col) => {
            const count = prospectsByStatus[col.status].length
            return (
              <div key={col.status} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <span
                  className={`h-2 w-2 rounded-full ${
                    col.color === 'gray'
                      ? 'bg-gray-400'
                      : col.color === 'blue'
                        ? 'bg-blue-500'
                        : col.color === 'yellow'
                          ? 'bg-yellow-500'
                          : col.color === 'purple'
                            ? 'bg-purple-500'
                            : 'bg-green-500'
                  }`}
                  aria-hidden="true"
                />
                <span className="font-medium">{count}</span>
                <span>{col.label}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Kanban */}
      <PipelineClient
        columns={PIPELINE_COLUMNS}
        prospectsByStatus={prospectsByStatus}
      />
    </div>
  )
}
