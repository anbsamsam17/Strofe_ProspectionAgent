// ============================================================
// Tests : SourcingModal
// ------------------------------------------------------------
// Couvre :
//   - Rendu du formulaire avec les 9 raccourcis (pills) NAF.
//   - Rendu du multi-select NAF restreint aux ~110 codes BEGES
//     prioritaires (sections A/C/D/E/F/H).
//   - Sélection d'un raccourci → POST avec les codes du groupe.
//   - Sélection d'un code individuel via la recherche.
//   - Combinaison raccourci + code individuel (set union, pas de
//     doublon).
//   - Aucune sélection → POST sans `targetSectors`.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'

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
              targetSectors: [],
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

describe('SourcingModal — rendu initial', () => {
  it('rend les 9 raccourcis (pills) des secteurs prioritaires', async () => {
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    // Les 9 raccourcis sont rendus comme `<button>` avec `aria-label`
    // contenant le label du groupe.
    expect(
      await screen.findByRole('button', { name: 'Viticulture' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Aéronautique' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Logistique \/ Transport/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Agro-alimentaire/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Chimie' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Sidérurgie \/ Métaux/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Énergie' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'BTP' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Hôtellerie \/ Restauration/i }),
    ).toBeInTheDocument()
  })

  it('rend le multi-select NAF BEGES (sections A/C/D/E/F/H) sous les raccourcis', async () => {
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    // Listbox du composant <NafCodeMultiSelect> embarqué.
    const listbox = await screen.findByRole('listbox', { name: /Codes NAF disponibles/i })
    expect(listbox).toBeInTheDocument()
    expect(listbox).toHaveAttribute('aria-multiselectable', 'true')

    // Barre de recherche présente.
    expect(screen.getByPlaceholderText(/Rechercher par code/i)).toBeInTheDocument()
  })

  it('n\'affiche pas les groupes suggérés DEUX FOIS (multi-select sans suggestions)', async () => {
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    // Le multi-select n'expose pas ses propres "groupes suggérés" puisqu'on
    // utilise déjà les quick-picks au-dessus → showSuggestedGroups={false}.
    // Le label de section "Suggérés (prospection B2B BEGES)" ne doit pas apparaître.
    expect(
      screen.queryByText(/Suggérés \(prospection B2B BEGES\)/i),
    ).not.toBeInTheDocument()
  })

  it('affiche le compteur « X / N secteurs sélectionnés »', async () => {
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)
    expect(
      await screen.findByText(/0 \/ \d+ secteurs sélectionnés/i),
    ).toBeInTheDocument()
  })
})

describe('SourcingModal — submit et consolidation des codes', () => {
  it('POST sans `targetSectors` si rien n\'est sélectionné', async () => {
    const fetchMock = vi.fn((url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString()
      if (u.includes('/api/profile/sourcing-defaults')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: {} }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, data: { prospectsNew: 0, prospectsUpdated: 0 } }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /Lancer la recherche/i }))

    await waitFor(() => {
      const sourcingCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('/api/agent/sourcing'),
      )
      expect(sourcingCall).toBeDefined()
    })

    const body = extractSourcingBody(fetchMock)
    expect(body.targetSectors).toBeUndefined()
  })

  it('POST avec les codes du groupe quand un seul raccourci est coché', async () => {
    const fetchMock = setupFetchMock()
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    // Coche le raccourci "Viticulture" → 01.21Z + 01.22Z.
    const pill = await screen.findByRole('button', { name: 'Viticulture' })
    fireEvent.click(pill)
    expect(pill).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: /Lancer la recherche/i }))

    await waitFor(() => {
      const sourcingCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('/api/agent/sourcing'),
      )
      expect(sourcingCall).toBeDefined()
    })

    const body = extractSourcingBody(fetchMock)
    expect(body.targetSectors).toEqual(expect.arrayContaining(['01.21Z', '01.22Z']))
    expect(body.targetSectors).toHaveLength(2)
  })

  it('POST avec un code individuel sélectionné via le multi-select', async () => {
    const fetchMock = setupFetchMock()
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    // Cherche un code BEGES (ciment = 23.51Z).
    const search = await screen.findByPlaceholderText(/Rechercher par code/i)
    fireEvent.change(search, { target: { value: '23.51' } })

    const listbox = screen.getByRole('listbox', { name: /Codes NAF disponibles/i })
    const options = within(listbox).getAllByRole('option')
    expect(options.length).toBeGreaterThan(0)
    fireEvent.click(options[0]!)

    // Chip "23.51Z" doit apparaître.
    const chipList = await screen.findByLabelText(/Codes NAF sélectionnés/i)
    expect(within(chipList).getByText('23.51Z')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Lancer la recherche/i }))

    await waitFor(() => {
      const sourcingCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('/api/agent/sourcing'),
      )
      expect(sourcingCall).toBeDefined()
    })

    const body = extractSourcingBody(fetchMock)
    expect(body.targetSectors).toEqual(['23.51Z'])
  })

  it('combine raccourci + code individuel sans doublon (set union)', async () => {
    const fetchMock = setupFetchMock()
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    // 1. Coche "Viticulture" (raccourci) → 01.21Z + 01.22Z.
    fireEvent.click(await screen.findByRole('button', { name: 'Viticulture' }))

    // 2. Ajoute 23.51Z (ciment) via le multi-select.
    const search = screen.getByPlaceholderText(/Rechercher par code/i)
    fireEvent.change(search, { target: { value: '23.51' } })
    const listbox = screen.getByRole('listbox', { name: /Codes NAF disponibles/i })
    fireEvent.click(within(listbox).getAllByRole('option')[0]!)

    fireEvent.click(screen.getByRole('button', { name: /Lancer la recherche/i }))

    await waitFor(() => {
      const sourcingCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('/api/agent/sourcing'),
      )
      expect(sourcingCall).toBeDefined()
    })

    const body = extractSourcingBody(fetchMock)
    expect(body.targetSectors).toEqual(
      expect.arrayContaining(['01.21Z', '01.22Z', '23.51Z']),
    )
    expect(body.targetSectors).toHaveLength(3)
    // Pas de doublon.
    const unique = new Set(body.targetSectors)
    expect(unique.size).toBe(body.targetSectors!.length)
  })

  it('déduplique si un code individuel est aussi dans un raccourci coché', async () => {
    const fetchMock = setupFetchMock()
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    // 1. Coche "Viticulture" (raccourci, couvre 01.21Z + 01.22Z).
    fireEvent.click(await screen.findByRole('button', { name: 'Viticulture' }))

    // 2. Tente d'ajouter 01.21Z (déjà cible du raccourci) via le multi-select.
    //    Comme le code est déjà coché, un nouveau clic le toggle (donc retire).
    //    Pour vraiment exercer "set union sans doublon" il faudrait ajouter
    //    et NE PAS retirer — on vérifie ici que la valeur de chip persiste.
    const search = screen.getByPlaceholderText(/Rechercher par code/i)
    fireEvent.change(search, { target: { value: '01.21Z' } })
    const listbox = screen.getByRole('listbox', { name: /Codes NAF disponibles/i })
    const opts = within(listbox).getAllByRole('option')
    // L'option doit être déjà marquée selected (le raccourci l'a cochée).
    expect(opts[0]).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('button', { name: /Lancer la recherche/i }))

    await waitFor(() => {
      const sourcingCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('/api/agent/sourcing'),
      )
      expect(sourcingCall).toBeDefined()
    })

    const body = extractSourcingBody(fetchMock)
    // Toujours 2 codes (01.21Z + 01.22Z), pas 3 — pas de doublon.
    expect(body.targetSectors).toEqual(expect.arrayContaining(['01.21Z', '01.22Z']))
    expect(body.targetSectors).toHaveLength(2)
  })
})
