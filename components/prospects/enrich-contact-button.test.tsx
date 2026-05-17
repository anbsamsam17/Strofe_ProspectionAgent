// ============================================================
// Tests : EnrichContactButton
// ------------------------------------------------------------
// Couvre :
//   - Rendu initial : libellé "Chercher un contact" + bouton actif.
//   - Click → POST /api/prospects/<id>/enrich + toast succès + refresh().
//   - Succès sans champ ajouté → toast info "Aucun contact trouvé".
//   - Erreur 503 quota → toast rouge avec message provider.
//   - Erreur réseau (rejection fetch) → toast rouge.
//
// + Cas "contacts masqués" :
//   - Détecte au moins 1 contact masqué → bouton bascule en mode "Remplacer".
//   - forceReplace=true envoyé dans le body de la requête.
//   - Toast succès "Contacts masqués remplacés…" quand cascade trouve.
//   - Toast warning "Contacts masqués supprimés, mais aucun nouveau…" quand vide.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

// Mock useRouter — on n'a pas besoin d'un vrai router en test.
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn(), replace: vi.fn() }),
}))

import { EnrichContactButton } from './enrich-contact-button'

/**
 * Helper : prépare un mock global.fetch qui renvoie une Response JSON-like
 * ET capture le body envoyé (pour vérifier `forceReplace` côté UI).
 */
let lastFetchBody: string | undefined
function mockFetch(status: number, payload: unknown) {
  lastFetchBody = undefined
  globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => {
    lastFetchBody = typeof init?.body === 'string' ? init.body : undefined
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  mockRefresh.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('EnrichContactButton — rendu initial', () => {
  it('rend le libellé "Chercher un contact" et un bouton activé', () => {
    render(<EnrichContactButton prospectId="pid-1" />)
    const btn = screen.getByRole('button', { name: /chercher un contact/i })
    expect(btn).toBeInTheDocument()
    expect(btn).not.toBeDisabled()
    expect(screen.getByText(/Chercher un contact/i)).toBeInTheDocument()
  })

  it('rend le libellé "Chercher un contact" quand aucun contact masqué fourni', () => {
    render(
      <EnrichContactButton
        prospectId="pid-1"
        contacts={[
          {
            nom: 'Dupont',
            prenom: 'Jean',
            email: 'jean@acme.fr',
            telephone: '0102030405',
            email_is_pro: true,
          },
        ]}
      />,
    )
    expect(screen.getByText(/^Chercher un contact$/i)).toBeInTheDocument()
  })
})

describe('EnrichContactButton — succès avec champs ajoutés', () => {
  it('affiche un toast récap, rafraîchit le router, et réactive le bouton', async () => {
    mockFetch(200, {
      data: {
        added: ['contact_email', 'contact_telephone'],
        sources: ['pappers', 'hunter'],
      },
    })

    render(<EnrichContactButton prospectId="pid-1" />)
    fireEvent.click(screen.getByRole('button'))

    // Toast succès
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
    expect(screen.getByRole('status').textContent).toMatch(/Contact trouvé/i)
    expect(screen.getByRole('status').textContent).toMatch(/email/i)
    expect(screen.getByRole('status').textContent).toMatch(/pappers/i)

    // router.refresh appelé
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1)
    })

    // Bouton réactivé
    await waitFor(() => {
      expect(screen.getByRole('button')).not.toBeDisabled()
    })

    // Body envoyé : forceReplace=false par défaut.
    expect(lastFetchBody).toBe(JSON.stringify({ forceReplace: false }))
  })
})

describe('EnrichContactButton — succès sans nouveau champ', () => {
  it('affiche un toast info "Aucun contact trouvé"', async () => {
    mockFetch(200, {
      data: { added: [], sources: [], reason: 'no_new_data' },
    })

    render(<EnrichContactButton prospectId="pid-1" />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
    expect(screen.getByRole('status').textContent).toMatch(/Aucun contact trouvé/i)
  })
})

describe('EnrichContactButton — erreurs', () => {
  it('affiche un toast erreur 503 quand quota épuisé', async () => {
    mockFetch(503, {
      error: {
        code: 'EXTERNAL_API_ERROR',
        message: "Quota d'enrichissement épuisé pour ce mois.",
      },
    })

    render(<EnrichContactButton prospectId="pid-1" />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
    expect(screen.getByRole('status').textContent).toMatch(/Quota.*épuisé/i)
    // router.refresh PAS appelé en cas d'erreur
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('affiche un toast erreur quand fetch rejette (erreur réseau)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('Network down')) as unknown as typeof fetch

    render(<EnrichContactButton prospectId="pid-1" />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
    expect(screen.getByRole('status').textContent).toMatch(/Erreur réseau/i)
  })
})

// ------------------------------------------------------------
// Cas contacts masqués
// ------------------------------------------------------------

describe('EnrichContactButton — détection contacts masqués', () => {
  it('bascule le libellé en mode "Remplacer les contacts masqués" si tous les contacts sont masqués', () => {
    render(
      <EnrichContactButton
        prospectId="pid-1"
        contacts={[
          {
            nom: '[Masqué]',
            email: '[Masqué]',
            telephone: null,
          },
        ]}
      />,
    )
    expect(screen.getByText(/Remplacer les contacts masqués/i)).toBeInTheDocument()
  })

  it('affiche le libellé "(remplace les masqués)" si seulement certains sont masqués', () => {
    render(
      <EnrichContactButton
        prospectId="pid-1"
        contacts={[
          { nom: '[Masqué]', email: null, telephone: null },
          {
            nom: 'Dupont',
            email: 'jean@acme.fr',
            telephone: '0102030405',
            email_is_pro: true,
          },
        ]}
      />,
    )
    expect(
      screen.getByText(/Chercher un contact \(remplace les masqués\)/i),
    ).toBeInTheDocument()
  })

  it('envoie forceReplace=true au backend quand un contact est masqué', async () => {
    mockFetch(200, {
      data: {
        added: ['contact_email'],
        sources: ['hunter'],
        replaced: 1,
        legacyReset: true,
      },
    })

    render(
      <EnrichContactButton
        prospectId="pid-1"
        contacts={[
          { nom: '[Masqué]', email: '[Masqué]', telephone: null },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(lastFetchBody).toBe(JSON.stringify({ forceReplace: true }))
    })

    // Toast spécifique "Contacts masqués remplacés"
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(
        /Contacts masqués remplacés/i,
      )
    })
  })

  it('affiche un toast warning quand forceReplace=true mais cascade vide', async () => {
    mockFetch(200, {
      data: {
        added: [],
        sources: [],
        replaced: 1,
        legacyReset: true,
        reason: 'replaced_no_new_data',
      },
    })

    render(
      <EnrichContactButton
        prospectId="pid-1"
        contacts={[
          { nom: '[Masqué]', email: null, telephone: null },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(
        /Contacts masqués supprimés.*aucun nouveau/i,
      )
    })

    // Refresh appelé (les masqués ont été supprimés)
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1)
    })
  })

  it('bouton expose data-force-replace=true quand masqués détectés', () => {
    render(
      <EnrichContactButton
        prospectId="pid-1"
        contacts={[{ nom: '[Masqué]', email: null, telephone: null }]}
      />,
    )
    const btn = screen.getByRole('button')
    expect(btn.getAttribute('data-force-replace')).toBe('true')
  })

  it('bouton expose data-force-replace=false sans masqué', () => {
    render(
      <EnrichContactButton
        prospectId="pid-1"
        contacts={[
          {
            nom: 'Dupont',
            email: 'jean@acme.fr',
            telephone: '0102030405',
            email_is_pro: true,
          },
        ]}
      />,
    )
    const btn = screen.getByRole('button')
    expect(btn.getAttribute('data-force-replace')).toBe('false')
  })
})
