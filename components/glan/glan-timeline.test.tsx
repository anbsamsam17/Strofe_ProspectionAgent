import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { GlanTimeline } from './glan-timeline'
import type { AgentRun } from '@/lib/types'

function buildRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    user_id: 'user-1',
    status: 'completed',
    prospects_sourced: 87,
    prospects_qualified: 15,
    list_generated: true,
    logs: [
      {
        timestamp: '2026-05-14T22:00:00.000Z',
        phase: 'sourcing',
        level: 'info',
        message: 'Sourcing démarré',
      },
      {
        timestamp: '2026-05-14T22:05:00.000Z',
        phase: 'sourcing',
        level: 'info',
        message: 'Sourcing terminé',
      },
      {
        timestamp: '2026-05-14T22:10:00.000Z',
        phase: 'scoring',
        level: 'info',
        message: 'Scoring démarré',
      },
    ],
    started_at: '2026-05-14T22:00:00.000Z',
    completed_at: '2026-05-14T22:30:00.000Z',
    ...overrides,
  }
}

describe('GlanTimeline', () => {
  it("annonce 'Étapes du run de Glan' aux lecteurs d'écran", () => {
    render(<GlanTimeline run={buildRun()} />)
    expect(screen.getByRole('list', { name: /étapes du run/i })).toBeInTheDocument()
  })

  it("affiche les 5 phases du pipeline post-pivot (init → scoring)", () => {
    // Post-pivot : pitch_gen + daily_list retirées de l'orchestrator.
    render(<GlanTimeline run={buildRun()} />)
    expect(screen.getByText('Initialisation')).toBeInTheDocument()
    expect(screen.getByText('Sourcing Sirene')).toBeInTheDocument()
    expect(screen.getByText('Enrichissement ADEME')).toBeInTheDocument()
    expect(screen.getByText('Recherche contacts')).toBeInTheDocument()
    expect(screen.getByText('Scoring 3 piliers')).toBeInTheDocument()
    // Génération pitchs / Préparation liste retirées du pipeline.
    expect(screen.queryByText('Génération pitchs')).not.toBeInTheDocument()
    expect(screen.queryByText('Préparation liste')).not.toBeInTheDocument()
  })

  it("marque une phase 'Terminée' quand des logs existent", () => {
    render(<GlanTimeline run={buildRun()} />)
    // 2 phases ont des logs : sourcing + scoring → au moins 2 "Terminée"
    const terminees = screen.getAllByText(/terminée/i)
    expect(terminees.length).toBeGreaterThanOrEqual(2)
  })

  it("marque les phases sans logs comme 'En attente' si le run est completed", () => {
    render(<GlanTimeline run={buildRun()} />)
    // Phases sans log (ex. init, enrichissement, contacts, pitch_gen, daily_list)
    expect(screen.getAllByText(/en attente/i).length).toBeGreaterThan(0)
  })

  it("marque les phases non démarrées comme 'Non exécutée' si le run a échoué", () => {
    const failedRun = buildRun({ status: 'failed' })
    render(<GlanTimeline run={failedRun} />)
    expect(screen.getAllByText(/non exécutée/i).length).toBeGreaterThan(0)
  })

  it("détecte l'échec d'une phase via les logs niveau error", () => {
    const runWithError = buildRun({
      logs: [
        {
          timestamp: '2026-05-14T22:00:00.000Z',
          phase: 'sourcing',
          level: 'error',
          message: 'Sirene API 500',
        },
      ],
    })
    render(<GlanTimeline run={runWithError} />)
    expect(screen.getByText(/échec/i)).toBeInTheDocument()
  })
})
