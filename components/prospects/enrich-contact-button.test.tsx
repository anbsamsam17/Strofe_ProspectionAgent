// ============================================================
// Tests : EnrichContactButton
// ------------------------------------------------------------
// Couvre :
//   - Rendu initial : libellé "Vérifier maintenant" + bouton actif.
//   - Click → POST /api/prospects/<id>/enrich + toast succès + refresh().
//   - Succès sans champ ajouté → toast info "Aucune nouvelle donnée".
//   - Erreur 503 quota → toast rouge avec message provider.
//   - Erreur réseau (rejection fetch) → toast rouge.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

// Mock useRouter — on n'a pas besoin d'un vrai router en test.
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn(), replace: vi.fn() }),
}))

import { EnrichContactButton } from './enrich-contact-button'

// Helper : prépare un mock global.fetch qui renvoie une Response JSON-like.
function mockFetch(status: number, payload: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
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
  it('rend le libellé "Vérifier maintenant" et un bouton activé', () => {
    render(<EnrichContactButton prospectId="pid-1" />)
    const btn = screen.getByRole('button', { name: /enrichissement contact/i })
    expect(btn).toBeInTheDocument()
    expect(btn).not.toBeDisabled()
    expect(screen.getByText(/Vérifier maintenant/i)).toBeInTheDocument()
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
    expect(screen.getByRole('status').textContent).toMatch(/Enrichi/i)
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
  })
})

describe('EnrichContactButton — succès sans nouveau champ', () => {
  it('affiche un toast info "Aucune nouvelle donnée"', async () => {
    mockFetch(200, {
      data: { added: [], sources: [], reason: 'no_new_data' },
    })

    render(<EnrichContactButton prospectId="pid-1" />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
    expect(screen.getByRole('status').textContent).toMatch(/Aucune nouvelle donnée/i)
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
