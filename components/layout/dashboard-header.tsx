'use client'

import { useState } from 'react'
import type { AgentRun } from '@/lib/types'
import { SourcingModal } from '@/components/dashboard/sourcing-modal'
import { useAgentRunStatus } from '@/lib/hooks/use-agent-run-status'

interface DashboardHeaderProps {
  userName: string
  agentRun: AgentRun | null
}

export function DashboardHeader({ userName, agentRun }: DashboardHeaderProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Statut SSR (depuis layout) + statut live (polling /api/agent/status).
  // Le hook prend le pas dès qu'il a fait son premier fetch — évite qu'un run
  // démarré dans un autre onglet ne soit invisible jusqu'au prochain refresh.
  const { isRunning: liveIsRunning } = useAgentRunStatus()
  const ssrIsRunning = agentRun?.status === 'running'
  const isAgentRunning = liveIsRunning || ssrIsRunning

  function handleLaunchAgent() {
    // Garde-fou : si un run tourne déjà, on n'ouvre pas la modal pour éviter
    // que l'utilisateur ne lance un POST qui sera bloqué par le 409 côté API.
    if (isAgentRunning) return
    setIsModalOpen(true)
  }

  const isDisabled = isAgentRunning

  // Initiale de l'utilisateur pour l'avatar
  const userInitial = userName.charAt(0).toUpperCase()

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-gray-100 bg-white/95 backdrop-blur-sm px-4 sm:px-6 dark:border-gray-800/60 dark:bg-gray-950/95">
      {/* Gauche : avatar + info utilisateur */}
      <div className="flex items-center gap-3">
        {/* Avatar avec tooltip implicite via aria-label */}
        <div
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-green-700 text-sm font-bold text-white shadow-sm shadow-green-600/25 ring-2 ring-white dark:ring-gray-950"
          title={userName}
          aria-label={`Connecté en tant que ${userName}`}
        >
          {userInitial}
        </div>

        <div className="hidden flex-col sm:flex">
          <span className="text-sm font-medium leading-none text-gray-900 dark:text-white">
            {userName}
          </span>
        </div>
      </div>

      {/* Droite : bouton */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleLaunchAgent}
          disabled={isDisabled}
          aria-disabled={isDisabled}
          aria-label={isAgentRunning ? "Un run est déjà en cours" : "Lancer l'agent de prospection"}
          title={isAgentRunning ? 'Un run est déjà en cours' : undefined}
          className={`relative inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-gray-950 ${
            isDisabled
              ? 'bg-green-600'
              : 'bg-green-600 hover:bg-green-700 active:scale-95 shadow-green-600/25 hover:shadow-green-600/40 hover:shadow-md'
          }`}
        >
          {/* Pulse ring quand l'agent tourne */}
          {isAgentRunning && (
            <span className="absolute -inset-0.5 rounded-lg animate-pulse bg-green-500/20" aria-hidden="true" />
          )}

          {isAgentRunning ? (
            <>
              <svg
                className="animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
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
              <span className="hidden sm:inline">En cours...</span>
            </>
          ) : (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="none"
                aria-hidden="true"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span className="hidden sm:inline">Lancer l&apos;agent</span>
            </>
          )}
        </button>
      </div>

      {/* Modal de configuration du sourcing */}
      <SourcingModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </header>
  )
}
