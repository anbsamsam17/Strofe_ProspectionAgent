// ============================================================
// Tests : StatusDropdown
// ------------------------------------------------------------
// Couvre :
//   - Rendu : affiche le label du statut courant.
//   - Click trigger ouvre le menu (aria-expanded = true).
//   - Click sur un item appelle fetch PATCH /api/prospects/[id]
//     avec { statut: newStatut }.
//   - Pending state : options désactivées pendant la requête.
//   - Erreur fetch : rollback visuel + message d'erreur.
//   - Escape ferme le menu.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

// Mock next/navigation — pas de vrai router en jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

// Import APRÈS le mock (Vitest hoist les vi.mock, mais on garde l'ordre clair).
import { StatusDropdown } from './status-dropdown'

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

const PROSPECT_ID = '11111111-1111-1111-1111-111111111111'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StatusDropdown — rendu', () => {
  it('affiche le label du statut courant dans le trigger', () => {
    render(<StatusDropdown prospectId={PROSPECT_ID} currentStatut="qualified" />)
    // Le label apparaît dans l'aria-label + le span visible.
    const trigger = screen.getByRole('button', { name: /Statut CRM : Qualifié/i })
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox')
  })
})

describe('StatusDropdown — ouverture menu', () => {
  it('click sur le trigger ouvre le listbox et bascule aria-expanded', () => {
    render(<StatusDropdown prospectId={PROSPECT_ID} currentStatut="qualified" />)
    const trigger = screen.getByRole('button', { name: /Statut CRM/i })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    fireEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox', { name: /Sélectionner un statut CRM/i })).toBeInTheDocument()
    // 8 statuts disponibles dans le menu.
    expect(screen.getAllByRole('option')).toHaveLength(8)
  })
})

describe('StatusDropdown — sélection', () => {
  it('PATCH /api/prospects/[id] avec { statut: newStatut } au clic sur une option', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { ok: true } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StatusDropdown prospectId={PROSPECT_ID} currentStatut="qualified" />)

    fireEvent.click(screen.getByRole('button', { name: /Statut CRM/i }))
    fireEvent.click(screen.getByRole('option', { name: /Contacté/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/prospects/${PROSPECT_ID}`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ statut: 'contacted' }),
        }),
      )
    })
  })

  it('désactive les options pendant la requête (pending state)', async () => {
    // Promise jamais résolue → reste pending.
    const pendingPromise = new Promise<unknown>(() => {
      // Volontairement laissé en suspens : on veut tester l'état pending.
    })
    const fetchMock = vi.fn().mockReturnValue(pendingPromise)
    vi.stubGlobal('fetch', fetchMock)

    render(<StatusDropdown prospectId={PROSPECT_ID} currentStatut="qualified" />)

    fireEvent.click(screen.getByRole('button', { name: /Statut CRM/i }))
    fireEvent.click(screen.getByRole('option', { name: /Contacté/i }))

    // Le menu se ferme après le clic. Le bouton trigger reste disabled pendant le pending.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Statut CRM/i })).toBeDisabled()
    })
  })
})

describe('StatusDropdown — erreur', () => {
  it("rollback du statut + affichage du message d'erreur en cas d'échec API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Conflit pipeline' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<StatusDropdown prospectId={PROSPECT_ID} currentStatut="qualified" />)

    fireEvent.click(screen.getByRole('button', { name: /Statut CRM/i }))
    fireEvent.click(screen.getByRole('option', { name: /Contacté/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Conflit pipeline')
    })
    // Le trigger revient au statut initial (rollback).
    expect(
      screen.getByRole('button', { name: /Statut CRM : Qualifié/i }),
    ).toBeInTheDocument()
  })
})

describe('StatusDropdown — fermeture', () => {
  it('Escape ferme le menu', () => {
    render(<StatusDropdown prospectId={PROSPECT_ID} currentStatut="qualified" />)
    fireEvent.click(screen.getByRole('button', { name: /Statut CRM/i }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
