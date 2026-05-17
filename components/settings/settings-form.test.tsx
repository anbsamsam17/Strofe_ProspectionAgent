// ============================================================
// Tests : SettingsForm (UI minimaliste post-2026-05-17)
// ------------------------------------------------------------
// L'UI ne contient plus que 2 sections du formulaire (Pondération + Notifications).
// La section "Mon compte" (avec déconnexion) est rendue par la page parente,
// pas par SettingsForm — testée indirectement via la non-régression des sections
// gardées et l'absence des sections retirées.
//
// Couvre :
//   - Rendu initial avec defaults 30 / 30 / 40 (scoring_weights).
//   - Présence section Notifications (champ email).
//   - Modification d'un slider, somme recalculée + warning si != 100.
//   - Bouton "Normaliser" re-projette à 100.
//   - Bouton "Réinitialiser" remet 30 / 30 / 40.
//   - Soumission → PATCH /api/profile/settings avec body attendu (scoring
//     normalisé). Le payload conserve les autres champs (offer_description,
//     target_sectors, ...) même si l'UI ne les expose plus.
//   - Sections retirées absentes du DOM (Secteurs, Zone géo, Offre, Avancé).
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

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

describe('SettingsForm — sections gardées (UI minimaliste)', () => {
  it('rend la section Pondération avec les 3 sliders et les defaults 30 / 30 / 40', () => {
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

  it('rend la section Notifications avec le champ email', () => {
    render(<SettingsForm initialSettings={baseSettings({ notification_email: 'jane@example.com' })} />)

    const emailInput = screen.getByLabelText(/Email de notification/i) as HTMLInputElement
    expect(emailInput).toBeInTheDocument()
    expect(emailInput.type).toBe('email')
    expect(emailInput.value).toBe('jane@example.com')
  })
})

describe('SettingsForm — sections retirées (UI minimaliste)', () => {
  it('n\'affiche plus la section "Secteurs cibles" (multi-select NAF)', () => {
    render(<SettingsForm initialSettings={baseSettings()} />)
    expect(screen.queryByRole('listbox', { name: /Codes NAF disponibles/i })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Rechercher par code/i)).not.toBeInTheDocument()
  })

  it('n\'affiche plus la section "Zone géographique" (ville + codes postaux)', () => {
    render(<SettingsForm initialSettings={baseSettings()} />)
    expect(screen.queryByLabelText(/Ville \/ région/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Codes postaux/i)).not.toBeInTheDocument()
  })

  it('n\'affiche plus la section "Offre commerciale" (textarea)', () => {
    render(<SettingsForm initialSettings={baseSettings()} />)
    expect(screen.queryByLabelText(/Description de l'offre/i)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Nous accompagnons les ETI/i)).not.toBeInTheDocument()
  })

  it('n\'affiche plus la section "Avancé" (sourcing_target_per_run)', () => {
    render(<SettingsForm initialSettings={baseSettings()} />)
    expect(screen.queryByRole('button', { name: /^Avancé/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Cible de sourcing par run/i)).not.toBeInTheDocument()
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

describe('SettingsForm — notifications', () => {
  it('met à jour la valeur saisie dans le champ email', () => {
    render(<SettingsForm initialSettings={baseSettings()} />)
    const emailInput = screen.getByLabelText(/Email de notification/i) as HTMLInputElement

    fireEvent.change(emailInput, { target: { value: 'samir@strofe.fr' } })

    expect(emailInput.value).toBe('samir@strofe.fr')
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

  it('préserve les champs persistés masqués dans le payload (rétrocompat backend)', async () => {
    // Garantit que même si l'UI ne montre plus offer_description / target_sectors / etc.,
    // le PATCH continue d'envoyer les valeurs existantes — pas de wipe côté DB.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { ok: true } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <SettingsForm
        initialSettings={baseSettings({
          offer_description: 'Bilan carbone BEGES réglementaire',
          target_sectors: ['01.21Z', '30.30Z'],
          target_city: 'Lyon',
          target_postal_codes: ['69001', '69002'],
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Sauvegarder les paramètres/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as {
      offer_description?: string
      target_sectors?: string[]
      target_city?: string
      target_postal_codes?: string[]
    }
    expect(body.offer_description).toBe('Bilan carbone BEGES réglementaire')
    expect(body.target_sectors).toEqual(['01.21Z', '30.30Z'])
    expect(body.target_city).toBe('Lyon')
    expect(body.target_postal_codes).toEqual(['69001', '69002'])
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
