// ============================================================
// GlanTimeline — replay des phases d'un agent_run
//
// Server Component — prend en entrée un `AgentRun` et reconstruit
// les phases chronologiquement. Sert sur la page /glan pour le replay
// du run de la nuit précédente.
//
// Phases post-pivot (pitch_gen + daily_list retirées de l'orchestrator) :
//   init → sourcing → enrichissement → contacts → scoring → done
//
// Chaque phase affichée avec :
//   - icone d'état (pending/done/skipped)
//   - libellé FR
//   - timestamp de début (si log trouvé)
//   - durée
// ============================================================

import type { AgentLog, AgentRun } from '@/lib/types'

interface GlanTimelineProps {
  run: AgentRun
  className?: string
}

// Phases alignées sur l'orchestrator post-pivot (les phases pitch_gen et
// daily_list ont été retirées du pipeline — code mort à nettoyer en LOT 6).
const PHASES = [
  { key: 'init', label: 'Initialisation' },
  { key: 'sourcing', label: 'Sourcing Sirene' },
  { key: 'enrichissement', label: 'Enrichissement ADEME' },
  { key: 'contacts', label: 'Recherche contacts' },
  { key: 'scoring', label: 'Scoring 3 piliers' },
] as const

type PhaseKey = (typeof PHASES)[number]['key']

interface PhaseDerived {
  key: PhaseKey
  label: string
  state: 'done' | 'pending' | 'skipped' | 'failed'
  startedAt: string | null
  durationMs: number | null
  message?: string
}

function firstLogByPhase(logs: AgentLog[], phase: string): AgentLog | undefined {
  return logs.find((l) => l.phase === phase)
}

function lastLogByPhase(logs: AgentLog[], phase: string): AgentLog | undefined {
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].phase === phase) return logs[i]
  }
  return undefined
}

function derivePhases(run: AgentRun): PhaseDerived[] {
  const logs = Array.isArray(run.logs) ? run.logs : []
  return PHASES.map((p) => {
    const first = firstLogByPhase(logs, p.key)
    const last = lastLogByPhase(logs, p.key)

    if (!first) {
      return {
        key: p.key,
        label: p.label,
        state: run.status === 'failed' ? 'skipped' : 'pending',
        startedAt: null,
        durationMs: null,
      }
    }

    const hasError = logs.some((l) => l.phase === p.key && l.level === 'error')
    const durationMs =
      last && first ? new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime() : null

    return {
      key: p.key,
      label: p.label,
      state: hasError ? 'failed' : 'done',
      startedAt: first.timestamp,
      durationMs,
      message: last?.message,
    }
  })
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return ''
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const min = Math.floor(ms / 60_000)
  const sec = Math.floor((ms % 60_000) / 1000)
  return `${min}m ${sec.toString().padStart(2, '0')}s`
}

function formatTime(iso: string | null): string {
  if (!iso) return '--:--'
  const d = new Date(iso)
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(d)
}

const STATE_DOT: Record<PhaseDerived['state'], string> = {
  done: 'bg-green-500 ring-green-500/30 shadow-[0_0_8px_oklch(70%_0.19_152_/_0.5)]',
  pending: 'bg-white/15 ring-white/[0.06]',
  skipped: 'bg-white/[0.08] ring-white/[0.03]',
  failed: 'bg-red-500 ring-red-500/30 shadow-[0_0_8px_oklch(62%_0.22_27_/_0.5)]',
}

const STATE_LABEL: Record<PhaseDerived['state'], string> = {
  done: 'Terminée',
  pending: 'En attente',
  skipped: 'Non exécutée',
  failed: 'Échec',
}

export function GlanTimeline({ run, className = '' }: GlanTimelineProps) {
  const phases = derivePhases(run)

  return (
    <ol
      className={`relative space-y-4 ${className}`}
      aria-label="Étapes du run de Glan"
    >
      {/* Ligne verticale centrale */}
      <span
        aria-hidden="true"
        className="absolute left-[7px] top-2 bottom-2 w-px bg-white/[0.08]"
      />

      {phases.map((p) => (
        <li key={p.key} className="relative flex gap-3 pl-1">
          {/* Dot */}
          <span
            aria-hidden="true"
            className={`mt-1 inline-block h-3.5 w-3.5 flex-shrink-0 rounded-full ring-4 ${STATE_DOT[p.state]}`}
          />

          <div className="flex-1 pb-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold text-white">
                {p.label}
              </p>
              <span className="font-mono text-[11px] tabular-nums text-gray-400">
                {formatTime(p.startedAt)}
                {p.durationMs !== null && (
                  <span className="ml-1.5">· {formatDuration(p.durationMs)}</span>
                )}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-gray-400">
              <span className="sr-only">État : </span>
              {STATE_LABEL[p.state]}
              {p.message && (
                <span className="ml-1.5 text-gray-400">
                  · {p.message}
                </span>
              )}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}
