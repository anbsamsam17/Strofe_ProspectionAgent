// ============================================================
// Tests : KanbanSidePanel
// ------------------------------------------------------------
// Couvre :
//   - Rendu : header avec raison sociale + statut.
//   - Fermeture par bouton X.
//   - Fermeture par overlay click.
//   - Fermeture par touche Escape.
//   - Changement de statut via dropdown (PATCH /api/prospects/[id]).
//   - CTA "Voir le détail complet" pointe vers /prospects/[id].
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { Prospect } from '@/lib/types'

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
      taille: 75,
      beges: 50,
      contact: 100,
      weights: { taille: 30, beges: 30, contact: 40 },
      deja_contacte_penalty: 0,
      rejete_penalty: 0,
    },
    signaux: [],
    statut: 'qualified',
    source: 'sirene',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

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
        open
        onClose={() => {}}
        onStatusChange={() => {}}
      />,
    )
    expect(screen.getByText('Bilanco SARL')).toBeInTheDocument()
    // Le label "Qualifié" apparaît à la fois dans le badge header et dans le
    // bouton du dropdown — on prend le badge via son rôle.
    expect(screen.getAllByText('Qualifié').length).toBeGreaterThan(0)
  })

  it('affiche un CTA "Voir le détail complet" vers la fiche prospect', () => {
    const prospect = makeProspect({ raison_sociale: 'Acme SAS' })
    render(
      <KanbanSidePanel
        prospect={prospect}
        open
        onClose={() => {}}
        onStatusChange={() => {}}
      />,
    )
    const link = screen.getByRole('link', {
      name: /Voir le détail complet de Acme SAS/i,
    })
    expect(link).toHaveAttribute('href', `/prospects/${prospect.id}`)
  })

  it('affiche le score et la décomposition (top 5 non-nuls)', () => {
    render(
      <KanbanSidePanel
        prospect={makeProspect()}
        open
        onClose={() => {}}
        onStatusChange={() => {}}
      />,
    )
    expect(screen.getByText('78')).toBeInTheDocument()
    // Décomposition rendue : on cible les valeurs signées de la liste — les
    // labels "BEGES" / "Contact" / "Taille" apparaissent aussi dans d'autres
    // sections du panneau, donc getByText sur ces labels est ambigu.
    expect(screen.getByText('+75')).toBeInTheDocument()
    expect(screen.getByText('+50')).toBeInTheDocument()
    expect(screen.getByText('+100')).toBeInTheDocument()
  })
})

describe('KanbanSidePanel — fermeture', () => {
  it('appelle onClose au clic sur le bouton X', () => {
    const onClose = vi.fn()
    render(
      <KanbanSidePanel
        prospect={makeProspect()}
        open
        onClose={onClose}
        onStatusChange={() => {}}
      />,
    )
    const closeBtn = screen.getByRole('button', { name: /Fermer le panneau/i })
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("appelle onClose au clic sur l'overlay", () => {
    const onClose = vi.fn()
    const { container } = render(
      <KanbanSidePanel
        prospect={makeProspect()}
        open
        onClose={onClose}
        onStatusChange={() => {}}
      />,
    )
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
        open={false}
        onClose={onClose}
        onStatusChange={() => {}}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('KanbanSidePanel — changement de statut', () => {
  it('PATCH /api/prospects/[id] puis onStatusChange via le dropdown Statut', async () => {
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
        open
        onClose={() => {}}
        onStatusChange={onStatusChange}
      />,
    )

    // Ouvre le dropdown (le bouton est nommé via le statut courant).
    const dropdownTrigger = screen.getByRole('button', {
      name: /Changer le statut/i,
    })
    fireEvent.click(dropdownTrigger)

    // Click "Contacté" dans la liste.
    const option = screen.getByRole('option', { name: /Contacté/i })
    fireEvent.click(option)

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

  it("affiche une erreur si l'API renvoie une erreur", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Conflit pipeline' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <KanbanSidePanel
        prospect={makeProspect({ statut: 'qualified' })}
        open
        onClose={() => {}}
        onStatusChange={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Changer le statut/i }))
    fireEvent.click(screen.getByRole('option', { name: /Contacté/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Conflit pipeline')
    })
  })
})
