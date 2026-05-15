'use client'

// ============================================================
// GlanStatusBar — bande sticky d'état de Glan
//
// Composant client autonome qui poll /api/glan/status toutes les 5s
// via `useGlanStatus`. Affiche :
//   - GlanAvatar (4 états)
//   - phrase d'état Alpha en ton sobre 1ʳᵉ pers (memory/feedback-glan-persona)
//   - phase courante en font-mono (si state=working)
//   - durée écoulée depuis le début de la phase
//
// Destiné à être placé dans le header du dashboard. Compatible mobile —
// dégrade en colonne avatar + texte court.
// ============================================================

import { useEffect, useState } from 'react'
import {
  useGlanStatus,
  type GlanState,
} from '@/lib/hooks/use-glan-status'
import { GlanAvatar } from './glan-avatar'

interface GlanStatusBarProps {
  className?: string
}

// Phrasing en ton Alpha — sobre, 1ʳᵉ personne, signe en filigrane par la présence
// de l'avatar (pas besoin de répéter "— Glan" sur chaque ligne).
const STATE_PHRASE: Record<GlanState, string> = {
  dormant: 'Prochaine exécution ce soir, 22h.',
  working: 'Je prépare votre liste.',
  done: "J'ai ajouté de nouveaux prospects à votre liste.",
  error: 'Une erreur est survenue. Je relance bientôt.',
}

// Map des phases techniques → libellés FR sobres
// Post-pivot 2026-05-14 : phases pitch_gen / daily_list retirées (l'orchestrator
// ne les exécute plus). Pipeline = init → sourcing → enrichissement → contacts → scoring → done.
const PHASE_LABEL: Record<string, string> = {
  init: 'Initialisation',
  sourcing: 'Sourcing Sirene',
  enrichment: 'Enrichissement ADEME',
  enrichissement: 'Enrichissement ADEME',
  contacts: 'Recherche contacts',
  scoring: 'Scoring 3 piliers',
  done: 'Terminé',
}

function formatPhaseLabel(phase: string | null): string {
  if (!phase) return ''
  return PHASE_LABEL[phase] ?? phase
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

function useElapsedSince(iso: string | null): string | null {
  const [elapsed, setElapsed] = useState<string | null>(() =>
    iso ? formatDuration(Date.now() - new Date(iso).getTime()) : null,
  )
  useEffect(() => {
    if (!iso) {
      setElapsed(null)
      return
    }
    const startMs = new Date(iso).getTime()
    const tick = () => setElapsed(formatDuration(Date.now() - startMs))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [iso])
  return elapsed
}

export function GlanStatusBar({ className = '' }: GlanStatusBarProps) {
  const { glanState, phase, phaseStartedAt, isLoading } = useGlanStatus()
  const elapsed = useElapsedSince(phaseStartedAt)

  if (isLoading) {
    return (
      <div
        className={`inline-flex items-center gap-3 ${className}`}
        aria-busy="true"
        aria-label="Chargement du statut de Glan"
      >
        <div className="h-8 w-8 animate-pulse rounded-full bg-white/[0.06]" />
        <div className="hidden h-3 w-32 animate-pulse rounded bg-white/[0.06] sm:block" />
      </div>
    )
  }

  const phaseLabel = formatPhaseLabel(phase)

  return (
    <div
      className={`inline-flex items-center gap-3 ${className}`}
      role="status"
      aria-live="polite"
    >
      <GlanAvatar state={glanState} size="sm" />

      <div className="hidden flex-col leading-tight sm:flex">
        <span className="text-sm font-medium text-white">
          {STATE_PHRASE[glanState]}
        </span>
        {glanState === 'working' && phaseLabel && (
          <span className="mt-0.5 font-mono text-[11px] text-cyan-300/80">
            {phaseLabel}
            {elapsed && <span className="ml-1.5 tabular-nums">· {elapsed}</span>}
          </span>
        )}
      </div>
    </div>
  )
}
