// ============================================================
// Tests : KanbanSidePanel
// ------------------------------------------------------------
// Couvre :
//   - Rendu : header avec raison sociale + statut.
//   - Fermeture par bouton X.
//   - Fermeture par overlay click.
//   - Fermeture par touche Escape.
//   - Transitions prev/next via fetch /api/prospects/[id].
//   - Boutons disabled aux extrémités de la chaîne.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { Prospect, ProspectStatus } from '@/lib/types'

// Mock du composant ProspectNotes (auto-save) : on évite les appels fetch internes.
vi.mock('@/components/prospects/prospect-notes', () => ({
  ProspectNotes: ({ prospectId }: { prospectId: string }) => (
    <div data-testid={`notes-mock-${prospectId}`}>NotesMock</div>
  ),
}))

// Import APRÈS le mock (Vitest hoist).
import { KanbanSidePanel } from './kanban-side-panel'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    user_id: 'user-1',
    siren: '123456789',
    raison_sociale: 'Acme SAS',
    secteur_libelle: 'Industrie chimique',
    ville: 'Lyon',
    code_postal: '69000',
    effectif_min: 250,
    effectif_max: 500,
    beges_publie: true,
    beges_valide: true,
    obligation_beges: true,
    score_priorite: 78,
    score_details: {
      obligation_beges: 20,
      secteur_prioritaire: 15,
      beges_non_publie: 0,
      beges_expire: 0,
      signaux_intention: 10,
      taille_entreprise: 15,
      contact_trouve: 10,
      secteur_beges_mature: 5,
      penalite_deja_contacte: 0,
      penalite_rejete: 0,
    },
    signaux: [],
    statut: 'qualified',
    source: 'sirene',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const COLUMNS: { status: ProspectStatus; label: string; color: string }[] = [
  { status: 'sourced', label: 'Sourcé', color: 'gray' },
  { status: 'qualified', label: 'Qualifié', color: 'blue' },
  { status: 'contacted', label: 'Contacté', color: 'yellow' },
  { status: 'rdv', label: 'RDV', color: 'purple' },
  { status: 'converted', label: 'Converti', color: 'green' },
]

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('KanbanSidePanel — rendu', () => {
  it('affiche la raison sociale et le statut courant', () => {
    render(
      <KanbanSidePanel
        prospect={makeProspect({ raison_sociale: 'Bilanco SARL', statut: 'qualified' })}
        columns={COLUMNS}
        open
        onClose={() => {}}
        onStatusChange={() => {}}
      />,
    )
    expect(screen.getByText('Bilanco SARL')).toBeInTheDocument()
    expect(screen.getByText('Qualifié')).toBeInTheDocument()
  })

  it('affiche un lien "Plus de détails" vers la fiche prospect', () => {
    const prospect = makeProspect({ raison_sociale: 'Acme SAS' })
    render(
      <KanbanSidePanel
        prospect={prospect}
        columns={COLUMNS}
        open
        onClose={() => {}}
        onStatusChange={() => {}}
      />,
    )
    // Le header expose un lien dédié avec aria-label spécifique à l'entreprise.
    const link = screen.getByRole('link', {
      name: /Voir la fiche complète de Acme SAS/i,
    })
    expect(link).toHaveAttribute('href', `/prospects/${prospect.id}`)
  })

  it('affiche le score et la décomposition (top 5 non-nuls)', () => {
    render(
      <KanbanSidePanel
        prospect={makeProspect()}
        columns={COLUMNS}
        open
        onClose={() => {}}
        onStatusChange={() => {}}
      />,
    )
    expect(screen.getByText('78')).toBeInTheDocument()
    // Un détail attendu
    expect(screen.getByText('Obligation BEGES')).toBeInTheDocument()
  })
})

describe('KanbanSidePanel — fermeture', () => {
  it('appelle onClose au clic sur le bouton X', () => {
    const onClose = vi.fn()
    render(
      <KanbanSidePanel
        prospect={makeProspect()}
        columns={COLUMNS}
        open
        onClose={onClose}
        onStatusChange={() => {}}
      />,
    )
    const closeBtn = screen.getByRole('button', { name: /Fermer le panneau/i })
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('appelle onClose au clic sur l’overlay', () => {
    const onClose = vi.fn()
    const { container } = render(
      <KanbanSidePanel
        prospect={makeProspect()}
        columns={COLUMNS}
        open
        onClose={onClose}
        onStatusChange={() => {}}
      />,
    )
    // L'overlay est le premier <div aria-hidden="true"> avec bg-black/40.
    const overlay = container.querySelector('[aria-hidden="true"].absolute.inset-0')
    expect(overlay).not.toBeNull()
    fireEvent.click(overlay as Element)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('appelle onClose à la touche Escape', () => {
    const onClose = vi.fn()
    render(
      <KanbanSidePanel
        prospect={makeProspect()}
        columns={COLUMNS}
        open
        onClose={onClose}
        onStatusChange={() => {}}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ne réagit pas à Escape quand open=false', () => {
    const onClose = vi.fn()
    render(
      <KanbanSidePanel
        prospect={makeProspect()}
        columns={COLUMNS}
        open={false}
        onClose={onClose}
        onStatusChange={() => {}}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('KanbanSidePanel — transitions de statut', () => {
  it('appelle PATCH /api/prospects/[id] puis onStatusChange au clic "Suivant"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { ok: true } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const prospect = makeProspect({ statut: 'qualified' })
    const onStatusChange = vi.fn()

    render(
      <KanbanSidePanel
        prospect={prospect}
        columns={COLUMNS}
        open
        onClose={() => {}}
        onStatusChange={onStatusChange}
      />,
    )

    // "qualified" → next = "contacted"
    const nextBtn = screen.getByRole('button', { name: /Avancer vers Contacté/i })
    fireEvent.click(nextBtn)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/prospects/${prospect.id}`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ statut: 'contacted' }),
        }),
      )
    })

    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith(prospect.id, 'contacted')
    })
  })

  it('désactive le bouton "Précédent" pour le statut "sourced"', () => {
    render(
      <KanbanSidePanel
        prospect={makeProspect({ statut: 'sourced' })}
        columns={COLUMNS}
        open
        onClose={() => {}}
        onStatusChange={() => {}}
      />,
    )
    const prevBtn = screen.getByRole('button', { name: /Aucun statut précédent/i })
    expect(prevBtn).toBeDisabled()
  })

  it('désactive le bouton "Suivant" pour le statut "converted"', () => {
    render(
      <KanbanSidePanel
        prospect={makeProspect({ statut: 'converted' })}
        columns={COLUMNS}
        open
        onClose={() => {}}
        onStatusChange={() => {}}
      />,
    )
    const nextBtn = screen.getByRole('button', { name: /Aucun statut suivant/i })
    expect(nextBtn).toBeDisabled()
  })

  it('affiche une erreur si l’API renvoie une erreur', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Conflit pipeline' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <KanbanSidePanel
        prospect={makeProspect({ statut: 'qualified' })}
        columns={COLUMNS}
        open
        onClose={() => {}}
        onStatusChange={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Avancer vers Contacté/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Conflit pipeline')
    })
  })
})
