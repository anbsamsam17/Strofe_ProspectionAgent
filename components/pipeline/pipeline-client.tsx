'use client'

// ============================================================
// PipelineClient — Kanban CRM avec drag & drop
// ------------------------------------------------------------
// 8 colonnes statiques (cf. PIPELINE_COLUMNS dans la page) :
//   sourced · qualified · contacted · interested · offer_sent
//   · converted · rejected · on_hold
//
// Drag & drop (@dnd-kit/core) :
//   - PointerSensor distance=8 (évite les drags accidentels au clic).
//   - KeyboardSensor avec sortableKeyboardCoordinates (a11y).
//   - useDroppable par colonne, useDraggable par card.
//   - Optimistic update local → PATCH /api/prospects/[id] → rollback si erreur.
//   - DragOverlay : preview légèrement opaque + rotate-2.
//
// Click sur une card : ouvre le KanbanSidePanel (détails + dropdowns).
// ============================================================

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { Prospect, ProspectStatus } from '@/lib/types'
import { ProspectCard3D } from '@/components/ui/prospect-card-3d'
import { formatEuros, sumForecast } from '@/lib/pipeline/forecast'
import { KanbanSidePanel } from './kanban-side-panel'

// ── Types ─────────────────────────────────────────────────────────────────────

// `offer_sent` fait désormais partie de `ProspectStatus` (lib/types.ts,
// migration 010). L'union explicite est conservée à titre redondant et sans
// effet (offer_sent ∈ ProspectStatus) ; elle pourra être simplifiée en
// `ProspectStatus` lors d'un futur passage purement typage.
export type KanbanStatus = ProspectStatus | 'offer_sent'

interface PipelineColumn {
  status: KanbanStatus
  label: string
  color: string
}

interface PipelineClientProps {
  columns: PipelineColumn[]
  prospectsByStatus: Record<KanbanStatus, Prospect[]>
}

// ── Config couleurs ───────────────────────────────────────────────────────────

// Dark-forced theme : on n'utilise QUE des variantes translucides (glass).
// Pas de `bg-{c}-50` ni `bg-{c}-100` (artefacts blancs persistants).
const COLUMN_STYLES: Record<
  string,
  {
    header: string
    headerText: string
    dot: string
    badge: string
    card: string
    cardHover: string
    accent: string
  }
> = {
  gray: {
    header: 'bg-white/[0.04] ring-1 ring-white/[0.06]',
    headerText: 'text-gray-200',
    dot: 'bg-gray-400',
    badge: 'bg-white/[0.08] text-gray-200 ring-1 ring-white/[0.08]',
    card: 'border-white/[0.06]',
    cardHover: 'hover:border-white/[0.18] hover:shadow-md',
    accent: 'bg-gray-400',
  },
  blue: {
    header: 'bg-blue-500/10 ring-1 ring-blue-500/20',
    headerText: 'text-blue-200',
    dot: 'bg-blue-400',
    badge: 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/25',
    card: 'border-blue-500/15',
    cardHover: 'hover:border-blue-400/40 hover:shadow-md',
    accent: 'bg-blue-500',
  },
  yellow: {
    header: 'bg-yellow-500/10 ring-1 ring-yellow-500/20',
    headerText: 'text-yellow-200',
    dot: 'bg-yellow-400',
    badge: 'bg-yellow-500/15 text-yellow-200 ring-1 ring-yellow-500/25',
    card: 'border-yellow-500/15',
    cardHover: 'hover:border-yellow-400/40 hover:shadow-md',
    accent: 'bg-yellow-500',
  },
  purple: {
    header: 'bg-purple-500/10 ring-1 ring-purple-500/20',
    headerText: 'text-purple-200',
    dot: 'bg-purple-400',
    badge: 'bg-purple-500/15 text-purple-200 ring-1 ring-purple-500/25',
    card: 'border-purple-500/15',
    cardHover: 'hover:border-purple-400/40 hover:shadow-md',
    accent: 'bg-purple-500',
  },
  green: {
    header: 'bg-green-500/10 ring-1 ring-green-500/20',
    headerText: 'text-green-200',
    dot: 'bg-green-400',
    badge: 'bg-green-500/15 text-green-200 ring-1 ring-green-500/25',
    card: 'border-green-500/15',
    cardHover: 'hover:border-green-400/40 hover:shadow-md',
    accent: 'bg-green-500',
  },
  red: {
    header: 'bg-red-500/10 ring-1 ring-red-500/20',
    headerText: 'text-red-200',
    dot: 'bg-red-400',
    badge: 'bg-red-500/15 text-red-200 ring-1 ring-red-500/25',
    card: 'border-red-500/15',
    cardHover: 'hover:border-red-400/40 hover:shadow-md',
    accent: 'bg-red-500',
  },
  orange: {
    header: 'bg-orange-500/10 ring-1 ring-orange-500/20',
    headerText: 'text-orange-200',
    dot: 'bg-orange-400',
    badge: 'bg-orange-500/15 text-orange-200 ring-1 ring-orange-500/25',
    card: 'border-orange-500/15',
    cardHover: 'hover:border-orange-400/40 hover:shadow-md',
    accent: 'bg-orange-500',
  },
  indigo: {
    header: 'bg-indigo-500/10 ring-1 ring-indigo-500/20',
    headerText: 'text-indigo-200',
    dot: 'bg-indigo-400',
    badge: 'bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-500/25',
    card: 'border-indigo-500/15',
    cardHover: 'hover:border-indigo-400/40 hover:shadow-md',
    accent: 'bg-indigo-500',
  },
  emerald: {
    header: 'bg-emerald-500/10 ring-1 ring-emerald-500/20',
    headerText: 'text-emerald-200',
    dot: 'bg-emerald-400',
    badge: 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/25',
    card: 'border-emerald-500/15',
    cardHover: 'hover:border-emerald-400/40 hover:shadow-md',
    accent: 'bg-emerald-500',
  },
  // Migration 028 : cyan pour 'to_contact' — décision humaine d'amorce,
  // distincte du bleu 'qualified' (qualif auto) et du jaune 'contacted'.
  cyan: {
    header: 'bg-cyan-500/10 ring-1 ring-cyan-500/20',
    headerText: 'text-cyan-200',
    dot: 'bg-cyan-400',
    badge: 'bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-500/25',
    card: 'border-cyan-500/15',
    cardHover: 'hover:border-cyan-400/40 hover:shadow-md',
    accent: 'bg-cyan-500',
  },
  // Migration 017 : slate translucide pour 'do_not_contact'. Volontairement
  // sobre (≠ rouge 'rejected') — signale un statut "passif" (à ne pas relancer).
  slate: {
    header: 'bg-slate-500/10 ring-1 ring-slate-500/20',
    headerText: 'text-slate-200',
    dot: 'bg-slate-400',
    badge: 'bg-slate-500/15 text-slate-200 ring-1 ring-slate-500/25',
    card: 'border-slate-500/15',
    cardHover: 'hover:border-slate-400/40 hover:shadow-md',
    accent: 'bg-slate-500',
  },
}

// ── Composant principal ───────────────────────────────────────────────────────

export function PipelineClient({
  columns,
  prospectsByStatus,
}: PipelineClientProps) {
  // État local du Kanban — optimistic updates.
  const [prospects, setProspects] = useState(prospectsByStatus)
  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<KanbanStatus | null>(null)
  const [dragError, setDragError] = useState<string | null>(null)

  // Désactive le tilt 3D des cards si l'utilisateur préfère un mouvement réduit.
  const [reducedMotion, setReducedMotion] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Map id → Prospect pour retrouver rapidement la card draggée pendant l'overlay.
  const prospectsById = useMemo(() => {
    const map = new Map<string, Prospect>()
    for (const list of Object.values(prospects)) {
      for (const p of list) map.set(p.id, p)
    }
    return map
  }, [prospects])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id))
    setDragError(null)
  }, [])

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      setActiveDragId(null)
      setOverColumn(null)

      if (!over) return

      const prospectId = String(active.id)
      const fromStatus = active.data.current?.fromStatus as KanbanStatus | undefined
      const toStatus = over.id as KanbanStatus

      if (!fromStatus || fromStatus === toStatus) return

      // Snapshot pour rollback.
      const snapshot = prospects

      // Optimistic update : déplacer la card de fromStatus vers toStatus.
      setProspects((prev) => {
        const updated: Record<KanbanStatus, Prospect[]> = { ...prev }
        const movingProspect = (prev[fromStatus] ?? []).find((p) => p.id === prospectId)
        if (!movingProspect) return prev
        updated[fromStatus] = (prev[fromStatus] ?? []).filter((p) => p.id !== prospectId)
        updated[toStatus] = [
          { ...movingProspect, statut: toStatus as ProspectStatus },
          ...(prev[toStatus] ?? []),
        ]
        return updated
      })

      // PATCH côté serveur.
      try {
        const res = await fetch(`/api/prospects/${prospectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ statut: toStatus }),
        })
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(payload.error ?? 'Erreur lors du changement de statut')
        }
      } catch (err) {
        // Rollback + feedback minimal. Toast système maison à brancher post-merge.
        setProspects(snapshot)
        const message = err instanceof Error ? err.message : 'Erreur inconnue'
        setDragError(message)
      }
    },
    [prospects],
  )

  function handleStatusChange(id: string, newStatus: KanbanStatus) {
    setProspects((prev) => {
      const updated: Record<KanbanStatus, Prospect[]> = { ...prev }
      for (const key of Object.keys(updated) as KanbanStatus[]) {
        updated[key] = (updated[key] ?? []).filter((p) => p.id !== id)
      }
      const allProspects = Object.values(prev).flat()
      const prospect = allProspects.find((p) => p.id === id)
      if (prospect) {
        updated[newStatus] = [
          { ...prospect, statut: newStatus as ProspectStatus },
          ...(updated[newStatus] ?? []),
        ]
      }
      return updated
    })
  }

  const activeProspect = activeDragId ? prospectsById.get(activeDragId) ?? null : null

  return (
    <>
      {dragError && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          {dragError}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={(event) => {
          setOverColumn((event.over?.id as KanbanStatus | undefined) ?? null)
        }}
        onDragCancel={() => {
          setActiveDragId(null)
          setOverColumn(null)
        }}
        onDragEnd={handleDragEnd}
      >
        {/* Scrollbar dupliquée en haut — sync bidirectionnelle avec le Kanban
            pour permettre de naviguer entre les 8 colonnes sans devoir scroller
            tout en bas. Pattern classique double-scroll avec ResizeObserver pour
            suivre la largeur du contenu (qui change quand on filtre les cards). */}
        <DualScrollKanban>
          {(kanbanRef) => (
            <div
              ref={kanbanRef}
              className="flex gap-4 overflow-x-auto pb-6"
              role="region"
              aria-label="Pipeline CRM — vue kanban"
            >
              {columns.map((column) => {
                const items = prospects[column.status] ?? []
                const styles = COLUMN_STYLES[column.color] ?? COLUMN_STYLES.gray
                const isOver = overColumn === column.status && activeDragId !== null

                return (
                  <DroppableColumn
                    key={column.status}
                    column={column}
                    items={items}
                    styles={styles}
                    isOver={isOver}
                    activeDragId={activeDragId}
                    onSelect={setSelectedProspect}
                  />
                )
              })}
            </div>
          )}
        </DualScrollKanban>

        <DragOverlay dropAnimation={null}>
          {activeProspect ? (
            <ProspectCardPreview prospect={activeProspect} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Side panel détail prospect — slide-in droit. */}
      {selectedProspect && (
        <KanbanSidePanel
          prospect={selectedProspect}
          open
          onClose={() => setSelectedProspect(null)}
          onStatusChange={(id, newStatus) => {
            handleStatusChange(id, newStatus)
            setSelectedProspect(null)
          }}
        />
      )}
    </>
  )
}

// ── Colonne droppable ─────────────────────────────────────────────────────────

interface DroppableColumnProps {
  column: PipelineColumn
  items: Prospect[]
  styles: (typeof COLUMN_STYLES)[string]
  isOver: boolean
  activeDragId: string | null
  onSelect: (prospect: Prospect) => void
}

function DroppableColumn({
  column,
  items,
  styles,
  isOver,
  activeDragId,
  onSelect,
}: DroppableColumnProps) {
  const { setNodeRef } = useDroppable({ id: column.status })

  // GLN-041 — Somme ponderee des deals de la colonne (forecast pipeline).
  // sumForecast filtre deja les prospects sans deal_value/deal_probability.
  const columnForecast = sumForecast(items)

  return (
    <div
      ref={setNodeRef}
      className={`flex w-[280px] flex-none flex-col gap-3 rounded-2xl p-2 transition-colors duration-150 sm:w-[300px] ${
        isOver
          ? 'bg-green-500/10 ring-2 ring-green-400/60 shadow-[0_0_24px_rgba(34,197,94,0.2)]'
          : 'bg-transparent ring-2 ring-transparent'
      }`}
      role="group"
      aria-label={`Colonne ${column.label} — ${items.length} prospect${items.length > 1 ? 's' : ''}${columnForecast > 0 ? ` — ${formatEuros(columnForecast)} forecast pondéré` : ''}`}
    >
      <div
        className={`flex flex-col gap-1 rounded-2xl px-4 py-3 ${styles.header}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${styles.dot} shadow-sm`}
              aria-hidden="true"
            />
            <span className={`truncate text-sm font-semibold ${styles.headerText}`}>
              {column.label}
            </span>
          </div>
          <span
            className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${styles.badge}`}
          >
            {items.length}
          </span>
        </div>
        {/* Forecast ponderé de la colonne — affiché seulement si au moins
            un prospect a une valeur deal saisie. */}
        {columnForecast > 0 && (
          <p
            className={`text-[11px] font-semibold tabular-nums ${styles.headerText} opacity-80`}
            aria-hidden="true"
          >
            {formatEuros(columnForecast)} forecast
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-white/[0.08] px-4 py-8 text-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-gray-400"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="9" x2="15" y2="9" />
              <line x1="9" y1="12" x2="15" y2="12" />
              <line x1="9" y1="15" x2="12" y2="15" />
            </svg>
            <p className="text-xs text-gray-400">Aucun prospect</p>
          </div>
        ) : (
          items.map((prospect) => (
            <DraggableCard
              key={prospect.id}
              prospect={prospect}
              styles={styles}
              isBeingDragged={activeDragId === prospect.id}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Card draggable ────────────────────────────────────────────────────────────

interface DraggableCardProps {
  prospect: Prospect
  styles: (typeof COLUMN_STYLES)[string]
  isBeingDragged: boolean
  onSelect: (prospect: Prospect) => void
  /** Intensité du tilt 3D au hover (0 = désactivé pour prefers-reduced-motion). */
  tilt?: number
}

function DraggableCard({
  prospect,
  styles,
  isBeingDragged,
  onSelect,
  tilt,
}: DraggableCardProps) {
  const labelId = useId()
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: prospect.id,
    data: { fromStatus: prospect.statut as KanbanStatus },
  })

  // Click vs drag : PointerSensor avec distance=8 distingue déjà clic court (<8px) vs
  // drag. Le onClick déclenche le panneau uniquement si pas de drag en cours.
  function handleClick() {
    if (isBeingDragged) return
    onSelect(prospect)
  }

  // Tilt 3D au hover via ProspectCard3D — tilt=0 désactive l'animation
  // (respect prefers-reduced-motion piloté depuis PipelineClient).
  return (
    <ProspectCard3D tilt={tilt}>
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          // Évite que la space-bar du KeyboardSensor n'active la sélection.
          if (e.target === e.currentTarget && e.key === 'Enter') {
            e.preventDefault()
            onSelect(prospect)
          }
        }
      }}
      aria-labelledby={labelId}
      aria-roledescription="Carte prospect déplaçable"
      className={`group w-full cursor-grab touch-none rounded-2xl border bg-white/[0.03] backdrop-blur-md p-4 text-left shadow-sm transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-1 active:cursor-grabbing dark:bg-gray-900 dark:focus-visible:ring-offset-gray-950 ${styles.card} ${styles.cardHover} hover:-translate-y-0.5 hover:shadow-md ${
        isBeingDragged ? 'opacity-30' : 'opacity-100'
      }`}
    >
      <p
        id={labelId}
        className="font-semibold leading-tight text-white line-clamp-1 transition-colors group-hover:text-green-400"
      >
        {prospect.raison_sociale}
      </p>

      {prospect.secteur_libelle && (
        <span className="mt-2 inline-block max-w-full truncate rounded-md bg-white/[0.05] px-2 py-0.5 text-xs text-gray-300">
          {prospect.secteur_libelle}
        </span>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-gray-400 dark:text-gray-400">
          {prospect.ville ?? '—'}
        </span>
        <span
          className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${
            prospect.score_priorite >= 75
              ? 'bg-green-500/15 text-green-300 ring-1 ring-green-500/25'
              : prospect.score_priorite >= 50
                ? 'bg-yellow-500/15 text-yellow-300 ring-1 ring-yellow-500/25'
                : 'bg-white/[0.06] text-gray-300 ring-1 ring-white/10'
          }`}
          aria-label={`Score : ${prospect.score_priorite}`}
        >
          {prospect.score_priorite}
        </span>
      </div>
    </div>
    </ProspectCard3D>
  )
}

// ── Preview rendue dans le DragOverlay ────────────────────────────────────────

function ProspectCardPreview({ prospect }: { prospect: Prospect }) {
  return (
    <div
      className="pointer-events-none w-[280px] rotate-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md p-4 shadow-2xl ring-1 ring-white/10 sm:w-[300px]"
      aria-hidden="true"
    >
      <p className="font-semibold leading-tight text-white line-clamp-1">
        {prospect.raison_sociale}
      </p>
      {prospect.secteur_libelle && (
        <span className="mt-2 inline-block max-w-full truncate rounded-md bg-white/[0.05] px-2 py-0.5 text-xs text-gray-300">
          {prospect.secteur_libelle}
        </span>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-gray-400">
          {prospect.ville ?? '—'}
        </span>
        <span
          className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${
            prospect.score_priorite >= 75
              ? 'bg-green-500/15 text-green-300 ring-1 ring-green-500/25'
              : prospect.score_priorite >= 50
                ? 'bg-yellow-500/15 text-yellow-300 ring-1 ring-yellow-500/25'
                : 'bg-white/[0.06] text-gray-300 ring-1 ring-white/10'
          }`}
        >
          {prospect.score_priorite}
        </span>
      </div>
    </div>
  )
}

// ── Scrollbar synchronisée en haut + bas du Kanban ──────────────────────────
// Pattern : faux div scrollable au-dessus du Kanban, dont la largeur interne
// suit la largeur réelle du contenu Kanban (via ResizeObserver). Sync
// bidirectionnelle des `scrollLeft` via event listener.
//
// Permet à l'utilisateur de naviguer rapidement entre les colonnes sans
// devoir scroller en bas de la page pour atteindre la scrollbar native.

function DualScrollKanban({
  children,
}: {
  children: (ref: React.RefObject<HTMLDivElement | null>) => React.ReactNode
}): React.ReactElement {
  const topScrollRef = useRef<HTMLDivElement>(null)
  const kanbanRef = useRef<HTMLDivElement>(null)
  const [contentWidth, setContentWidth] = useState(0)

  // Suit la largeur du contenu Kanban (peut changer avec les filtres / cards).
  useEffect(() => {
    const kanban = kanbanRef.current
    if (!kanban) return
    const ro = new ResizeObserver(() => {
      setContentWidth(kanban.scrollWidth)
    })
    ro.observe(kanban)
    // Observe aussi les enfants pour capter l'ajout/retrait de cards.
    for (const child of Array.from(kanban.children)) {
      ro.observe(child)
    }
    setContentWidth(kanban.scrollWidth)
    return () => ro.disconnect()
  }, [])

  // Sync bidirectionnelle des scrollLeft.
  function handleTopScroll() {
    const top = topScrollRef.current
    const kanban = kanbanRef.current
    if (!top || !kanban) return
    if (kanban.scrollLeft !== top.scrollLeft) {
      kanban.scrollLeft = top.scrollLeft
    }
  }

  function handleKanbanScroll() {
    const top = topScrollRef.current
    const kanban = kanbanRef.current
    if (!top || !kanban) return
    if (top.scrollLeft !== kanban.scrollLeft) {
      top.scrollLeft = kanban.scrollLeft
    }
  }

  // Attache le listener au kanban via effet (le ref est setté par le children
  // render-prop, donc on doit lire kanbanRef.current dans un effet et y poser
  // un addEventListener manuel pour éviter onScroll sur un node dnd-kit).
  useEffect(() => {
    const kanban = kanbanRef.current
    if (!kanban) return
    kanban.addEventListener('scroll', handleKanbanScroll)
    return () => kanban.removeEventListener('scroll', handleKanbanScroll)
  }, [])

  return (
    <>
      <div
        ref={topScrollRef}
        onScroll={handleTopScroll}
        className="mb-2 h-3 overflow-x-auto overflow-y-hidden [scrollbar-color:oklch(70%_0.18_152_/_0.5)_transparent] [scrollbar-width:thin]"
        aria-hidden="true"
      >
        <div style={{ width: contentWidth, height: 1 }} />
      </div>
      {children(kanbanRef)}
    </>
  )
}
