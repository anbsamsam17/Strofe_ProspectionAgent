// ============================================================
// Tests : ExchangesPanel
// ------------------------------------------------------------
// Couvre :
//   - Rendu d'une liste d'échanges (date, type badge, result badge, notes).
//   - Merge avec daily_list_items (calls) ordonné DESC par date.
//   - Bouton "Nouvel échange" rendu (NewExchangeDialog mocké).
//   - Empty state si pas d'échange.
//   - callback_date affichée si présente.
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// Mock NewExchangeDialog — on ne teste pas le formulaire ici.
vi.mock('./new-exchange-dialog', () => ({
  NewExchangeDialog: ({ prospectId }: { prospectId: string }) => (
    <button type="button" data-testid={`new-exchange-mock-${prospectId}`}>
      Nouvel échange
    </button>
  ),
}))

// Mock EditExchangeDialog (Sprint 3 #11) — utilise useRouter, on stub.
vi.mock('./edit-exchange-dialog', () => ({
  EditExchangeDialog: ({
    prospectId,
    exchange,
  }: {
    prospectId: string
    exchange: { id: string }
  }) => (
    <button
      type="button"
      data-testid={`edit-exchange-mock-${prospectId}-${exchange.id}`}
    >
      Éditer
    </button>
  ),
}))

import { ExchangesPanel, type ProspectExchange } from './exchanges-panel'

const PROSPECT_ID = '44444444-4444-4444-4444-444444444444'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeExchange(overrides: Partial<ProspectExchange> = {}): ProspectExchange {
  return {
    id: 'ex-1',
    user_id: 'uid-1',
    prospect_id: PROSPECT_ID,
    occurred_at: '2026-03-15T10:00:00Z',
    type: 'email',
    result: 'email_sent',
    notes: 'Premier email envoyé',
    callback_date: null,
    created_at: '2026-03-15T10:00:00Z',
    updated_at: '2026-03-15T10:00:00Z',
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ExchangesPanel — rendu liste', () => {
  it('rend le compteur, le badge type et result, et les notes', () => {
    const exchanges = [
      makeExchange({
        id: 'ex-1',
        type: 'email',
        result: 'email_sent',
        notes: 'Email cold envoyé',
      }),
    ]
    render(<ExchangesPanel prospectId={PROSPECT_ID} exchanges={exchanges} calls={[]} />)

    expect(screen.getByText(/Historique des échanges \(1\)/i)).toBeInTheDocument()
    expect(screen.getByText('Email')).toBeInTheDocument()
    expect(screen.getByText('Email envoyé')).toBeInTheDocument()
    expect(screen.getByText('Email cold envoyé')).toBeInTheDocument()
    expect(
      screen.getByRole('list', { name: /Historique des échanges avec ce prospect/i }),
    ).toBeInTheDocument()
  })

  it('affiche la date de rappel quand callback_date est renseignée', () => {
    const exchanges = [
      makeExchange({
        id: 'ex-2',
        type: 'appel',
        result: 'callback',
        callback_date: '2026-04-01',
      }),
    ]
    render(<ExchangesPanel prospectId={PROSPECT_ID} exchanges={exchanges} calls={[]} />)
    expect(screen.getByText(/Rappel le/i)).toBeInTheDocument()
  })
})

describe('ExchangesPanel — fusion exchanges + calls', () => {
  it('merge et trie DESC par occurred_at / called_at', () => {
    const exchanges = [
      makeExchange({
        id: 'ex-old',
        occurred_at: '2026-01-01T10:00:00Z',
        type: 'email',
        notes: 'Vieux échange',
      }),
    ]
    const calls = [
      {
        id: 'call-recent',
        called_at: '2026-04-01T10:00:00Z',
        call_result: 'interested' as const,
        call_notes: 'Appel récent et chaud',
        callback_date: null,
      },
    ]

    const { container } = render(
      <ExchangesPanel prospectId={PROSPECT_ID} exchanges={exchanges} calls={calls} />,
    )

    expect(screen.getByText(/Historique des échanges \(2\)/i)).toBeInTheDocument()
    expect(screen.getByText('Appel récent et chaud')).toBeInTheDocument()
    expect(screen.getByText('Vieux échange')).toBeInTheDocument()

    // Vérifie l'ordre DESC : "Appel récent" apparaît dans le DOM avant "Vieux échange".
    const items = container.querySelectorAll('li')
    expect(items[0]).toHaveTextContent('Appel récent et chaud')
    expect(items[1]).toHaveTextContent('Vieux échange')
  })
})

describe('ExchangesPanel — empty state', () => {
  it('affiche le message vide quand aucun échange ni appel', () => {
    render(<ExchangesPanel prospectId={PROSPECT_ID} exchanges={[]} calls={[]} />)
    expect(
      screen.getByText(/Aucun échange enregistré pour ce prospect/i),
    ).toBeInTheDocument()
    // Le titre ne porte pas de compteur quand timeline.length === 0.
    expect(screen.getByText(/^Historique des échanges$/i)).toBeInTheDocument()
  })
})

describe('ExchangesPanel — bouton ajout', () => {
  it('rend le bouton NewExchangeDialog avec le prospectId', () => {
    render(<ExchangesPanel prospectId={PROSPECT_ID} exchanges={[]} calls={[]} />)
    expect(screen.getByTestId(`new-exchange-mock-${PROSPECT_ID}`)).toBeInTheDocument()
  })
})
