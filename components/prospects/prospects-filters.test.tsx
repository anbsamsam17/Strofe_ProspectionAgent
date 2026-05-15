// ============================================================
// Tests : ProspectsFilters (composant filtres page Prospects)
// ------------------------------------------------------------
// Couvre :
//   - Rendu nominal (tous les inputs présents).
//   - Click sur une pill statut → toggle + router.push(?statut=...).
//   - Multi-select statut (2 statuts → ?statut=sourced,qualified).
//   - Multi-select type de contact (téléphone / mail / linkedin).
//   - Input secteur : submit via Enter → ?secteur=industrie.
//   - Score min (range) → ?score_min=50.
//   - Toggle archives → ?archived=1.
//   - Bouton "Réinitialiser" caché si aucun filtre, visible sinon.
//   - Click "Réinitialiser" → push /prospects (sans queryparams).
//   - Labels statuts conformes à la spec (offer_sent = "Offre envoyée", etc.).
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

// ── Mock next/navigation ─────────────────────────────────────────────────────
// Le composant utilise useRouter().push pour propager les filtres dans l'URL.
// On capture push via une référence externe lue dans les assertions.
const mockPush = vi.fn()
const mockRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/prospects',
}))

// Import APRÈS le mock (Vitest hoist les vi.mock).
import { ProspectsFilters } from './prospects-filters'

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockPush.mockReset()
  mockRefresh.mockReset()
})

afterEach(() => {
  cleanup()
})

// Default props : aucun filtre actif.
const defaultProps = {
  currentStatuts: [],
  currentSecteur: '',
  currentScoreMin: 0,
  currentArchived: false,
  currentContactTypes: [] as ('phone' | 'email' | 'linkedin')[],
}

// Helper : la dernière URL pushée (string complète relative à /prospects).
function lastPushedUrl(): string {
  expect(mockPush).toHaveBeenCalled()
  const calls = mockPush.mock.calls
  return calls[calls.length - 1][0] as string
}

// Helper : parse les query params de la dernière URL pushée.
function lastPushedParams(): URLSearchParams {
  const url = lastPushedUrl()
  const qIdx = url.indexOf('?')
  return new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : '')
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDU NOMINAL
// ─────────────────────────────────────────────────────────────────────────────

describe('ProspectsFilters — rendu nominal', () => {
  it('affiche tous les inputs principaux (statuts, secteur, score, contact, archives)', () => {
    // Arrange + Act
    render(<ProspectsFilters {...defaultProps} />)

    // Assert : 9 pills de statut présents (8 historiques + do_not_contact mig.017)
    const statutGroup = screen.getByRole('group', { name: /Filtrer par statut/i })
    expect(within(statutGroup).getAllByRole('button')).toHaveLength(9)

    // Assert : input secteur
    expect(screen.getByLabelText(/Secteur/i)).toBeInTheDocument()

    // Assert : input score (range)
    expect(screen.getByLabelText(/Score minimum/i)).toBeInTheDocument()

    // Assert : 3 boutons de type de contact
    const contactGroup = screen.getByRole('group', {
      name: /Filtrer par canal de contact disponible/i,
    })
    expect(within(contactGroup).getAllByRole('button')).toHaveLength(3)

    // Assert : toggle archives
    expect(
      screen.getByRole('button', { name: /Voir les archivés/i }),
    ).toBeInTheDocument()
  })

  it('affiche les labels statuts conformes à la spec (libellés localisés)', () => {
    // Arrange + Act
    render(<ProspectsFilters {...defaultProps} />)

    // Assert : tous les libellés métier exigés par le brief
    expect(screen.getByRole('button', { name: /Pas de contact identifié/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Qualifié$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Contacté$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Intéressé$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Offre envoyée/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Affaire conclue/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sans suite/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /En stand-by/i })).toBeInTheDocument()
    // Migration 017 : nouveau pill "Ne pas contacter" (opt-out manuel utilisateur).
    expect(screen.getByRole('button', { name: /Ne pas contacter/i })).toBeInTheDocument()
  })

  it('click sur "Ne pas contacter" pousse ?statut=do_not_contact', () => {
    render(<ProspectsFilters {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /Ne pas contacter/i }))
    expect(lastPushedParams().get('statut')).toBe('do_not_contact')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// FILTRE STATUT — multi-select via pills
// ─────────────────────────────────────────────────────────────────────────────

describe('ProspectsFilters — filtre statut', () => {
  it('click sur une pill statut pousse ?statut=sourced dans l\'URL', () => {
    // Arrange
    render(<ProspectsFilters {...defaultProps} />)

    // Act : clic sur le statut "Pas de contact identifié" (= sourced)
    fireEvent.click(screen.getByRole('button', { name: /Pas de contact identifié/i }))

    // Assert
    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(lastPushedParams().get('statut')).toBe('sourced')
    // Pagination réinitialisée à 1 à chaque changement de filtre.
    expect(lastPushedParams().get('page')).toBe('1')
  })

  it('multi-select : 2 statuts sélectionnés → param statut=sourced,qualified', () => {
    // Arrange
    render(<ProspectsFilters {...defaultProps} />)

    // Act : sélectionne 2 statuts successivement
    fireEvent.click(screen.getByRole('button', { name: /Pas de contact identifié/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Qualifié$/i }))

    // Assert : 2 appels push, le dernier avec les 2 valeurs jointes par virgule
    expect(mockPush).toHaveBeenCalledTimes(2)
    expect(lastPushedParams().get('statut')).toBe('sourced,qualified')
  })

  it('deselect : reclick sur un statut actif le retire de l\'URL', () => {
    // Arrange : on démarre avec sourced déjà sélectionné côté props
    render(<ProspectsFilters {...defaultProps} currentStatuts={['sourced']} />)

    // Act : reclick pour désélectionner
    fireEvent.click(screen.getByRole('button', { name: /Pas de contact identifié/i }))

    // Assert : statut absent de l'URL (clé supprimée)
    expect(lastPushedParams().has('statut')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// FILTRE CONTACT TYPE — multi-select
// ─────────────────────────────────────────────────────────────────────────────

describe('ProspectsFilters — filtre type de contact', () => {
  it('click sur "Téléphone" pousse ?contact_type=phone', () => {
    // Arrange
    render(<ProspectsFilters {...defaultProps} />)
    const contactGroup = screen.getByRole('group', {
      name: /Filtrer par canal de contact disponible/i,
    })

    // Act
    fireEvent.click(within(contactGroup).getByRole('button', { name: /Téléphone/i }))

    // Assert
    expect(lastPushedParams().get('contact_type')).toBe('phone')
  })

  it('multi-select : phone + email → ?contact_type=phone,email', () => {
    // Arrange
    render(<ProspectsFilters {...defaultProps} />)
    const contactGroup = screen.getByRole('group', {
      name: /Filtrer par canal de contact disponible/i,
    })

    // Act
    fireEvent.click(within(contactGroup).getByRole('button', { name: /Téléphone/i }))
    fireEvent.click(within(contactGroup).getByRole('button', { name: /Email/i }))

    // Assert
    expect(lastPushedParams().get('contact_type')).toBe('phone,email')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// FILTRE SECTEUR — input texte
// ─────────────────────────────────────────────────────────────────────────────

describe('ProspectsFilters — filtre secteur', () => {
  it('saisie + Enter pousse ?secteur=industrie', () => {
    // Arrange
    render(<ProspectsFilters {...defaultProps} />)
    const input = screen.getByLabelText(/Secteur/i)

    // Act
    fireEvent.change(input, { target: { value: 'industrie' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // Assert
    expect(lastPushedParams().get('secteur')).toBe('industrie')
  })

  it('blur applique aussi le secteur (apply on blur)', () => {
    // Arrange
    render(<ProspectsFilters {...defaultProps} />)
    const input = screen.getByLabelText(/Secteur/i)

    // Act
    fireEvent.change(input, { target: { value: 'transport' } })
    fireEvent.blur(input)

    // Assert
    expect(lastPushedParams().get('secteur')).toBe('transport')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// FILTRE SCORE MIN — range input
// ─────────────────────────────────────────────────────────────────────────────

describe('ProspectsFilters — filtre score min', () => {
  it('changement du range pousse ?score_min=50', () => {
    // Arrange
    render(<ProspectsFilters {...defaultProps} />)
    const range = screen.getByLabelText(/Score minimum/i)

    // Act
    fireEvent.change(range, { target: { value: '50' } })

    // Assert
    expect(lastPushedParams().get('score_min')).toBe('50')
  })

  it('score_min=0 est retiré de l\'URL (pas de bruit)', () => {
    // Arrange : on démarre avec un score actif
    render(<ProspectsFilters {...defaultProps} currentScoreMin={40} />)
    const range = screen.getByLabelText(/Score minimum/i)

    // Act : revient à 0
    fireEvent.change(range, { target: { value: '0' } })

    // Assert : la clé score_min disparaît
    expect(lastPushedParams().has('score_min')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TOGGLE ARCHIVES
// ─────────────────────────────────────────────────────────────────────────────

describe('ProspectsFilters — toggle archives', () => {
  it('activation du toggle pousse ?archived=1', () => {
    // Arrange
    render(<ProspectsFilters {...defaultProps} />)
    const toggle = screen.getByRole('button', { name: /Voir les archivés/i })

    // Act
    fireEvent.click(toggle)

    // Assert
    expect(lastPushedParams().get('archived')).toBe('1')
  })

  it('désactivation retire la clé archived de l\'URL', () => {
    // Arrange : on démarre avec archives actif
    render(<ProspectsFilters {...defaultProps} currentArchived={true} />)
    const toggle = screen.getByRole('button', { name: /Voir les archivés/i })

    // Act
    fireEvent.click(toggle)

    // Assert
    expect(lastPushedParams().has('archived')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BOUTON RÉINITIALISER
// ─────────────────────────────────────────────────────────────────────────────

describe('ProspectsFilters — bouton Réinitialiser', () => {
  it('est masqué quand aucun filtre n\'est actif', () => {
    // Arrange + Act
    render(<ProspectsFilters {...defaultProps} />)

    // Assert
    expect(
      screen.queryByRole('button', { name: /Réinitialiser tous les filtres/i }),
    ).not.toBeInTheDocument()
  })

  it('est visible dès qu\'au moins un filtre est actif (statut)', () => {
    // Arrange + Act : un statut pré-sélectionné via les props
    render(<ProspectsFilters {...defaultProps} currentStatuts={['qualified']} />)

    // Assert
    expect(
      screen.getByRole('button', { name: /Réinitialiser tous les filtres/i }),
    ).toBeInTheDocument()
  })

  it('click sur Réinitialiser pousse /prospects (sans queryparams)', () => {
    // Arrange : plusieurs filtres actifs au départ
    render(
      <ProspectsFilters
        {...defaultProps}
        currentStatuts={['qualified', 'contacted']}
        currentSecteur="industrie"
        currentScoreMin={50}
        currentArchived={true}
        currentContactTypes={['phone']}
      />,
    )
    const resetBtn = screen.getByRole('button', { name: /Réinitialiser tous les filtres/i })

    // Act
    fireEvent.click(resetBtn)

    // Assert : push vers /prospects strict, pas de '?'.
    expect(mockPush).toHaveBeenCalledWith('/prospects')
  })
})
