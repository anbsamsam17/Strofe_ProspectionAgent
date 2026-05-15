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

import { useCallback, useId, useMemo, useState } from 'react'
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
import { KanbanSidePanel } from './kanban-side-panel'

// ── Types ─────────────────────────────────────────────────────────────────────

// `offer_sent` est un nouveau statut ajouté par Agent A à `ProspectStatus`. Tant
// que ce merge n'a pas eu lieu, on type-élargit localement pour ne pas casser
// le build des autres composants qui dépendent encore de l'enum existant.
// TODO(coord-A): remplacer par ProspectStatus une fois `offer_sent` mergé.
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
    header: 'bg-gray-100 dark:bg-gray-800/60',
    headerText: 'text-gray-700 dark:text-gray-300',
    dot: 'bg-gray-400',
    badge: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    card: 'border-gray-200 dark:border-gray-800',
    cardHover: 'hover:border-gray-300 hover:shadow-md dark:hover:border-gray-700',
    accent: 'bg-gray-400',
  },
  blue: {
    header: 'bg-blue-50 dark:bg-blue-950/40',
    headerText: 'text-blue-800 dark:text-blue-300',
    dot: 'bg-blue-500',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
    card: 'border-blue-100 dark:border-blue-900/40',
    cardHover: 'hover:border-blue-300 hover:shadow-md dark:hover:border-blue-700',
    accent: 'bg-blue-500',
  },
  yellow: {
    header: 'bg-yellow-50 dark:bg-yellow-950/30',
    headerText: 'text-yellow-800 dark:text-yellow-300',
    dot: 'bg-yellow-500',
    badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400',
    card: 'border-yellow-100 dark:border-yellow-900/40',
    cardHover: 'hover:border-yellow-300 hover:shadow-md dark:hover:border-yellow-700',
    accent: 'bg-yellow-500',
  },
  purple: {
    header: 'bg-purple-50 dark:bg-purple-950/30',
    headerText: 'text-purple-800 dark:text-purple-300',
    dot: 'bg-purple-500',
    badge: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400',
    card: 'border-purple-100 dark:border-purple-900/40',
    cardHover: 'hover:border-purple-300 hover:shadow-md dark:hover:border-purple-700',
    accent: 'bg-purple-500',
  },
  green: {
    header: 'bg-green-50 dark:bg-green-950/30',
    headerText: 'text-green-800 dark:text-green-300',
    dot: 'bg-green-500',
    badge: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
    card: 'border-green-100 dark:border-green-900/40',
    cardHover: 'hover:border-green-300 hover:shadow-md dark:hover:border-green-700',
    accent: 'bg-green-500',
  },
  red: {
    header: 'bg-red-50 dark:bg-red-950/30',
    headerText: 'text-red-800 dark:text-red-300',
    dot: 'bg-red-500',
    badge: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
    card: 'border-red-100 dark:border-red-900/40',
    cardHover: 'hover:border-red-300 hover:shadow-md dark:hover:border-red-700',
    accent: 'bg-red-500',
  },
  orange: {
    header: 'bg-orange-50 dark:bg-orange-950/30',
    headerText: 'text-orange-800 dark:text-orange-300',
    dot: 'bg-orange-500',
    badge: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400',
    card: 'border-orange-100 dark:border-orange-900/40',
    cardHover: 'hover:border-orange-300 hover:shadow-md dark:hover:border-orange-700',
    accent: 'bg-orange-500',
  },
  indigo: {
    header: 'bg-indigo-50 dark:bg-indigo-950/40',
    headerText: 'text-indigo-800 dark:text-indigo-300',
    dot: 'bg-indigo-500',
    badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400',
    card: 'border-indigo-100 dark:border-indigo-900/40',
    cardHover: 'hover:border-indigo-300 hover:shadow-md dark:hover:border-indigo-700',
    accent: 'bg-indigo-500',
  },
  emerald: {
    header: 'bg-emerald-50 dark:bg-emerald-950/40',
    headerText: 'text-emerald-800 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
    card: 'border-emerald-100 dark:border-emerald-900/40',
    cardHover: 'hover:border-emerald-300 hover:shadow-md dark:hover:border-emerald-700',
    accent: 'bg-emerald-500',
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
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400"
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
        {/* Kanban — scroll horizontal sur 8 colonnes */}
        <div
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

  return (
    <div
      ref={setNodeRef}
      className={`flex w-[280px] flex-none flex-col gap-3 rounded-2xl p-2 transition-colors duration-150 sm:w-[300px] ${
        isOver
          ? 'bg-green-50/30 ring-2 ring-green-400 dark:bg-green-950/20'
          : 'bg-transparent ring-2 ring-transparent'
      }`}
      role="group"
      aria-label={`Colonne ${column.label} — ${items.length} prospect${items.length > 1 ? 's' : ''}`}
    >
      <div
        className={`flex items-center justify-between rounded-2xl px-4 py-3 ${styles.header}`}
      >
        <div className="flex items-center gap-2.5">
          <span
            className={`h-2.5 w-2.5 rounded-full ${styles.dot} shadow-sm`}
            aria-hidden="true"
          />
          <span className={`text-sm font-semibold ${styles.headerText}`}>
            {column.label}
          </span>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${styles.badge}`}
        >
          {items.length}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-white/[0.08] px-4 py-8 text-center dark:border-gray-800">
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
              className="text-gray-300 dark:text-gray-700"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="9" x2="15" y2="9" />
              <line x1="9" y1="12" x2="15" y2="12" />
              <line x1="9" y1="15" x2="12" y2="15" />
            </svg>
            <p className="text-xs text-gray-400 dark:text-gray-600">Aucun prospect</p>
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
}

function DraggableCard({
  prospect,
  styles,
  isBeingDragged,
  onSelect,
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

  return (
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
        className="font-semibold leading-tight text-gray-900 line-clamp-1 transition-colors group-hover:text-green-700 dark:text-white dark:group-hover:text-green-400"
      >
        {prospect.raison_sociale}
      </p>

      {prospect.secteur_libelle && (
        <span className="mt-2 inline-block max-w-full truncate rounded-md bg-white/[0.05] px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          {prospect.secteur_libelle}
        </span>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-gray-400 dark:text-gray-600">
          {prospect.ville ?? '—'}
        </span>
        <span
          className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${
            prospect.score_priorite >= 75
              ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400'
              : prospect.score_priorite >= 50
                ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
          }`}
          aria-label={`Score : ${prospect.score_priorite}`}
        >
          {prospect.score_priorite}
        </span>
      </div>
    </div>
  )
}

// ── Preview rendue dans le DragOverlay ────────────────────────────────────────

function ProspectCardPreview({ prospect }: { prospect: Prospect }) {
  return (
    <div
      className="pointer-events-none w-[280px] rotate-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md p-4 shadow-2xl ring-1 ring-black/5 dark:border-gray-700 dark:bg-gray-900 dark:ring-white/10 sm:w-[300px]"
      aria-hidden="true"
    >
      <p className="font-semibold leading-tight text-gray-900 line-clamp-1 dark:text-white">
        {prospect.raison_sociale}
      </p>
      {prospect.secteur_libelle && (
        <span className="mt-2 inline-block max-w-full truncate rounded-md bg-white/[0.05] px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          {prospect.secteur_libelle}
        </span>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-gray-400 dark:text-gray-600">
          {prospect.ville ?? '—'}
        </span>
        <span
          className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${
            prospect.score_priorite >= 75
              ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400'
              : prospect.score_priorite >= 50
                ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
          }`}
        >
          {prospect.score_priorite}
        </span>
      </div>
    </div>
  )
}
