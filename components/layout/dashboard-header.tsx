'use client'

import { useState } from 'react'
import type { AgentRun } from '@/lib/types'
import { SourcingModal } from '@/components/dashboard/sourcing-modal'
import { useAgentRunStatus } from '@/lib/hooks/use-agent-run-status'
import { GlanStatusBar } from '@/components/glan/glan-status-bar'
import { BorderBeam } from '@/components/ui/border-beam'

interface DashboardHeaderProps {
  userName: string
  agentRun: AgentRun | null
}

export function DashboardHeader({ userName, agentRun }: DashboardHeaderProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Statut SSR (depuis layout) + statut live (polling /api/agent/status).
  const { isRunning: liveIsRunning } = useAgentRunStatus()
  const ssrIsRunning = agentRun?.status === 'running'
  const isAgentRunning = liveIsRunning || ssrIsRunning

  function handleLaunchAgent() {
    if (isAgentRunning) return
    setIsModalOpen(true)
  }

  const isDisabled = isAgentRunning
  const userInitial = userName.charAt(0).toUpperCase()

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-white/[0.06] bg-white/[0.025] px-4 backdrop-blur-xl sm:px-6">
      {/* Accent horizontal lumineux en bas (signature tech) */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent"
      />

      {/* Gauche : statut Glan persistant */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <GlanStatusBar />
      </div>

      {/* Droite : bouton lancer + avatar user */}
      <div className="flex items-center gap-3">
        <BorderBeam color="brand" thickness={1.5} paused={isAgentRunning}>
        <button
          onClick={handleLaunchAgent}
          disabled={isDisabled}
          aria-disabled={isDisabled}
          aria-label={
            isAgentRunning ? 'Un run est déjà en cours' : "Lancer l'agent de prospection"
          }
          title={isAgentRunning ? 'Un run est déjà en cours' : undefined}
          className={`relative inline-flex items-center gap-2 overflow-hidden rounded-lg border px-4 py-2 text-sm font-semibold text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-green-500/50 disabled:cursor-not-allowed disabled:opacity-60 ${
            isDisabled
              ? 'border-green-500/30 bg-green-500/15'
              : 'border-green-400/40 bg-gradient-to-r from-green-600 to-emerald-500 shadow-[0_0_20px_-4px_oklch(70%_0.19_152_/_0.5)] hover:shadow-[0_0_28px_-2px_oklch(70%_0.19_152_/_0.7)] active:scale-95'
          }`}
        >
          {isAgentRunning && (
            <span
              className="absolute -inset-0.5 animate-pulse rounded-lg bg-green-500/20"
              aria-hidden="true"
            />
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
              <span className="hidden sm:inline">Run en cours…</span>
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
              <span className="hidden sm:inline">Lancer Glan</span>
            </>
          )}
        </button>
        </BorderBeam>

        {/* Avatar utilisateur tech */}
        <div
          className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-emerald-600 text-sm font-bold text-white shadow-[0_0_16px_-4px_oklch(70%_0.19_152_/_0.6)] ring-1 ring-white/15"
          title={userName}
          aria-label={`Connecté en tant que ${userName}`}
        >
          {userInitial}
        </div>
      </div>

      <SourcingModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </header>
  )
}
