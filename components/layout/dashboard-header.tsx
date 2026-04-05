'use client'

import { useState } from 'react'
import type { AgentRun, DailyList, DailyListStatus } from '@/lib/types'

interface DashboardHeaderProps {
  userName: string
  agentRun: AgentRun | null
  dailyList: DailyList | null
}

function AgentStatusBadge({ status }: { status: DailyListStatus | null }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" aria-hidden="true" />
        En attente
      </span>
    )
  }

  const configs: Record<DailyListStatus, { label: string; dotClass: string; badgeClass: string }> = {
    ready: {
      label: 'Liste prête',
      dotClass: 'bg-green-500',
      badgeClass: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
    },
    completed: {
      label: 'Liste terminée',
      dotClass: 'bg-blue-500',
      badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
    },
    generating: {
      label: 'Génération en cours...',
      dotClass: 'bg-yellow-500 animate-pulse',
      badgeClass: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400',
    },
    pending: {
      label: 'En attente',
      dotClass: 'bg-gray-400',
      badgeClass: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    },
  }

  const config = configs[status]
  const checkmark = status === 'ready' || status === 'completed' ? ' ✓' : ''

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${config.badgeClass}`}
      aria-live="polite"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dotClass}`} aria-hidden="true" />
      {config.label}{checkmark}
    </span>
  )
}

export function DashboardHeader({ userName, agentRun, dailyList }: DashboardHeaderProps) {
  const [isRunning, setIsRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  async function handleLaunchAgent() {
    setIsRunning(true)
    setRunError(null)
    try {
      const response = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        const data = await response.json() as { error?: string }
        throw new Error(data.error ?? 'Erreur lors du lancement de l\'agent')
      }
      // Recharge la page pour refléter le nouveau statut
      window.location.reload()
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setIsRunning(false)
    }
  }

  const dailyListStatus = dailyList?.status ?? null
  const isAgentRunning = agentRun?.status === 'running'

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 sm:px-6 dark:border-gray-800 dark:bg-gray-900">
      {/* Nom utilisateur + badge statut */}
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-sm font-semibold text-green-700 dark:bg-green-950 dark:text-green-400">
          {userName.charAt(0).toUpperCase()}
        </div>
        <div className="hidden flex-col sm:flex">
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            {userName}
          </span>
          <AgentStatusBadge status={dailyListStatus} />
        </div>
        <div className="sm:hidden">
          <AgentStatusBadge status={dailyListStatus} />
        </div>
      </div>

      {/* Bouton lancer l'agent */}
      <div className="flex items-center gap-3">
        {runError && (
          <p className="hidden text-xs text-red-600 dark:text-red-400 sm:block" role="alert">
            {runError}
          </p>
        )}
        <button
          onClick={handleLaunchAgent}
          disabled={isRunning || isAgentRunning}
          aria-label={isRunning || isAgentRunning ? 'Agent en cours d\'exécution' : 'Lancer l\'agent de prospection'}
          className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-gray-900"
        >
          {isRunning || isAgentRunning ? (
            <>
              <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              <span className="hidden sm:inline">En cours...</span>
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span className="hidden sm:inline">Lancer l&apos;agent</span>
            </>
          )}
        </button>
      </div>
    </header>
  )
}
