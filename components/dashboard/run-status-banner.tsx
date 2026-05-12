'use client'

// ============================================================
// RunStatusBanner
// ------------------------------------------------------------
// Bandeau live affiché en haut du dashboard et de la page /prospects
// tant qu'un run agent est en cours pour l'utilisateur connecté.
//
// - Polling via le hook partagé `useAgentRunStatus` (5s par défaut).
// - Affiche : icône spinner, libellé phase humain, compteurs prospects
//   sourcés/qualifiés, durée écoulée depuis `started_at`.
// - Disparait dès que `run.status !== 'running'` ; un toast inline
//   (terminé / échoué) reste visible quelques secondes via état local.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { useAgentRunStatus } from '@/lib/hooks/use-agent-run-status'
import type { AgentRun } from '@/lib/types'

// Durée d'affichage du toast de fin (succès ou échec)
const COMPLETED_TOAST_DURATION_MS = 6000

/**
 * Mappe la `phase` brute écrite par l'orchestrator vers un libellé FR
 * lisible pour l'utilisateur. `phase` est un string libre (cf. logs JSON
 * dans agent_runs), on matche par contains, sans casser sur un nouveau nom.
 */
function formatPhaseLabel(phase: string | undefined): string {
  if (!phase) return 'Initialisation...'
  const p = phase.toLowerCase()
  if (p.includes('init')) return 'Initialisation...'
  if (p.includes('sourcing') || p.includes('sirene') || p.includes('insee'))
    return 'Sourcing INSEE...'
  if (p.includes('ademe') || p.includes('beges') || p.includes('enrich'))
    return 'Enrichissement ADEME...'
  if (p.includes('contact')) return 'Enrichissement contacts...'
  if (p.includes('scoring') || p.includes('score')) return 'Scoring...'
  if (p.includes('selection') || p.includes('sélection'))
    return 'Sélection des prospects...'
  if (p.includes('pitch') || p.includes('gpt') || p.includes('openai'))
    return 'Génération pitchs GPT-4o...'
  if (p.includes('final') || p.includes('list') || p.includes('insert'))
    return 'Finalisation...'
  return `Phase : ${phase}`
}

/**
 * Calcule la durée écoulée depuis `startedAtIso` jusqu'à `nowMs`,
 * format compact FR ("1min 23s", "47s", "—" si invalide).
 */
function formatElapsed(startedAtIso: string, nowMs: number): string {
  const startedMs = new Date(startedAtIso).getTime()
  if (!Number.isFinite(startedMs)) return '—'
  const deltaSec = Math.max(0, Math.floor((nowMs - startedMs) / 1000))
  if (deltaSec < 60) return `${deltaSec}s`
  const minutes = Math.floor(deltaSec / 60)
  const seconds = deltaSec % 60
  return seconds === 0 ? `${minutes}min` : `${minutes}min ${seconds}s`
}

interface RunStatusBannerProps {
  /** Override le pollInterval pour les tests / cas avancés. */
  pollIntervalMs?: number
}

export function RunStatusBanner({ pollIntervalMs }: RunStatusBannerProps) {
  const { isRunning, run } = useAgentRunStatus(pollIntervalMs)

  // Toast de fin : on garde l'ancien run en mémoire qq secondes après
  // une transition running → completed/failed pour le feedback utilisateur.
  const [completedToast, setCompletedToast] = useState<AgentRun | null>(null)
  const previousIsRunningRef = useRef<boolean>(false)

  useEffect(() => {
    const wasRunning = previousIsRunningRef.current
    previousIsRunningRef.current = isRunning

    if (wasRunning && !isRunning && run) {
      setCompletedToast(run)
      const t = window.setTimeout(() => {
        setCompletedToast(null)
      }, COMPLETED_TOAST_DURATION_MS)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [isRunning, run])

  // Tick d'horloge local pour rafraîchir l'affichage de la durée écoulée
  // toutes les secondes — indépendant du polling API (qui est à 5s).
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  useEffect(() => {
    if (!isRunning) return
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [isRunning])

  // Cas 1 : aucun run en cours et pas de toast → on n'occupe pas de place.
  if (!isRunning && !completedToast) return null

  // Cas 2 : toast de fin
  if (!isRunning && completedToast) {
    const isFailed = completedToast.status === 'failed'
    return (
      <div
        role="status"
        aria-live="polite"
        className={
          isFailed
            ? 'mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800/50 dark:bg-red-950/30'
            : 'mb-4 flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 dark:border-green-800/50 dark:bg-green-950/30'
        }
      >
        <span
          className={
            isFailed
              ? 'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400'
              : 'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-green-100 text-green-600 dark:bg-green-950/60 dark:text-green-400'
          }
          aria-hidden="true"
        >
          {isFailed ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={
              isFailed
                ? 'text-sm font-semibold text-red-800 dark:text-red-300'
                : 'text-sm font-semibold text-green-800 dark:text-green-300'
            }
          >
            {isFailed
              ? 'Le run de l’agent a échoué'
              : 'Run agent terminé'}
          </p>
          <p
            className={
              isFailed
                ? 'mt-0.5 text-xs text-red-700 dark:text-red-400'
                : 'mt-0.5 text-xs text-green-700 dark:text-green-400'
            }
          >
            {isFailed && completedToast.error_message
              ? completedToast.error_message
              : `${completedToast.prospects_sourced} entreprises sourcées, ${completedToast.prospects_qualified} qualifiées.`}
          </p>
        </div>
      </div>
    )
  }

  // Cas 3 : run actif → bandeau live (run garanti non-null car isRunning true)
  if (!run) return null

  const elapsed = formatElapsed(run.started_at, nowMs)
  const phaseLabel = formatPhaseLabel(run.phase)

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="mb-4 flex flex-col gap-3 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 sm:flex-row sm:items-center dark:border-yellow-900/50 dark:bg-yellow-950/30"
    >
      {/* Spinner + libellé */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-yellow-100 text-yellow-700 dark:bg-yellow-950/60 dark:text-yellow-400">
          <svg
            className="animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">
            Recherche en cours
            <span className="ml-2 font-normal text-yellow-700 dark:text-yellow-400">
              {phaseLabel}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-yellow-700 dark:text-yellow-400">
            <span className="tabular-nums">{run.prospects_sourced}</span>{' '}
            entreprise{run.prospects_sourced > 1 ? 's' : ''} sourcée
            {run.prospects_sourced > 1 ? 's' : ''}
            {run.prospects_qualified > 0 && (
              <>
                {' '}
                &middot;{' '}
                <span className="tabular-nums">{run.prospects_qualified}</span>{' '}
                qualifiée{run.prospects_qualified > 1 ? 's' : ''}
              </>
            )}
          </p>
        </div>
      </div>

      {/* Compteur durée */}
      <div className="flex flex-shrink-0 items-center gap-2 self-start rounded-lg bg-yellow-100/60 px-2.5 py-1.5 text-xs font-medium text-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-300 sm:self-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span className="tabular-nums" aria-label={`Durée écoulée : ${elapsed}`}>
          {elapsed}
        </span>
      </div>
    </div>
  )
}
