// ============================================================
// Tests : AddContactDialog
// ------------------------------------------------------------
// Couvre :
//   - Rendu fermé par défaut : pas de role="dialog".
//   - Ouverture : formulaire avec tous les champs présents.
//   - Soumission vide → erreur "au moins un identifiant".
//   - Soumission valide → POST /api/prospects/[id]/contacts.
//   - Close button + ESC + clic backdrop ferment.
//   - Pending state désactive le bouton submit.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

import { AddContactDialog } from './add-contact-dialog'

const PROSPECT_ID = '33333333-3333-3333-3333-333333333333'

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ data: { id: 'new-c' } }),
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AddContactDialog — rendu initial', () => {
  it('rend uniquement le bouton trigger, pas de dialog', () => {
    render(<AddContactDialog prospectId={PROSPECT_ID} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ajouter un contact/i })).toBeInTheDocument()
  })
})

describe('AddContactDialog — ouverture', () => {
  it('ouvre le dialog (role=dialog, aria-modal) et rend tous les champs', () => {
    render(<AddContactDialog prospectId={PROSPECT_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /Ajouter un contact/i }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    // 6 champs attendus + checkbox.
    expect(screen.getByLabelText(/^Prénom$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Nom$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Poste$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Téléphone$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Email$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^LinkedIn$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Définir comme contact principal/i)).toBeInTheDocument()
  })
})

describe('AddContactDialog — soumission', () => {
  it("affiche un message d'erreur si tous les champs sont vides", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<AddContactDialog prospectId={PROSPECT_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /Ajouter un contact/i }))

    fireEvent.click(screen.getByRole('button', { name: /Ajouter le contact/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/au moins un champ/i)
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POST /api/prospects/[id]/contacts avec le body trimé attendu', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ data: { id: 'new-c' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AddContactDialog prospectId={PROSPECT_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /Ajouter un contact/i }))

    fireEvent.change(screen.getByLabelText(/^Prénom$/i), { target: { value: 'Jean' } })
    fireEvent.change(screen.getByLabelText(/^Nom$/i), { target: { value: 'DUPONT' } })
    fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: 'jean@acme.example' } })

    fireEvent.click(screen.getByRole('button', { name: /Ajouter le contact/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/prospects/${PROSPECT_ID}/contacts`,
        expect.objectContaining({
          method: 'POST',
        }),
      )
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      prenom: 'Jean',
      nom: 'DUPONT',
      email: 'jean@acme.example',
      source: 'manual',
      is_primary: false,
    })
    // Les champs vides ne doivent pas être envoyés.
    expect(body.poste).toBeUndefined()
    expect(body.linkedin).toBeUndefined()
  })
})

describe('AddContactDialog — fermeture', () => {
  it('ferme via le bouton X', () => {
    render(<AddContactDialog prospectId={PROSPECT_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /^Ajouter un contact$/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Fermer la fenêtre/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ferme via ESC et via clic backdrop', () => {
    const { rerender } = render(<AddContactDialog prospectId={PROSPECT_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /^Ajouter un contact$/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // ESC
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Réouvrir pour tester le backdrop.
    rerender(<AddContactDialog prospectId={PROSPECT_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /^Ajouter un contact$/i }))
    const dialog = screen.getByRole('dialog')
    // Clic sur le backdrop = clic direct sur le wrapper dialog (target === currentTarget).
    fireEvent.click(dialog)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('AddContactDialog — pending', () => {
  it('désactive le bouton submit pendant la requête', async () => {
    const pendingPromise = new Promise<unknown>(() => {
      /* never resolves */
    })
    const fetchMock = vi.fn().mockReturnValue(pendingPromise)
    vi.stubGlobal('fetch', fetchMock)

    render(<AddContactDialog prospectId={PROSPECT_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /^Ajouter un contact$/i }))
    fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: 'a@b.fr' } })

    fireEvent.click(screen.getByRole('button', { name: /Ajouter le contact/i }))

    await waitFor(() => {
      const submit = screen.getByRole('button', { name: /Ajout en cours/i })
      expect(submit).toBeDisabled()
    })
  })
})
