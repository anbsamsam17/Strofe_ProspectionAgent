import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { GlanLogStream } from './glan-log-stream'
import type { AgentLog } from '@/lib/types'

const FIX_LOGS: AgentLog[] = [
  {
    timestamp: '2026-05-14T22:00:01.000Z',
    phase: 'sourcing',
    level: 'info',
    message: 'Sirene scan démarré (87 entreprises)',
  },
  {
    timestamp: '2026-05-14T22:05:14.000Z',
    phase: 'enrichissement',
    level: 'warn',
    message: 'ADEME timeout sur 3 BEGES, retry programmé',
  },
  {
    timestamp: '2026-05-14T22:07:42.000Z',
    phase: 'scoring',
    level: 'error',
    message: 'Score calculation timeout — back-off 2s',
  },
]

describe('GlanLogStream', () => {
  it('affiche un fallback quand la liste de logs est vide', () => {
    render(<GlanLogStream logs={[]} />)
    expect(screen.getByText(/en attente du premier log/i)).toBeInTheDocument()
  })

  it('rend chaque log avec phase, message et heure', () => {
    render(<GlanLogStream logs={FIX_LOGS} />)

    expect(screen.getByText(/Sirene scan démarré/)).toBeInTheDocument()
    expect(screen.getByText(/ADEME timeout/)).toBeInTheDocument()
    expect(screen.getByText(/Score calculation timeout/)).toBeInTheDocument()

    // Phases visibles
    expect(screen.getByText('[sourcing]')).toBeInTheDocument()
    expect(screen.getByText('[enrichissement]')).toBeInTheDocument()
    expect(screen.getByText('[scoring]')).toBeInTheDocument()
  })

  it('utilise role="log" + aria-live="polite" pour annonces SR', () => {
    render(<GlanLogStream logs={FIX_LOGS} />)
    const list = screen.getByRole('log', { name: /logs de glan/i })
    expect(list).toHaveAttribute('aria-live', 'polite')
    expect(list).toHaveAttribute('aria-relevant', 'additions')
  })
})
