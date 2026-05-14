// ============================================================
// Tests : PriorityDropdown
// ------------------------------------------------------------
// Couvre :
//   - Rendu avec priorité courante (badge).
//   - Le menu propose 3 options : Haute / Moyenne / Basse.
//   - Click sur Haute → PATCH /api/prospects/[id]/priority.
//   - 401 → message d'erreur visible (role="alert").
//   - Escape ferme.
//   - Pending state : trigger désactivé.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

import { PriorityDropdown } from './priority-dropdown'

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { ok: true } }),
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

const PROSPECT_ID = '22222222-2222-2222-2222-222222222222'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PriorityDropdown — rendu', () => {
  it('affiche la priorité courante dans le trigger', () => {
    render(<PriorityDropdown prospectId={PROSPECT_ID} currentPriorite="moyenne" />)
    const trigger = screen.getByRole('button', { name: /Priorité moyenne/i })
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox')
  })

  it('rend les 3 options Haute / Moyenne / Basse à l\'ouverture', () => {
    render(<PriorityDropdown prospectId={PROSPECT_ID} currentPriorite="moyenne" />)
    fireEvent.click(screen.getByRole('button', { name: /Priorité moyenne/i }))

    const listbox = screen.getByRole('listbox', { name: /Sélectionner une priorité/i })
    expect(listbox).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.getByRole('option', { name: /Priorité haute/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Priorité moyenne/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Priorité basse/i })).toBeInTheDocument()
  })
})

describe('PriorityDropdown — sélection', () => {
  it('PATCH /api/prospects/[id]/priority avec { priorite: haute }', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { ok: true } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<PriorityDropdown prospectId={PROSPECT_ID} currentPriorite="moyenne" />)
    fireEvent.click(screen.getByRole('button', { name: /Priorité moyenne/i }))
    fireEvent.click(screen.getByRole('option', { name: /Priorité haute/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/prospects/${PROSPECT_ID}/priority`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ priorite: 'haute' }),
        }),
      )
    })
  })
})

describe('PriorityDropdown — erreur', () => {
  it('affiche le message d\'erreur quand l\'API retourne 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Non authentifié' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<PriorityDropdown prospectId={PROSPECT_ID} currentPriorite="moyenne" />)
    fireEvent.click(screen.getByRole('button', { name: /Priorité moyenne/i }))
    fireEvent.click(screen.getByRole('option', { name: /Priorité haute/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Non authentifié')
    })
    // Rollback : on revient à moyenne.
    expect(
      screen.getByRole('button', { name: /Priorité moyenne/i }),
    ).toBeInTheDocument()
  })
})

describe('PriorityDropdown — fermeture', () => {
  it('Escape ferme le menu', () => {
    render(<PriorityDropdown prospectId={PROSPECT_ID} currentPriorite="basse" />)
    fireEvent.click(screen.getByRole('button', { name: /Priorité basse/i }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('PriorityDropdown — pending', () => {
  it('désactive le trigger pendant la requête', async () => {
    const pendingPromise = new Promise<unknown>(() => {
      /* never resolves */
    })
    const fetchMock = vi.fn().mockReturnValue(pendingPromise)
    vi.stubGlobal('fetch', fetchMock)

    render(<PriorityDropdown prospectId={PROSPECT_ID} currentPriorite="moyenne" />)
    fireEvent.click(screen.getByRole('button', { name: /Priorité moyenne/i }))
    fireEvent.click(screen.getByRole('option', { name: /Priorité haute/i }))

    await waitFor(() => {
      // Optimistic : le label devient "haute" + bouton disabled.
      expect(screen.getByRole('button', { name: /Priorité haute/i })).toBeDisabled()
    })
  })
})
