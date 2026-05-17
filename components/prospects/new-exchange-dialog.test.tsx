// ============================================================
// Tests : NewExchangeDialog
// ------------------------------------------------------------
// Couvre :
//   - Rendu fermé par défaut.
//   - Ouverture : 5 champs (occurred_at, type, result, notes, callback_date).
//   - Submission avec type sélectionné → POST /api/prospects/[id]/exchanges.
//   - Erreur réseau → message visible (role="alert").
//   - ESC ferme.
//   - Bouton submit désactivé pendant pending.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

import { NewExchangeDialog } from './new-exchange-dialog'

const PROSPECT_ID = '55555555-5555-5555-5555-555555555555'

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ data: { id: 'new-ex' } }),
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NewExchangeDialog — rendu initial', () => {
  it('rend uniquement le bouton trigger, pas de dialog', () => {
    render(<NewExchangeDialog prospectId={PROSPECT_ID} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Nouvel échange$/i })).toBeInTheDocument()
  })
})

describe('NewExchangeDialog — ouverture', () => {
  it('ouvre le dialog avec les 5 champs attendus', () => {
    render(<NewExchangeDialog prospectId={PROSPECT_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /^Nouvel échange$/i }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    expect(screen.getByLabelText(/Date et heure/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Type$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Résultat$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Notes$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Date de rappel/i)).toBeInTheDocument()
  })

  // Regression : le dialog doit être teleporté via React Portal dans
  // `document.body`, pas rendu à l'intérieur du parent. Sinon le parent
  // ExchangesPanel (overflow-hidden + backdrop-blur) clippe la modale.
  it('rend le dialog via React Portal directement dans document.body', () => {
    // On wrap le composant dans un parent identifiable par data-attr.
    render(
      <div data-testid="parent-container">
        <NewExchangeDialog prospectId={PROSPECT_ID} />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: /^Nouvel échange$/i }))

    const dialog = screen.getByRole('dialog')
    const parent = screen.getByTestId('parent-container')

    // Le dialog NE doit PAS être un descendant du parent du trigger.
    expect(parent.contains(dialog)).toBe(false)
    // Mais doit bien être attaché à document.body.
    expect(document.body.contains(dialog)).toBe(true)
  })

  it('bloque le scroll du body à l\'ouverture et le restaure à la fermeture', () => {
    render(<NewExchangeDialog prospectId={PROSPECT_ID} />)
    expect(document.body.style.overflow).not.toBe('hidden')

    fireEvent.click(screen.getByRole('button', { name: /^Nouvel échange$/i }))
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})

describe('NewExchangeDialog — submission', () => {
  it("bloque la soumission si occurred_at est vide (HTML required + guard JS)", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<NewExchangeDialog prospectId={PROSPECT_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /^Nouvel échange$/i }))

    const dateInput = screen.getByLabelText(/Date et heure/i) as HTMLInputElement
    // L'attribut HTML required est posé (anti-pattern submit accidentel).
    expect(dateInput).toBeRequired()

    fireEvent.change(dateInput, { target: { value: '' } })
    // Soumission directe via form.submit pour bypasser la validation HTML5 jsdom
    // et déclencher le guard JS interne (form.occurred_at === '').
    const form = dateInput.closest('form') as HTMLFormElement
    fireEvent.submit(form)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/date.*obligatoire/i)
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POST /api/prospects/[id]/exchanges avec le body attendu', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ data: { id: 'new-ex' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<NewExchangeDialog prospectId={PROSPECT_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /^Nouvel échange$/i }))

    // Renseigne explicitement les champs.
    fireEvent.change(screen.getByLabelText(/Date et heure/i), {
      target: { value: '2026-04-15T14:30' },
    })
    fireEvent.change(screen.getByLabelText(/^Type$/i), { target: { value: 'linkedin' } })
    fireEvent.change(screen.getByLabelText(/^Notes$/i), {
      target: { value: 'Connexion envoyée' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Enregistrer l'échange/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/prospects/${PROSPECT_ID}/exchanges`,
        expect.objectContaining({ method: 'POST' }),
      )
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.type).toBe('linkedin')
    expect(body.notes).toBe('Connexion envoyée')
    expect(typeof body.occurred_at).toBe('string')
    // Champ result vide ('') → omis du body.
    expect(body.result).toBeUndefined()
  })

  it("affiche le message d'erreur sur échec réseau (ok=false)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Erreur serveur' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<NewExchangeDialog prospectId={PROSPECT_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /^Nouvel échange$/i }))
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer l'échange/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Erreur serveur')
    })
    // Dialog reste ouvert sur erreur.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('NewExchangeDialog — fermeture', () => {
  it('ESC ferme le dialog', () => {
    render(<NewExchangeDialog prospectId={PROSPECT_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /^Nouvel échange$/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('NewExchangeDialog — pending', () => {
  it('désactive le bouton submit pendant la requête', async () => {
    const pendingPromise = new Promise<unknown>(() => {
      /* never resolves */
    })
    const fetchMock = vi.fn().mockReturnValue(pendingPromise)
    vi.stubGlobal('fetch', fetchMock)

    render(<NewExchangeDialog prospectId={PROSPECT_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /^Nouvel échange$/i }))
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer l'échange/i }))

    await waitFor(() => {
      const submit = screen.getByRole('button', { name: /Enregistrement/i })
      expect(submit).toBeDisabled()
    })
  })
})
