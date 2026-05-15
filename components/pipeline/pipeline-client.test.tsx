// ============================================================
// Tests : PipelineClient (Kanban CRM, drag & drop @dnd-kit)
// ------------------------------------------------------------
// Couvre :
//   - Rendu : 8 colonnes localisées + counts + empty state + score badge coloré.
//   - A11y : role="group" + aria-label par colonne, aria-roledescription des cards.
//   - Drag & drop (via mock de @dnd-kit/core) :
//       * drop sur la même colonne → no-op (pas de PATCH).
//       * drop sur autre colonne → PATCH /api/prospects/[id] + optimistic update.
//       * 500 → rollback + message d'erreur via role="alert".
//       * 401 → rollback identique.
//   - Interaction : click sur une card ouvre KanbanSidePanel (mocké).
//
// Mock @dnd-kit/core : DndContext capture onDragEnd dans un ref module-level
// pour qu'on puisse le déclencher en isolation. useDraggable / useDroppable
// renvoient des stubs (pas de DOM listeners).
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/react'
import type { Prospect, ProspectStatus } from '@/lib/types'

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock @dnd-kit/core : on capture les handlers du DndContext et on neutralise
// les hooks (PointerSensor, useDraggable, useDroppable…) pour pouvoir piloter
// le drag en synchrone.
type CapturedHandlers = {
  onDragEnd?: (e: unknown) => void
  onDragStart?: (e: unknown) => void
}
const capturedHandlers: CapturedHandlers = {}

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragEnd,
    onDragStart,
  }: {
    children: React.ReactNode
    onDragEnd?: (e: unknown) => void
    onDragStart?: (e: unknown) => void
  }) => {
    capturedHandlers.onDragEnd = onDragEnd
    capturedHandlers.onDragStart = onDragStart
    return <>{children}</>
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    isDragging: false,
  }),
  useDroppable: () => ({ isOver: false, setNodeRef: vi.fn() }),
  pointerWithin: vi.fn(),
}))

vi.mock('@dnd-kit/sortable', () => ({
  sortableKeyboardCoordinates: vi.fn(),
}))

// Mock du side panel — on ne ré-instrumente pas son comportement ici, on
// vérifie juste qu'il monte au click sur une card.
vi.mock('./kanban-side-panel', () => ({
  KanbanSidePanel: ({
    prospect,
    onClose,
  }: {
    prospect: Prospect
    onClose: () => void
  }) => (
    <div data-testid="kanban-side-panel" data-prospect-id={prospect.id}>
      <p>{prospect.raison_sociale}</p>
      <button type="button" onClick={onClose}>
        Fermer panel
      </button>
    </div>
  ),
}))

// Import APRÈS les mocks (vitest hoist vi.mock automatiquement, mais on garde
// l'ordre clair pour les humains).
import { PipelineClient } from './pipeline-client'
import type { KanbanStatus } from './pipeline-client'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: overrides.id ?? '11111111-1111-1111-1111-111111111111',
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

// Colonnes alignées sur la spec utilisateur (cf. app/(dashboard)/pipeline/page.tsx).
// Migration 017 : 9ᵉ colonne `do_not_contact` (opt-out manuel utilisateur).
const COLUMNS: { status: KanbanStatus; label: string; color: string }[] = [
  { status: 'sourced', label: 'Pas de contact identifié', color: 'gray' },
  { status: 'qualified', label: 'Qualifié', color: 'blue' },
  { status: 'contacted', label: 'Contacté', color: 'yellow' },
  { status: 'interested', label: 'Intéressé', color: 'green' },
  { status: 'offer_sent', label: 'Offre envoyée', color: 'indigo' },
  { status: 'converted', label: 'Affaire conclue', color: 'emerald' },
  { status: 'rejected', label: 'Sans suite', color: 'red' },
  { status: 'on_hold', label: 'En stand-by', color: 'orange' },
  { status: 'do_not_contact', label: 'Ne pas contacter', color: 'slate' },
]

function emptyByStatus(): Record<KanbanStatus, Prospect[]> {
  return {
    sourced: [],
    qualified: [],
    contacted: [],
    interested: [],
    offer_sent: [],
    converted: [],
    rejected: [],
    on_hold: [],
    // `rdv` n'est pas une colonne affichée mais reste typé dans ProspectStatus.
    rdv: [],
    // Migration 017 : opt-out manuel utilisateur.
    do_not_contact: [],
  } as unknown as Record<KanbanStatus, Prospect[]>
}

// Helper : déclenche l'événement onDragEnd capturé via le mock DndContext.
function triggerDragEnd(activeId: string, fromStatus: KanbanStatus, overId: string | null) {
  if (!capturedHandlers.onDragEnd) {
    throw new Error('onDragEnd handler not captured — DndContext mock ne fonctionne pas.')
  }
  act(() => {
    capturedHandlers.onDragEnd?.({
      active: {
        id: activeId,
        data: { current: { fromStatus } },
      },
      over: overId ? { id: overId } : null,
    })
  })
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  capturedHandlers.onDragEnd = undefined
  capturedHandlers.onDragStart = undefined
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

// ── Tests : Rendu ─────────────────────────────────────────────────────────────

describe('PipelineClient — rendu', () => {
  it('affiche les 9 colonnes avec leur label localisé (incl. do_not_contact mig.017)', () => {
    render(<PipelineClient columns={COLUMNS} prospectsByStatus={emptyByStatus()} />)

    for (const col of COLUMNS) {
      // Le label est rendu dans le header de chaque colonne.
      const labels = screen.getAllByText(col.label)
      expect(labels.length).toBeGreaterThan(0)
    }
  })

  it('affiche chaque colonne avec role="group" et un aria-label dynamique', () => {
    const byStatus = emptyByStatus()
    byStatus.qualified = [
      makeProspect({ id: 'p-1', statut: 'qualified', raison_sociale: 'Alpha' }),
      makeProspect({ id: 'p-2', statut: 'qualified', raison_sociale: 'Beta' }),
    ]
    render(<PipelineClient columns={COLUMNS} prospectsByStatus={byStatus} />)

    // 9 colonnes affichées (incl. do_not_contact mig.017).
    const groups = screen.getAllByRole('group')
    expect(groups).toHaveLength(9)

    // Aria-label sur "Qualifié" reflète le count + pluriel.
    expect(
      screen.getByRole('group', { name: /Colonne Qualifié — 2 prospects/i }),
    ).toBeInTheDocument()
    // Aria-label sur une colonne vide reste au singulier ("0 prospect").
    expect(
      screen.getByRole('group', { name: /Colonne Contacté — 0 prospect$/i }),
    ).toBeInTheDocument()
  })

  it('affiche le count par colonne dans le badge header', () => {
    const byStatus = emptyByStatus()
    byStatus.qualified = [
      makeProspect({ id: 'p-1', statut: 'qualified' }),
      makeProspect({ id: 'p-2', statut: 'qualified' }),
      makeProspect({ id: 'p-3', statut: 'qualified' }),
    ]
    byStatus.contacted = [makeProspect({ id: 'p-4', statut: 'contacted' })]
    render(<PipelineClient columns={COLUMNS} prospectsByStatus={byStatus} />)

    const qualifiedCol = screen.getByRole('group', { name: /Colonne Qualifié/i })
    expect(within(qualifiedCol).getByText('3')).toBeInTheDocument()

    const contactedCol = screen.getByRole('group', { name: /Colonne Contacté/i })
    expect(within(contactedCol).getByText('1')).toBeInTheDocument()
  })

  it('affiche un empty state ("Aucun prospect") dans les colonnes vides', () => {
    render(<PipelineClient columns={COLUMNS} prospectsByStatus={emptyByStatus()} />)
    // 9 colonnes vides → 9 empty states (incl. do_not_contact mig.017).
    expect(screen.getAllByText('Aucun prospect')).toHaveLength(9)
  })

  it('affiche les cards prospect avec score badge selon les paliers (75+, 50+, <50)', () => {
    const byStatus = emptyByStatus()
    byStatus.qualified = [
      makeProspect({ id: 'p-high', raison_sociale: 'High', score_priorite: 88 }),
      makeProspect({ id: 'p-mid', raison_sociale: 'Mid', score_priorite: 60 }),
      makeProspect({ id: 'p-low', raison_sociale: 'Low', score_priorite: 20 }),
    ]
    render(<PipelineClient columns={COLUMNS} prospectsByStatus={byStatus} />)

    const high = screen.getByLabelText('Score : 88')
    const mid = screen.getByLabelText('Score : 60')
    const low = screen.getByLabelText('Score : 20')

    // Palier ≥75 → vert (glass translucide en dark forced).
    expect(high.className).toMatch(/bg-green-500\/15/)
    // Palier ≥50 et <75 → jaune.
    expect(mid.className).toMatch(/bg-yellow-500\/15/)
    // Palier <50 → glass neutre.
    expect(low.className).toMatch(/bg-white\/\[0\.06\]/)
  })

  it('chaque card a aria-roledescription="Carte prospect déplaçable"', () => {
    const byStatus = emptyByStatus()
    byStatus.qualified = [makeProspect({ id: 'p-1', raison_sociale: 'Acme SAS' })]
    render(<PipelineClient columns={COLUMNS} prospectsByStatus={byStatus} />)

    const card = screen.getByRole('button', { name: /Acme SAS/i })
    expect(card).toHaveAttribute('aria-roledescription', 'Carte prospect déplaçable')
  })
})

// ── Tests : Drag & drop ───────────────────────────────────────────────────────

describe('PipelineClient — drag & drop', () => {
  it("ne déclenche aucun fetch si l'utilisateur drop sur la même colonne", () => {
    const byStatus = emptyByStatus()
    byStatus.qualified = [makeProspect({ id: 'p-1', statut: 'qualified' })]
    render(<PipelineClient columns={COLUMNS} prospectsByStatus={byStatus} />)

    triggerDragEnd('p-1', 'qualified', 'qualified')

    expect(fetch).not.toHaveBeenCalled()
  })

  it('ne déclenche aucun fetch si le drop est hors zone (over=null)', () => {
    const byStatus = emptyByStatus()
    byStatus.qualified = [makeProspect({ id: 'p-1', statut: 'qualified' })]
    render(<PipelineClient columns={COLUMNS} prospectsByStatus={byStatus} />)

    triggerDragEnd('p-1', 'qualified', null)

    expect(fetch).not.toHaveBeenCalled()
  })

  it('PATCH /api/prospects/[id] avec { statut } au drop sur une autre colonne', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { ok: true } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const byStatus = emptyByStatus()
    byStatus.qualified = [
      makeProspect({ id: 'p-move', statut: 'qualified', raison_sociale: 'MoveMe' }),
    ]
    render(<PipelineClient columns={COLUMNS} prospectsByStatus={byStatus} />)

    triggerDragEnd('p-move', 'qualified', 'contacted')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/prospects/p-move',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ statut: 'contacted' }),
        }),
      )
    })
  })

  it("optimistic update : la card change de colonne avant la réponse de l'API", async () => {
    // fetch en attente — la promesse ne résout jamais pendant l'assert.
    let resolveFetch: (value: unknown) => void = () => {}
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const byStatus = emptyByStatus()
    byStatus.qualified = [
      makeProspect({ id: 'p-move', statut: 'qualified', raison_sociale: 'MoveMe' }),
    ]
    render(<PipelineClient columns={COLUMNS} prospectsByStatus={byStatus} />)

    // Avant : la card est dans la colonne Qualifié.
    let qualifiedCol = screen.getByRole('group', { name: /Colonne Qualifié/i })
    expect(within(qualifiedCol).queryByText('MoveMe')).toBeInTheDocument()

    triggerDragEnd('p-move', 'qualified', 'contacted')

    // Immédiatement après : optimistic update. La card est passée en Contacté
    // alors que le PATCH n'est pas encore résolu.
    qualifiedCol = screen.getByRole('group', { name: /Colonne Qualifié/i })
    const contactedCol = screen.getByRole('group', { name: /Colonne Contacté/i })
    expect(within(qualifiedCol).queryByText('MoveMe')).not.toBeInTheDocument()
    expect(within(contactedCol).getByText('MoveMe')).toBeInTheDocument()

    // Cleanup : on libère la promesse pour éviter un act() warning.
    resolveFetch({ ok: true, json: () => Promise.resolve({}) })
  })

  it('rollback + message erreur si le PATCH renvoie 500', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Conflit serveur' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const byStatus = emptyByStatus()
    byStatus.qualified = [
      makeProspect({ id: 'p-fail', statut: 'qualified', raison_sociale: 'FailMe' }),
    ]
    render(<PipelineClient columns={COLUMNS} prospectsByStatus={byStatus} />)

    triggerDragEnd('p-fail', 'qualified', 'contacted')

    // Le rollback restaure la card dans sa colonne d'origine.
    await waitFor(() => {
      const qualifiedCol = screen.getByRole('group', { name: /Colonne Qualifié/i })
      expect(within(qualifiedCol).getByText('FailMe')).toBeInTheDocument()
    })
    const contactedCol = screen.getByRole('group', { name: /Colonne Contacté/i })
    expect(within(contactedCol).queryByText('FailMe')).not.toBeInTheDocument()

    // Message d'erreur visible via role="alert".
    expect(screen.getByRole('alert')).toHaveTextContent('Conflit serveur')
  })

  it('rollback identique si le PATCH renvoie 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Non authentifié' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const byStatus = emptyByStatus()
    byStatus.qualified = [
      makeProspect({ id: 'p-unauth', statut: 'qualified', raison_sociale: 'UnauthMe' }),
    ]
    render(<PipelineClient columns={COLUMNS} prospectsByStatus={byStatus} />)

    triggerDragEnd('p-unauth', 'qualified', 'interested')

    await waitFor(() => {
      const qualifiedCol = screen.getByRole('group', { name: /Colonne Qualifié/i })
      expect(within(qualifiedCol).getByText('UnauthMe')).toBeInTheDocument()
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Non authentifié')
  })

  it("rollback avec message générique si le réseau échoue (fetch reject)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network down'))
    vi.stubGlobal('fetch', fetchMock)

    const byStatus = emptyByStatus()
    byStatus.qualified = [
      makeProspect({ id: 'p-net', statut: 'qualified', raison_sociale: 'NetMe' }),
    ]
    render(<PipelineClient columns={COLUMNS} prospectsByStatus={byStatus} />)

    triggerDragEnd('p-net', 'qualified', 'on_hold')

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network down')
    })
    const qualifiedCol = screen.getByRole('group', { name: /Colonne Qualifié/i })
    expect(within(qualifiedCol).getByText('NetMe')).toBeInTheDocument()
  })
})

// ── Tests : Interaction side panel ────────────────────────────────────────────

describe('PipelineClient — interaction side panel', () => {
  it("ouvre KanbanSidePanel au click sur une card", () => {
    const byStatus = emptyByStatus()
    byStatus.qualified = [
      makeProspect({ id: 'p-click', raison_sociale: 'ClickMe' }),
    ]
    render(<PipelineClient columns={COLUMNS} prospectsByStatus={byStatus} />)

    // Le panneau n'est pas monté avant.
    expect(screen.queryByTestId('kanban-side-panel')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /ClickMe/i }))

    const panel = screen.getByTestId('kanban-side-panel')
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveAttribute('data-prospect-id', 'p-click')
  })

  it('ferme KanbanSidePanel via le callback onClose', () => {
    const byStatus = emptyByStatus()
    byStatus.qualified = [
      makeProspect({ id: 'p-close', raison_sociale: 'CloseMe' }),
    ]
    render(<PipelineClient columns={COLUMNS} prospectsByStatus={byStatus} />)

    fireEvent.click(screen.getByRole('button', { name: /CloseMe/i }))
    expect(screen.getByTestId('kanban-side-panel')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Fermer panel/i }))
    expect(screen.queryByTestId('kanban-side-panel')).not.toBeInTheDocument()
  })
})
