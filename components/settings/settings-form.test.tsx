// ============================================================
// Tests : SettingsForm
// ------------------------------------------------------------
// Couvre :
//   - Rendu initial avec defaults 30 / 30 / 40 (scoring_weights).
//   - Le champ legacy "daily_call_target" n'apparaît pas dans le formulaire
//     principal (planqué dans la section Avancé fermée par défaut).
//   - Modification d'un slider, somme recalculée + warning si != 100.
//   - Bouton "Normaliser" re-projette à 100.
//   - Bouton "Réinitialiser" remet 30 / 30 / 40.
//   - Soumission → PATCH /api/profile/settings avec body attendu (scoring
//     normalisé).
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

import { SettingsForm } from './settings-form'
import { DEFAULT_SCORING_WEIGHTS, type ProfileSettings } from '@/lib/types'

const SECTEURS = ['Industrie manufacturière', 'Transport et logistique']

function baseSettings(overrides: Partial<ProfileSettings> = {}): ProfileSettings {
  return {
    daily_call_target: 15,
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
    render(<SettingsForm initialSettings={baseSettings()} secteursDisponibles={SECTEURS} />)

    const taille = screen.getByLabelText(/Pondération Taille/i) as HTMLInputElement
    const beges = screen.getByLabelText(/Pondération BEGES/i) as HTMLInputElement
    const contact = screen.getByLabelText(/Pondération Contact/i) as HTMLInputElement

    expect(taille.value).toBe('30')
    expect(beges.value).toBe('30')
    expect(contact.value).toBe('40')

    // Total = 100 visible.
    expect(screen.getByText(/Total: 100 %/)).toBeInTheDocument()
  })

  it('ne montre pas le slider "appels par jour" dans le formulaire principal', () => {
    render(<SettingsForm initialSettings={baseSettings()} secteursDisponibles={SECTEURS} />)

    // Le label/aria du daily_call_target ne doit pas être visible avant ouverture
    // de la section Avancé (collapsable, fermée par défaut).
    expect(screen.queryByLabelText(/Objectif d'appels par jour/i)).not.toBeInTheDocument()
  })

  it('expose le slider legacy dans la section Avancé une fois dépliée', () => {
    render(<SettingsForm initialSettings={baseSettings()} secteursDisponibles={SECTEURS} />)
    const toggle = screen.getByRole('button', { name: /Avancé/i })

    fireEvent.click(toggle)

    expect(screen.getByLabelText(/Objectif d'appels par jour/i)).toBeInTheDocument()
  })
})

describe('SettingsForm — pondération du scoring', () => {
  it('met à jour le total quand on modifie un slider', () => {
    render(<SettingsForm initialSettings={baseSettings()} secteursDisponibles={SECTEURS} />)

    const taille = screen.getByLabelText(/Pondération Taille/i) as HTMLInputElement
    fireEvent.change(taille, { target: { value: '50' } })

    // 50 + 30 + 40 = 120 → warning visible.
    expect(screen.getByText(/Total: 120 %/)).toBeInTheDocument()
    expect(screen.getByText(/normalisé automatiquement à la sauvegarde/i)).toBeInTheDocument()
  })

  it('le bouton "Normaliser" re-projette les poids à 100', () => {
    render(<SettingsForm initialSettings={baseSettings()} secteursDisponibles={SECTEURS} />)

    const taille = screen.getByLabelText(/Pondération Taille/i) as HTMLInputElement
    fireEvent.change(taille, { target: { value: '60' } })
    // 60 + 30 + 40 = 130
    expect(screen.getByText(/Total: 130 %/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Normaliser$/i }))

    // Total revient à exactement 100.
    expect(screen.getByText(/Total: 100 %/)).toBeInTheDocument()
  })

  it('le bouton "Réinitialiser" remet 30 / 30 / 40', () => {
    render(<SettingsForm initialSettings={baseSettings()} secteursDisponibles={SECTEURS} />)

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

describe('SettingsForm — soumission', () => {
  it('PATCH /api/profile/settings avec les pondérations normalisées', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { ok: true } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<SettingsForm initialSettings={baseSettings()} secteursDisponibles={SECTEURS} />)

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
        secteursDisponibles={SECTEURS}
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

    render(<SettingsForm initialSettings={baseSettings()} secteursDisponibles={SECTEURS} />)
    fireEvent.click(screen.getByRole('button', { name: /Sauvegarder les paramètres/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Erreur interne du serveur')
    })
  })
})
