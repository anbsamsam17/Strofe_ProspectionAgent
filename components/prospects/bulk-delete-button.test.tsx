// ============================================================
// Tests : BulkDeleteButton
// ------------------------------------------------------------
// Couvre :
//   - Trigger désactivé quand aucun filtre actif.
//   - Trigger affiche le count quand filtre actif.
//   - Click → dialog avec bullets des filtres + champ confirmation.
//   - Bouton "Supprimer N prospects" désactivé tant que texte != "SUPPRIMER".
//   - Confirmation → POST /api/prospects/bulk-delete avec body { filters }.
//   - ESC / Annuler / backdrop ferment.
//   - Erreur API → message inline rouge.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

import { BulkDeleteButton, type BulkDeleteFilters } from './bulk-delete-button'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { deleted: 5 } }),
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('BulkDeleteButton — état désactivé', () => {
  it('le trigger est désactivé si aucun filtre actif', () => {
    render(<BulkDeleteButton filters={{}} count={10} />)
    const trigger = screen.getByRole('button', {
      name: /Aucun filtre actif/i,
    })
    expect(trigger).toBeDisabled()
  })

  it('le trigger est désactivé si count=0 même avec filtre', () => {
    render(<BulkDeleteButton filters={{ statut: ['sourced'] }} count={0} />)
    const trigger = screen.getByRole('button', { name: /0 prospects/i })
    expect(trigger).toBeDisabled()
  })
})

describe('BulkDeleteButton — affichage', () => {
  it('affiche le count à côté du label quand filtre actif', () => {
    const filters: BulkDeleteFilters = { statut: ['sourced'] }
    render(<BulkDeleteButton filters={filters} count={42} />)
    const trigger = screen.getByRole('button', { name: /42 prospects/i })
    expect(trigger).toHaveTextContent('42')
    expect(trigger).not.toBeDisabled()
  })
})

describe('BulkDeleteButton — dialog', () => {
  it('ouvre le dialog avec les bullets des filtres actifs', () => {
    const filters: BulkDeleteFilters = {
      statut: ['sourced'],
      secteur: 'industrie',
      score_min: 50,
    }
    render(<BulkDeleteButton filters={filters} count={3} />)
    fireEvent.click(screen.getByRole('button', { name: /3 prospects/i }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveTextContent(/IRRÉVERSIBLE/i)
    // Vérifie que chaque filtre apparaît dans la liste.
    expect(dialog).toHaveTextContent(/Nouveau/i)
    expect(dialog).toHaveTextContent(/industrie/i)
    expect(dialog).toHaveTextContent(/Score ≥ 50/i)
  })

  it('le bouton "Supprimer N prospects" est désactivé tant que texte != "SUPPRIMER"', () => {
    render(<BulkDeleteButton filters={{ statut: ['sourced'] }} count={5} />)
    fireEvent.click(screen.getByRole('button', { name: /5 prospects/i }))

    const submit = screen.getByRole('button', { name: /^Supprimer 5 prospects$/i })
    expect(submit).toBeDisabled()

    const input = screen.getByLabelText(/Taper.*SUPPRIMER/i)
    fireEvent.change(input, { target: { value: 'SUPPRIME' } })
    expect(submit).toBeDisabled()

    fireEvent.change(input, { target: { value: 'SUPPRIMER' } })
    expect(submit).not.toBeDisabled()
  })

  it('POST /api/prospects/bulk-delete avec { filters } sur confirmation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { deleted: 7 } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const filters: BulkDeleteFilters = {
      statut: ['sourced', 'qualified'],
      score_min: 30,
    }
    render(<BulkDeleteButton filters={filters} count={7} />)
    fireEvent.click(screen.getByRole('button', { name: /7 prospects/i }))

    const input = screen.getByLabelText(/Taper.*SUPPRIMER/i)
    fireEvent.change(input, { target: { value: 'SUPPRIMER' } })

    const submit = screen.getByRole('button', { name: /^Supprimer 7 prospects$/i })
    fireEvent.click(submit)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/prospects/bulk-delete',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ filters })
  })

  it('affiche un message d\'erreur si la route renvoie une erreur', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: { code: 'NO_FILTER', message: 'Au moins un filtre est requis' },
        }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<BulkDeleteButton filters={{ statut: ['sourced'] }} count={2} />)
    fireEvent.click(screen.getByRole('button', { name: /2 prospects/i }))

    const input = screen.getByLabelText(/Taper.*SUPPRIMER/i)
    fireEvent.change(input, { target: { value: 'SUPPRIMER' } })

    const submit = screen.getByRole('button', { name: /^Supprimer 2 prospects$/i })
    fireEvent.click(submit)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Au moins un filtre/i)
    })
  })
})

describe('BulkDeleteButton — fermeture', () => {
  it('ferme via "Annuler"', () => {
    render(<BulkDeleteButton filters={{ statut: ['sourced'] }} count={1} />)
    fireEvent.click(screen.getByRole('button', { name: /1 prospects/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Annuler$/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ferme via ESC', () => {
    render(<BulkDeleteButton filters={{ statut: ['sourced'] }} count={1} />)
    fireEvent.click(screen.getByRole('button', { name: /1 prospects/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
