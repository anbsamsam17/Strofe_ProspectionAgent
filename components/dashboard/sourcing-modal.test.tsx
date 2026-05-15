// ============================================================
// Tests : SourcingModal
// ------------------------------------------------------------
// Couvre :
//   - Rendu du formulaire avec les 9 groupes suggérés (quick picks).
//   - Rendu du multi-select NAF (501 codes) à côté des groupes.
//   - Combinaison des 2 modes au submit → set union dédupliqué.
//   - Sélection d'un groupe seul → POST avec les codes du groupe.
//   - Sélection d'un code individuel seul → POST avec ce code.
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
  it('rend les 9 groupes suggérés en quick picks', async () => {
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    // Les labels des 9 secteurs prioritaires doivent être présents.
    expect(await screen.findByText(/Viticulture/i)).toBeInTheDocument()
    expect(screen.getByText(/Aéronautique/i)).toBeInTheDocument()
    expect(screen.getByText(/Logistique \/ Transport/i)).toBeInTheDocument()
    expect(screen.getByText(/Agro-alimentaire/i)).toBeInTheDocument()
    expect(screen.getByText(/Chimie/i)).toBeInTheDocument()
    expect(screen.getByText(/Sidérurgie \/ Métaux/i)).toBeInTheDocument()
    expect(screen.getByText(/Énergie/i)).toBeInTheDocument()
    expect(screen.getByText(/^BTP$/i)).toBeInTheDocument()
    expect(screen.getByText(/Hôtellerie \/ Restauration/i)).toBeInTheDocument()
  })

  // SKIP : le composant <NafCodeMultiSelect> n'est plus inclus dans la modal
  // (sourcing-modal.tsx utilise uniquement les checkboxes de groupes NAF_GROUPS_SUGGESTED).
  // Réactiver ce test si le multi-select 501 codes individuels est réintroduit.
  it.skip('rend le multi-select NAF (501 codes) à côté des groupes', async () => {
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    // Listbox NAF du composant <NafCodeMultiSelect> embarqué.
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

  it('POST avec les codes du groupe quand un seul groupe est coché', async () => {
    const fetchMock = setupFetchMock()
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    // Coche le groupe "Viticulture" → 01.21Z + 01.22Z.
    const checkbox = (await screen.findByLabelText('Viticulture')) as HTMLInputElement
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)

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

  // SKIP : cf commentaire au-dessus — multi-select NAF non présent.
  it.skip('POST avec un code individuel sélectionné via le multi-select', async () => {
    const fetchMock = setupFetchMock()
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    // Cherche un code spécifique (cabinet de conseil = 70.22Z).
    const search = await screen.findByPlaceholderText(/Rechercher par code/i)
    fireEvent.change(search, { target: { value: '70.22Z' } })

    const listbox = screen.getByRole('listbox', { name: /Codes NAF disponibles/i })
    const options = within(listbox).getAllByRole('option')
    expect(options.length).toBeGreaterThan(0)
    fireEvent.click(options[0]!)

    // Chip "70.22Z" doit apparaître.
    const chipList = await screen.findByLabelText(/Codes NAF sélectionnés/i)
    expect(within(chipList).getByText('70.22Z')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Lancer la recherche/i }))

    await waitFor(() => {
      const sourcingCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('/api/agent/sourcing'),
      )
      expect(sourcingCall).toBeDefined()
    })

    const body = extractSourcingBody(fetchMock)
    expect(body.targetSectors).toEqual(['70.22Z'])
  })

  // SKIP : cf commentaire au-dessus — multi-select NAF non présent.
  it.skip('combine groupe + code individuel sans doublon (set union)', async () => {
    const fetchMock = setupFetchMock()
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    // 1. Coche "Viticulture" → 01.21Z + 01.22Z.
    fireEvent.click(await screen.findByLabelText('Viticulture'))

    // 2. Ajoute 70.22Z (cabinet de conseil) via le multi-select.
    const search = screen.getByPlaceholderText(/Rechercher par code/i)
    fireEvent.change(search, { target: { value: '70.22Z' } })
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
      expect.arrayContaining(['01.21Z', '01.22Z', '70.22Z']),
    )
    expect(body.targetSectors).toHaveLength(3)
    // Pas de doublon.
    const unique = new Set(body.targetSectors)
    expect(unique.size).toBe(body.targetSectors!.length)
  })

  // SKIP : cf commentaire au-dessus — multi-select NAF non présent.
  it.skip('déduplique si un code individuel est aussi dans un groupe coché', async () => {
    const fetchMock = setupFetchMock()
    render(<SourcingModal isOpen={true} onClose={vi.fn()} />)

    // 1. Coche "Viticulture" (couvre 01.21Z + 01.22Z).
    fireEvent.click(await screen.findByLabelText('Viticulture'))

    // 2. Ajoute aussi 01.21Z individuellement (collision).
    const search = screen.getByPlaceholderText(/Rechercher par code/i)
    fireEvent.change(search, { target: { value: '01.21Z' } })
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
    // Toujours 2 codes (01.21Z + 01.22Z), pas 3 — le doublon a sauté.
    expect(body.targetSectors).toEqual(expect.arrayContaining(['01.21Z', '01.22Z']))
    expect(body.targetSectors).toHaveLength(2)
  })
})
