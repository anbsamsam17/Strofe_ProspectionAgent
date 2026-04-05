import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { AgentRun, DailyList, DailyListItem, Prospect } from '@/lib/types'
import { GenerateListButton } from '@/components/dashboard/generate-list-button'

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(isoString: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(isoString))
}

function formatDate(isoString: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(
    new Date(isoString)
  )
}

// ── Sous-composants ──────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  max,
  color,
}: {
  label: string
  value: number
  max?: number
  color: 'green' | 'blue' | 'yellow' | 'purple'
}) {
  const colorMap = {
    green: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-900',
    blue: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-900',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-400 dark:border-yellow-900',
    purple: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-400 dark:border-purple-900',
  }

  return (
    <div className={`rounded-xl border p-5 ${colorMap[color]}`}>
      <p className="text-3xl font-bold tabular-nums">
        {value}
        {max !== undefined && (
          <span className="text-base font-normal opacity-60">/{max}</span>
        )}
      </p>
      <p className="mt-1 text-sm font-medium opacity-80">{label}</p>
    </div>
  )
}

function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    haute: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
    normale: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400',
    basse: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  }
  const label: Record<string, string> = {
    haute: 'Haute',
    normale: 'Normale',
    basse: 'Basse',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[priority] ?? map.normale}`}>
      {label[priority] ?? priority}
    </span>
  )
}

// ── Page principale ──────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const today = new Date().toISOString().split('T')[0]

  // Récupération parallèle de toutes les données
  // Colonnes explicites : on évite le SELECT * qui rapatrie pitch (TEXT long),
  // score_details, signaux (JSONB lourds) inutiles pour cette vue.
  const [agentRunResult, dailyListResult] = await Promise.all([
    supabase
      .from('agent_runs')
      .select('id, user_id, status, phase, prospects_sourced, prospects_qualified, list_generated, error_message, started_at, completed_at')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('daily_lists')
      .select(`
        id, user_id, date, status, generated_at, created_at,
        items:daily_list_items(
          id, ordre, priorite, called_at, call_result,
          prospect:prospects(id, raison_sociale, secteur_libelle, ville, statut)
        )
      `)
      .eq('user_id', user.id)
      .eq('date', today)
      .order('ordre', { referencedTable: 'daily_list_items', ascending: true })
      .maybeSingle(),
  ])

  const agentRun = agentRunResult.data as AgentRun | null
  const dailyList = dailyListResult.data as (DailyList & { items: (DailyListItem & { prospect: Prospect })[] }) | null

  // Calcul métriques
  const items = dailyList?.items ?? []
  const totalPrepared = items.length
  const totalCalled = items.filter((i) => i.called_at).length
  const totalInterested = items.filter(
    (i) => i.call_result === 'interested'
  ).length
  const totalRdv = items.filter((i) => i.call_result === 'interested' && i.prospect?.statut === 'rdv').length

  // 3 prochains appels non effectués
  const nextCalls = items
    .filter((i) => !i.called_at)
    .sort((a, b) => a.ordre - b.ordre)
    .slice(0, 3)

  const dailyTarget = 15

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Tableau de bord
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {formatDate(new Date().toISOString())}
        </p>
      </div>

      {/* Métriques du jour */}
      <section aria-labelledby="metrics-title">
        <h2 id="metrics-title" className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Métriques du jour
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard
            label="Appels préparés"
            value={totalPrepared}
            max={dailyTarget}
            color="blue"
          />
          <MetricCard
            label="Appelés"
            value={totalCalled}
            max={totalPrepared}
            color="yellow"
          />
          <MetricCard
            label="Intéressés"
            value={totalInterested}
            color="green"
          />
          <MetricCard
            label="RDV pris"
            value={totalRdv}
            color="purple"
          />
        </div>
      </section>

      {/* Statut dernier run agent */}
      <section
        aria-labelledby="agent-status-title"
        className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900"
      >
        <h2 id="agent-status-title" className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Dernier run de l&apos;agent
        </h2>

        {agentRun ? (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-medium">Lancé le :</span>{' '}
                {formatDateTime(agentRun.started_at)}
              </p>
              {agentRun.completed_at && (
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium">Terminé le :</span>{' '}
                  {formatDateTime(agentRun.completed_at)}
                </p>
              )}
              <p className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-medium">Sourcés :</span>{' '}
                {agentRun.prospects_sourced} |{' '}
                <span className="font-medium">Qualifiés :</span>{' '}
                {agentRun.prospects_qualified}
              </p>
              {agentRun.error_message && (
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400" role="alert">
                  Erreur : {agentRun.error_message}
                </p>
              )}
            </div>

            {/* Statut */}
            <div>
              {agentRun.status === 'completed' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
                  Terminé
                </span>
              )}
              {agentRun.status === 'running' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" aria-hidden="true" />
                  En cours
                </span>
              )}
              {agentRun.status === 'failed' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden="true" />
                  Échoué
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Aucun run effectué. Lancez l&apos;agent depuis le bouton en haut à droite.
          </p>
        )}
      </section>

      {/* Bouton générer / régénérer liste */}
      <section
        aria-labelledby="generate-title"
        className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 id="generate-title" className="font-semibold text-gray-900 dark:text-white">
              Liste de demain
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Déclenchez manuellement la génération de votre liste d&apos;appels pour demain.
            </p>
          </div>
          <GenerateListButton hasExistingList={dailyList !== null} />
        </div>
      </section>

      {/* 3 prochains appels */}
      {nextCalls.length > 0 && (
        <section aria-labelledby="next-calls-title">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="next-calls-title" className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Prochains appels
            </h2>
            <Link
              href="/daily-list"
              className="text-sm font-medium text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
            >
              Voir tous les appels →
            </Link>
          </div>

          <div className="space-y-3">
            {nextCalls.map((item) => (
              <Link
                key={item.id}
                href="/daily-list"
                className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-green-300 hover:bg-green-50/50 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-green-800 dark:hover:bg-green-950/20"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-400 dark:text-gray-500">
                      #{item.ordre}
                    </span>
                    <PriorityBadge priority={item.priorite} />
                  </div>
                  <p className="mt-1 truncate font-semibold text-gray-900 dark:text-white">
                    {item.prospect?.raison_sociale ?? 'Entreprise inconnue'}
                  </p>
                  <p className="truncate text-sm text-gray-500 dark:text-gray-400">
                    {item.prospect?.secteur_libelle ?? '—'}
                    {item.prospect?.ville ? ` · ${item.prospect.ville}` : ''}
                  </p>
                </div>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="ml-3 flex-shrink-0 text-gray-400"
                  aria-hidden="true"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Aucun appel pour aujourd'hui */}
      {dailyList === null && (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Aucune liste générée pour aujourd&apos;hui.
            <br />
            Lancez l&apos;agent pour préparer vos 15 appels du jour.
          </p>
        </div>
      )}
    </div>
  )
}
