// ============================================================
// /alpha — Page dédiée à l'agent Alpha
//
// Contenu :
//   - GlanAvatar grande taille + état courant
//   - GlanTimeline du run le plus récent
//   - GlanLogStream complet (avec scroll)
//   - Historique des derniers runs (cartes)
//   - Bouton "Lancer un run maintenant" (réutilise /api/agent/run)
// ============================================================

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { GlanCharacterLoader } from '@/components/glan/glan-character-loader'
import { GlanTimeline } from '@/components/glan/glan-timeline'
import { GlanLogStream } from '@/components/glan/glan-log-stream'
import { GlassCard } from '@/components/ui/glass-card'
import { EmptyState } from '@/components/ui/empty-state'
import type { AgentRun } from '@/lib/types'

export const metadata = {
  title: 'Glan — Activité',
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const min = Math.floor(ms / 60_000)
  const sec = Math.floor((ms % 60_000) / 1000)
  return `${min}m ${sec}s`
}

const STATUS_TONE: Record<string, string> = {
  running: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  completed: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400',
  failed: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
}

const STATUS_LABEL: Record<string, string> = {
  running: 'En cours',
  completed: 'Terminé',
  failed: 'Échoué',
}

export default async function GlanPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: rawRuns } = await supabase
    .from('agent_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(10)

  const runs = ((rawRuns ?? []) as unknown) as AgentRun[]
  const lastRun = runs[0] ?? null

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* En-tête */}
      <header className="flex flex-col items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md p-8 text-center shadow-sm sm:flex-row sm:text-left">
        <GlanCharacterLoader
          state={
            lastRun?.status === 'running'
              ? 'working'
              : lastRun?.status === 'failed'
                ? 'error'
                : lastRun?.status === 'completed'
                  ? 'done'
                  : 'dormant'
          }
          size={320}
          fallbackSize="lg"
          className="flex-shrink-0"
        />
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            Glan
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Votre agent de prospection. Chaque nuit à 22h, je scanne Sirene et
            ADEME pour identifier les entreprises soumises à l&apos;obligation
            BEGES et les ajouter à votre liste.
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-400">
            — Glan
          </p>
        </div>
      </header>

      {/* Run le plus récent */}
      {lastRun ? (
        <GlassCard variant="elevated" className="space-y-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-400">
                Dernier run
              </p>
              <h2 className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
                {formatDateTime(lastRun.started_at)}
              </h2>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[lastRun.status] ?? STATUS_TONE.completed}`}
            >
              {STATUS_LABEL[lastRun.status] ?? lastRun.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Sourcés" value={lastRun.prospects_sourced ?? 0} />
            <Stat label="Qualifiés" value={lastRun.prospects_qualified ?? 0} />
            <Stat
              label="Durée"
              value={formatDuration(
                lastRun.completed_at
                  ? new Date(lastRun.completed_at).getTime() -
                      new Date(lastRun.started_at).getTime()
                  : null,
              )}
            />
            <Stat
              label="Liste"
              value={lastRun.list_generated ? 'Générée' : '—'}
            />
          </div>

          {/* Timeline + Logs côte à côte */}
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-400">
                Phases
              </p>
              <GlanTimeline run={lastRun} />
            </div>
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-400">
                Logs
              </p>
              <GlanLogStream
                logs={Array.isArray(lastRun.logs) ? lastRun.logs : []}
                maxHeight="22rem"
              />
            </div>
          </div>
        </GlassCard>
      ) : (
        <GlassCard>
          <EmptyState
            variant="agent-idle"
            title="Aucun run pour l'instant"
            description="Je n'ai pas encore travaillé. Le premier run aura lieu à la prochaine échéance nocturne (22h)."
          />
        </GlassCard>
      )}

      {/* Historique des runs précédents */}
      {runs.length > 1 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-400">
            Historique récent
          </h2>
          <ol className="space-y-2">
            {runs.slice(1).map((run) => {
              const duration = run.completed_at
                ? new Date(run.completed_at).getTime() -
                  new Date(run.started_at).getTime()
                : null
              return (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md px-4 py-3"
                >
                  <div className="flex items-baseline gap-3">
                    <p className="font-mono text-sm tabular-nums text-gray-900 dark:text-white">
                      {formatDateTime(run.started_at)}
                    </p>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[run.status] ?? STATUS_TONE.completed}`}
                    >
                      {STATUS_LABEL[run.status] ?? run.status}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-4 text-xs text-gray-500 dark:text-gray-400">
                    <span>
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {run.prospects_sourced ?? 0}
                      </span>{' '}
                      sourcés
                    </span>
                    <span>
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {run.prospects_qualified ?? 0}
                      </span>{' '}
                      qualifiés
                    </span>
                    <span className="font-mono">{formatDuration(duration)}</span>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  )
}
