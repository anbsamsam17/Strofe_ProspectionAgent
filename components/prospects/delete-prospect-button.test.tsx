// ============================================================
// Tests : DeleteProspectButton
// ------------------------------------------------------------
// Couvre :
//   - Trigger seul visible par défaut (pas de dialog).
//   - Click → dialog ouvert (role=dialog, aria-modal).
//   - Confirmation → DELETE /api/prospects/[id].
//   - Erreur API → message inline rouge.
//   - ESC + backdrop + Annuler → ferme.
//   - Pending → bouton submit désactivé.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

import { DeleteProspectButton } from './delete-prospect-button'

const PROSPECT_ID = '33333333-3333-3333-3333-333333333333'
const PROSPECT_NAME = 'Acme SAS'
const PROSPECT_SIREN = '123456789'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { deleted: true } }),
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('DeleteProspectButton — rendu initial', () => {
  it('rend uniquement le trigger, pas de dialog', () => {
    render(
      <DeleteProspectButton
        prospectId={PROSPECT_ID}
        prospectName={PROSPECT_NAME}
        prospectSiren={PROSPECT_SIREN}
      />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: new RegExp(`Supprimer ${PROSPECT_NAME}`, 'i') }),
    ).toBeInTheDocument()
  })
})

describe('DeleteProspectButton — ouverture du dialog', () => {
  it('ouvre le dialog avec le nom + SIREN du prospect', () => {
    render(
      <DeleteProspectButton
        prospectId={PROSPECT_ID}
        prospectName={PROSPECT_NAME}
        prospectSiren={PROSPECT_SIREN}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`Supprimer ${PROSPECT_NAME}`, 'i') }),
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // Le titre + corps doivent mentionner le nom et le SIREN.
    expect(dialog).toHaveTextContent(/SUPPRIMER DÉFINITIVEMENT/i)
    expect(dialog).toHaveTextContent(PROSPECT_NAME)
    expect(dialog).toHaveTextContent(PROSPECT_SIREN)
  })

  it("n'affiche pas le SIREN si null", () => {
    render(
      <DeleteProspectButton
        prospectId={PROSPECT_ID}
        prospectName={PROSPECT_NAME}
        prospectSiren={null}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`Supprimer ${PROSPECT_NAME}`, 'i') }),
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).not.toHaveTextContent(/SIREN/i)
  })
})

describe('DeleteProspectButton — confirmation', () => {
  it('appelle DELETE /api/prospects/[id] sur clic "Supprimer"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { deleted: true } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <DeleteProspectButton
        prospectId={PROSPECT_ID}
        prospectName={PROSPECT_NAME}
        prospectSiren={PROSPECT_SIREN}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`Supprimer ${PROSPECT_NAME}`, 'i') }),
    )

    // Le 2e bouton "Supprimer" est celui du dialog (le 1er est le trigger).
    const dialog = screen.getByRole('dialog')
    const confirmBtn = dialog.querySelector('button.bg-red-600') as HTMLButtonElement
    expect(confirmBtn).toBeTruthy()
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/prospects/${PROSPECT_ID}`,
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
  })

  it('affiche un message d\'erreur si la route renvoie une erreur', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () =>
        Promise.resolve({
          error: 'Statut protégé — archivez d\'abord',
        }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <DeleteProspectButton
        prospectId={PROSPECT_ID}
        prospectName={PROSPECT_NAME}
        prospectSiren={PROSPECT_SIREN}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`Supprimer ${PROSPECT_NAME}`, 'i') }),
    )

    const dialog = screen.getByRole('dialog')
    const confirmBtn = dialog.querySelector('button.bg-red-600') as HTMLButtonElement
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Statut protégé/i)
    })
  })
})

describe('DeleteProspectButton — fermeture', () => {
  it('ferme via "Annuler"', () => {
    render(
      <DeleteProspectButton
        prospectId={PROSPECT_ID}
        prospectName={PROSPECT_NAME}
        prospectSiren={PROSPECT_SIREN}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`Supprimer ${PROSPECT_NAME}`, 'i') }),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Annuler$/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ferme via ESC', () => {
    render(
      <DeleteProspectButton
        prospectId={PROSPECT_ID}
        prospectName={PROSPECT_NAME}
        prospectSiren={PROSPECT_SIREN}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`Supprimer ${PROSPECT_NAME}`, 'i') }),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ferme via clic backdrop', () => {
    render(
      <DeleteProspectButton
        prospectId={PROSPECT_ID}
        prospectName={PROSPECT_NAME}
        prospectSiren={PROSPECT_SIREN}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`Supprimer ${PROSPECT_NAME}`, 'i') }),
    )
    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog) // clic sur le wrapper = backdrop
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('DeleteProspectButton — pending', () => {
  it('désactive le bouton submit pendant la requête', async () => {
    const pendingPromise = new Promise<unknown>(() => {
      /* never resolves */
    })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pendingPromise))

    render(
      <DeleteProspectButton
        prospectId={PROSPECT_ID}
        prospectName={PROSPECT_NAME}
        prospectSiren={PROSPECT_SIREN}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`Supprimer ${PROSPECT_NAME}`, 'i') }),
    )

    const dialog = screen.getByRole('dialog')
    const confirmBtn = dialog.querySelector('button.bg-red-600') as HTMLButtonElement
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(confirmBtn).toBeDisabled()
      expect(confirmBtn).toHaveTextContent(/Suppression/i)
    })
  })
})
