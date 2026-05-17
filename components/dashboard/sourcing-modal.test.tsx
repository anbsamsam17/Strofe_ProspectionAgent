// ============================================================
// Tests : SourcingModal (post-simplification 2026-05-17)
// ------------------------------------------------------------
// La section "Secteurs cibles" (raccourcis + multi-select NAF)
// est désactivée tant que Sirene n'accepte pas la query NAF
// (cf. hindsight 2026-05-17 HTTP 400). On envoie systématiquement
// `targetSectors: []` au backend.
//
// Couvre :
//   - Rendu du formulaire avec effectif + zone géo uniquement.
//   - Absence de la section "Secteurs cibles" (legend, pills,
//     multi-select listbox, compteur).
//   - Submit → body { effectifMin, effectifMax, targetSectors: [] }.
//   - Conservation du champ "Zone géographique" dans le body.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

// Mock hooks avant l'import du composant (Vitest hoist).
vi.mock('@/lib/hooks/use-agent-run-status', () => ({
  useAgentRunStatus: () => ({ isRunning: false, run: null, isLoading: false }),
}))

import { SourcingModal } from './sourcing-modal'

// ── Helpers ───────────────────────────────────────────────────────────────────

interface FetchCallBody {
  effectifMin: number
  effectifMax: number
  targetSectors?: string[]
  targetRegion?: string
}

/**
 * Mock /api/profile/sourcing-defaults (hydratation) + /api/agent/sourcing (run).
 * Le premier appel renvoie un profil vide, le second un run "OK".
 */
function setupFetchMock(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString()
    if (u.includes('/api/profile/sourcing-defaults')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: {
              targetRegion: '',
              effectifMin: 50,
              effectifMax: 500,
            },
          }),
      })
    }
    // Cas par défaut : /api/agent/sourcing
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          ok: true,
          data: {
            prospectsNew: 0,
            prospectsUpdated: 0,
            prospectsQualified: 0,
            totalAvailable: 0,
            exhausted: false,
            universeEmpty: true,
            pagesLoaded: 0,
            durationMs: 0,
          },
        }),
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/**
 * Récupère le body JSON envoyé sur le 1er appel /api/agent/sourcing
 * (en ignorant l'appel d'hydratation /api/profile/sourcing-defaults).
 */
function extractSourcingBody(fetchMock: ReturnType<typeof vi.fn>): FetchCallBody {
  const call = fetchMock.mock.calls.find(
    (c) => typeof c[0] === 'string' && c[0].includes('/api/agent/sourcing'),
  )
  if (!call) throw new Error('No /api/agent/sourcing call recorded')
  const init = call[1] as RequestInit | undefined
  if (!init?.body) throw new Error('No body on sourcing call')
  return JSON.parse(init.body as string) as FetchCallBody
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  setupFetchMock()
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SourcingModal — rendu initial (simplifié, sans NAF)', () => {
  it('rend les champs effectif min/max et la zone géographique', async () => {
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    expect(await screen.findByLabelText(/Minimum/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Maximum/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Zone géographique/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Lancer la recherche/i }),
    ).toBeInTheDocument()
  })

  it('n\'affiche plus la section "Secteurs cibles" (legend retirée)', async () => {
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)
    // Attendre que la modal soit rendue (firstFocusable disponible).
    await screen.findByLabelText(/Minimum/i)

    expect(screen.queryByText(/Secteurs cibles/i)).not.toBeInTheDocument()
  })

  it('n\'affiche plus les raccourcis (pills) de groupes NAF', async () => {
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)
    await screen.findByLabelText(/Minimum/i)

    // Les 9 anciens raccourcis ne doivent plus exister.
    expect(
      screen.queryByRole('button', { name: 'Viticulture' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Aéronautique' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'BTP' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Chimie' })).not.toBeInTheDocument()
  })

  it('n\'affiche plus le multi-select NAF BEGES (listbox + barre de recherche)', async () => {
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)
    await screen.findByLabelText(/Minimum/i)

    expect(
      screen.queryByRole('listbox', { name: /Codes NAF disponibles/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByPlaceholderText(/Rechercher par code/i),
    ).not.toBeInTheDocument()
  })

  it('n\'affiche plus le compteur « X / N secteurs sélectionnés »', async () => {
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)
    await screen.findByLabelText(/Minimum/i)

    expect(
      screen.queryByText(/secteurs sélectionnés/i),
    ).not.toBeInTheDocument()
  })
})

describe('SourcingModal — submit (targetSectors: [] systématique)', () => {
  it('POST avec `targetSectors: []` (tableau vide) et les valeurs effectif', async () => {
    const fetchMock = setupFetchMock()
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    fireEvent.click(
      await screen.findByRole('button', { name: /Lancer la recherche/i }),
    )

    await waitFor(() => {
      const sourcingCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('/api/agent/sourcing'),
      )
      expect(sourcingCall).toBeDefined()
    })

    const body = extractSourcingBody(fetchMock)
    expect(body.targetSectors).toEqual([])
    expect(Array.isArray(body.targetSectors)).toBe(true)
    expect(body.effectifMin).toBe(50)
    expect(body.effectifMax).toBe(500)
  })

  it('transmet le champ "Zone géographique" quand renseigné', async () => {
    const fetchMock = setupFetchMock()
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    const regionInput = await screen.findByLabelText(/Zone géographique/i)
    fireEvent.change(regionInput, { target: { value: 'IDF' } })

    fireEvent.click(
      screen.getByRole('button', { name: /Lancer la recherche/i }),
    )

    await waitFor(() => {
      const sourcingCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('/api/agent/sourcing'),
      )
      expect(sourcingCall).toBeDefined()
    })

    const body = extractSourcingBody(fetchMock)
    expect(body.targetRegion).toBe('IDF')
    expect(body.targetSectors).toEqual([])
  })

  it('omet `targetRegion` si laissé vide (trim → "")', async () => {
    const fetchMock = setupFetchMock()
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    // Laisse la zone géo vide (valeur par défaut '').
    fireEvent.click(
      await screen.findByRole('button', { name: /Lancer la recherche/i }),
    )

    await waitFor(() => {
      const sourcingCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('/api/agent/sourcing'),
      )
      expect(sourcingCall).toBeDefined()
    })

    const body = extractSourcingBody(fetchMock)
    expect(body.targetRegion).toBeUndefined()
    expect(body.targetSectors).toEqual([])
  })

  it('respecte les nouvelles valeurs d\'effectif saisies par l\'utilisateur', async () => {
    const fetchMock = setupFetchMock()
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    const min = await screen.findByLabelText(/Minimum/i)
    const max = screen.getByLabelText(/Maximum/i)
    fireEvent.change(min, { target: { value: '100' } })
    fireEvent.change(max, { target: { value: '999' } })

    fireEvent.click(
      screen.getByRole('button', { name: /Lancer la recherche/i }),
    )

    await waitFor(() => {
      const sourcingCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('/api/agent/sourcing'),
      )
      expect(sourcingCall).toBeDefined()
    })

    const body = extractSourcingBody(fetchMock)
    expect(body.effectifMin).toBe(100)
    expect(body.effectifMax).toBe(999)
    expect(body.targetSectors).toEqual([])
  })

  it('bloque le submit si effectifMin > effectifMax (régression effectif)', async () => {
    const fetchMock = setupFetchMock()
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    const min = await screen.findByLabelText(/Minimum/i)
    const max = screen.getByLabelText(/Maximum/i)
    fireEvent.change(min, { target: { value: '500' } })
    fireEvent.change(max, { target: { value: '100' } })

    fireEvent.click(
      screen.getByRole('button', { name: /Lancer la recherche/i }),
    )

    // Le submit doit échouer côté validation client → aucun appel /api/agent/sourcing.
    await screen.findByRole('alert')
    const sourcingCall = fetchMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('/api/agent/sourcing'),
    )
    expect(sourcingCall).toBeUndefined()
  })
})
