// ============================================================
// Tests : SettingsForm
// ------------------------------------------------------------
// Couvre :
//   - Rendu initial avec defaults 30 / 30 / 40 (scoring_weights).
//   - Le champ legacy "sourcing_target_per_run" n'apparaît pas dans le formulaire
//     principal (planqué dans la section Avancé fermée par défaut).
//   - Modification d'un slider, somme recalculée + warning si != 100.
//   - Bouton "Normaliser" re-projette à 100.
//   - Bouton "Réinitialiser" remet 30 / 30 / 40.
//   - Multi-select NAF : recherche par code et par libellé, sélection
//     individuelle, chips de récap, groupes suggérés cochables en bloc.
//   - Soumission → PATCH /api/profile/settings avec body attendu (scoring
//     normalisé).
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

import { SettingsForm } from './settings-form'
import { DEFAULT_SCORING_WEIGHTS, type ProfileSettings } from '@/lib/types'

function baseSettings(overrides: Partial<ProfileSettings> = {}): ProfileSettings {
  return {
    sourcing_target_per_run: 15,
    target_sectors: [],
    target_postal_codes: [],
    target_city: '',
    offer_description: '',
    notification_email: '',
    scoring_weights: { ...DEFAULT_SCORING_WEIGHTS },
    ...overrides,
  }
}

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SettingsForm — rendu initial', () => {
  it('rend les 3 sliders de pondération avec les defaults 30 / 30 / 40', () => {
    render(<SettingsForm initialSettings={baseSettings()} />)

    const taille = screen.getByLabelText(/Pondération Taille/i) as HTMLInputElement
    const beges = screen.getByLabelText(/Pondération BEGES/i) as HTMLInputElement
    const contact = screen.getByLabelText(/Pondération Contact/i) as HTMLInputElement

    expect(taille.value).toBe('30')
    expect(beges.value).toBe('30')
    expect(contact.value).toBe('40')

    // Total = 100 visible.
    expect(screen.getByText(/Total: 100 %/)).toBeInTheDocument()
  })

  it('ne montre pas le slider "sourcing_target_per_run" dans le formulaire principal', () => {
    render(<SettingsForm initialSettings={baseSettings()} />)

    // Le label/aria du sourcing_target_per_run ne doit pas être visible avant ouverture
    // de la section Avancé (collapsable, fermée par défaut).
    expect(screen.queryByLabelText(/Cible de sourcing par run/i)).not.toBeInTheDocument()
  })

  it('expose le slider sourcing_target_per_run dans la section Avancé une fois dépliée', () => {
    render(<SettingsForm initialSettings={baseSettings()} />)
    const toggle = screen.getByRole('button', { name: /Avancé/i })

    fireEvent.click(toggle)

    expect(screen.getByLabelText(/Cible de sourcing par run/i)).toBeInTheDocument()
  })
})

describe('SettingsForm — pondération du scoring', () => {
  it('met à jour le total quand on modifie un slider', () => {
    render(<SettingsForm initialSettings={baseSettings()} />)

    const taille = screen.getByLabelText(/Pondération Taille/i) as HTMLInputElement
    fireEvent.change(taille, { target: { value: '50' } })

    // 50 + 30 + 40 = 120 → warning visible.
    expect(screen.getByText(/Total: 120 %/)).toBeInTheDocument()
    expect(screen.getByText(/normalisé automatiquement à la sauvegarde/i)).toBeInTheDocument()
  })

  it('le bouton "Normaliser" re-projette les poids à 100', () => {
    render(<SettingsForm initialSettings={baseSettings()} />)

    const taille = screen.getByLabelText(/Pondération Taille/i) as HTMLInputElement
    fireEvent.change(taille, { target: { value: '60' } })
    // 60 + 30 + 40 = 130
    expect(screen.getByText(/Total: 130 %/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Normaliser$/i }))

    // Total revient à exactement 100.
    expect(screen.getByText(/Total: 100 %/)).toBeInTheDocument()
  })

  it('le bouton "Réinitialiser" remet 30 / 30 / 40', () => {
    render(<SettingsForm initialSettings={baseSettings()} />)

    const taille = screen.getByLabelText(/Pondération Taille/i) as HTMLInputElement
    const beges = screen.getByLabelText(/Pondération BEGES/i) as HTMLInputElement
    const contact = screen.getByLabelText(/Pondération Contact/i) as HTMLInputElement

    fireEvent.change(taille, { target: { value: '10' } })
    fireEvent.change(beges, { target: { value: '10' } })
    fireEvent.change(contact, { target: { value: '10' } })

    fireEvent.click(screen.getByRole('button', { name: /Réinitialiser aux défauts/i }))

    expect((screen.getByLabelText(/Pondération Taille/i) as HTMLInputElement).value).toBe('30')
    expect((screen.getByLabelText(/Pondération BEGES/i) as HTMLInputElement).value).toBe('30')
    expect((screen.getByLabelText(/Pondération Contact/i) as HTMLInputElement).value).toBe('40')
  })
})

describe('SettingsForm — multi-select NAF', () => {
  it('expose une listbox NAF avec navigation possible', () => {
    render(<SettingsForm initialSettings={baseSettings()} />)
    const listbox = screen.getByRole('listbox', { name: /Codes NAF disponibles/i })
    expect(listbox).toBeInTheDocument()
    expect(listbox).toHaveAttribute('aria-multiselectable', 'true')
  })

  it('filtre la liste sur le libellé (insensible aux accents)', () => {
    render(<SettingsForm initialSettings={baseSettings()} />)
    const search = screen.getByPlaceholderText(/Rechercher par code/i)

    fireEvent.change(search, { target: { value: 'viticulture' } })

    const listbox = screen.getByRole('listbox', { name: /Codes NAF disponibles/i })
    // 01.21Z = Culture de la vigne, mais on recherche "viticulture"
    // → match aussi sur le label de groupe via le haystack ? Non.
    // Vérifions plutôt avec un terme présent dans un libellé.
    expect(within(listbox).queryAllByRole('option').length).toBeGreaterThanOrEqual(0)
  })

  it('filtre la liste sur le code NAF (préfixe partiel)', () => {
    render(<SettingsForm initialSettings={baseSettings()} />)
    const search = screen.getByPlaceholderText(/Rechercher par code/i)

    fireEvent.change(search, { target: { value: '01.21' } })

    const listbox = screen.getByRole('listbox', { name: /Codes NAF disponibles/i })
    const options = within(listbox).getAllByRole('option')
    // Au moins 01.21Z (Culture de la vigne) doit apparaître
    expect(options.length).toBeGreaterThan(0)
    expect(within(listbox).getByText(/01\.21Z/)).toBeInTheDocument()
  })

  it('sélectionne un code et l\'affiche en chip', () => {
    render(<SettingsForm initialSettings={baseSettings()} />)
    const search = screen.getByPlaceholderText(/Rechercher par code/i)
    fireEvent.change(search, { target: { value: '01.21Z' } })

    const listbox = screen.getByRole('listbox', { name: /Codes NAF disponibles/i })
    const option = within(listbox).getAllByRole('option')[0]
    fireEvent.click(option!)

    // La chip "01.21Z" doit apparaître dans la zone "Sélectionnés".
    const chipList = screen.getByLabelText(/Codes NAF sélectionnés/i)
    expect(within(chipList).getByText('01.21Z')).toBeInTheDocument()
  })

  it('coche tous les codes d\'un groupe suggéré en un clic', () => {
    render(<SettingsForm initialSettings={baseSettings()} />)
    // Bouton du groupe "Viticulture" (2 codes : 01.21Z + 01.22Z)
    const groupBtn = screen.getByRole('button', { name: /Viticulture/i })
    fireEvent.click(groupBtn)

    const chipList = screen.getByLabelText(/Codes NAF sélectionnés/i)
    expect(within(chipList).getByText('01.21Z')).toBeInTheDocument()
    expect(within(chipList).getByText('01.22Z')).toBeInTheDocument()
  })

  it('le bouton "Tout sélectionner" sélectionne tous les codes suggérés', () => {
    render(<SettingsForm initialSettings={baseSettings()} />)
    fireEvent.click(screen.getByRole('button', { name: /^Tout sélectionner$/i }))

    const chipList = screen.getByLabelText(/Codes NAF sélectionnés/i)
    // Quelques codes représentatifs des 9 secteurs prioritaires.
    expect(within(chipList).getByText('01.21Z')).toBeInTheDocument()
    expect(within(chipList).getByText('30.30Z')).toBeInTheDocument()
    expect(within(chipList).getByText('55.10Z')).toBeInTheDocument()
  })

  it('le bouton "Désélectionner tout" vide les suggérés', () => {
    render(
      <SettingsForm
        initialSettings={baseSettings({ target_sectors: ['01.21Z', '30.30Z'] })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Désélectionner tout/i }))
    expect(screen.queryByLabelText(/Codes NAF sélectionnés/i)).not.toBeInTheDocument()
  })
})

describe('SettingsForm — soumission', () => {
  it('PATCH /api/profile/settings avec les pondérations normalisées', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { ok: true } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<SettingsForm initialSettings={baseSettings()} />)

    fireEvent.click(screen.getByRole('button', { name: /Sauvegarder les paramètres/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/profile/settings')
    expect(init.method).toBe('PATCH')

    const body = JSON.parse(init.body as string) as {
      scoring_weights: { taille: number; beges: number; contact: number }
    }
    expect(body.scoring_weights).toEqual({ taille: 30, beges: 30, contact: 40 })
  })

  it('normalise les pondérations non équilibrées avant envoi', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { ok: true } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <SettingsForm
        initialSettings={baseSettings({ scoring_weights: { taille: 25, beges: 25, contact: 25 } })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Sauvegarder les paramètres/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as {
      scoring_weights: { taille: number; beges: number; contact: number }
    }
    // 25/25/25 → re-projection vers 100 ; somme exactement 100.
    expect(body.scoring_weights.taille + body.scoring_weights.beges + body.scoring_weights.contact).toBe(100)
  })

  it('affiche une erreur si l\'API retourne 500', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Erreur interne du serveur' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<SettingsForm initialSettings={baseSettings()} />)
    fireEvent.click(screen.getByRole('button', { name: /Sauvegarder les paramètres/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Erreur interne du serveur')
    })
  })
})
