// ============================================================
// Tests unitaires — DailyListClient
// Focus : filtrage des prospects sans point de contact
//         (téléphone OU email OU LinkedIn requis).
// Mock du composant ProspectCard pour isoler la logique de filtre.
// ============================================================

import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { DailyListItem, Prospect } from '@/lib/types'

// Mock ProspectCard : on rend juste le nom du prospect, on ne teste pas la card.
vi.mock('./prospect-card', () => ({
  ProspectCard: ({ item }: { item: DailyListItem & { prospect: Prospect } }) => (
    <div data-testid="prospect-card">{item.prospect.raison_sociale}</div>
  ),
}))

import { DailyListClient } from './daily-list-client'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: 'p-id',
    user_id: 'u-id',
    siren: '123456789',
    raison_sociale: 'Entreprise Test',
    beges_publie: false,
    obligation_beges: false,
    score_priorite: 50,
    score_details: {
      obligation_beges: 0,
      secteur_prioritaire: 0,
      beges_non_publie: 0,
      signaux_intention: 0,
      taille_entreprise: 0,
      contact_trouve: 0,
      penalite_deja_contacte: 0,
      penalite_rejete: 0,
    },
    signaux: [],
    statut: 'qualified',
    source: 'sirene_api',
    created_at: '2026-05-12T00:00:00Z',
    updated_at: '2026-05-12T00:00:00Z',
    ...overrides,
  }
}

function makeItem(
  id: string,
  prospect: Prospect,
  overrides: Partial<DailyListItem> = {},
): DailyListItem & { prospect: Prospect } {
  return {
    id,
    daily_list_id: 'dl-id',
    user_id: 'u-id',
    prospect_id: prospect.id,
    prospect,
    ordre: 1,
    priorite: 'normale',
    signaux_detectes: [],
    objections_reponses: [],
    created_at: '2026-05-12T00:00:00Z',
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DailyListClient — filtre point de contact', () => {
  it('affiche tous les prospects ayant au moins un canal de contact', () => {
    const items = [
      makeItem('i1', makeProspect({ id: 'p1', raison_sociale: 'Avec Tel', contact_telephone: '0102030405' })),
      makeItem('i2', makeProspect({ id: 'p2', raison_sociale: 'Avec Mail', contact_email: 'foo@bar.fr' })),
      makeItem('i3', makeProspect({ id: 'p3', raison_sociale: 'Avec LinkedIn', contact_linkedin: 'https://linkedin.com/in/x' })),
    ]

    render(<DailyListClient initialItems={items} />)

    const cards = screen.getAllByTestId('prospect-card')
    expect(cards).toHaveLength(3)
    expect(screen.getByText('Avec Tel')).toBeInTheDocument()
    expect(screen.getByText('Avec Mail')).toBeInTheDocument()
    expect(screen.getByText('Avec LinkedIn')).toBeInTheDocument()
  })

  it('masque les prospects sans aucun canal de contact (par défaut)', () => {
    const items = [
      makeItem('i1', makeProspect({ id: 'p1', raison_sociale: 'Avec Tel', contact_telephone: '0102030405' })),
      makeItem('i2', makeProspect({ id: 'p2', raison_sociale: 'Sans Contact' })),
    ]

    render(<DailyListClient initialItems={items} />)

    const cards = screen.getAllByTestId('prospect-card')
    expect(cards).toHaveLength(1)
    expect(screen.getByText('Avec Tel')).toBeInTheDocument()
    expect(screen.queryByText('Sans Contact')).not.toBeInTheDocument()
  })

  it('affiche le compteur "X prospect(s) écarté(s)" quand des prospects sont filtrés', () => {
    const items = [
      makeItem('i1', makeProspect({ id: 'p1', raison_sociale: 'Avec Tel', contact_telephone: '0102030405' })),
      makeItem('i2', makeProspect({ id: 'p2', raison_sociale: 'Sans Contact 1' })),
      makeItem('i3', makeProspect({ id: 'p3', raison_sociale: 'Sans Contact 2' })),
    ]

    render(<DailyListClient initialItems={items} />)

    expect(screen.getByText(/2/)).toBeInTheDocument()
    expect(screen.getByText(/écartés/)).toBeInTheDocument()
    expect(screen.getByText(/pas de point de contact/i)).toBeInTheDocument()
  })

  it('toggle "Voir tous" affiche aussi les prospects sans contact', () => {
    const items = [
      makeItem('i1', makeProspect({ id: 'p1', raison_sociale: 'Avec Tel', contact_telephone: '0102030405' })),
      makeItem('i2', makeProspect({ id: 'p2', raison_sociale: 'Sans Contact' })),
    ]

    render(<DailyListClient initialItems={items} />)

    // Avant toggle : 1 prospect visible
    expect(screen.getAllByTestId('prospect-card')).toHaveLength(1)

    // Clic sur "Voir tous"
    fireEvent.click(screen.getByRole('button', { name: /voir tous/i }))

    // Après toggle : 2 prospects visibles
    expect(screen.getAllByTestId('prospect-card')).toHaveLength(2)
    expect(screen.getByText('Sans Contact')).toBeInTheDocument()
  })

  it('ne montre pas le bandeau quand tous les prospects ont un contact', () => {
    const items = [
      makeItem('i1', makeProspect({ id: 'p1', raison_sociale: 'Avec Tel', contact_telephone: '0102030405' })),
    ]

    render(<DailyListClient initialItems={items} />)

    expect(screen.queryByText(/écarté/i)).not.toBeInTheDocument()
  })
})
