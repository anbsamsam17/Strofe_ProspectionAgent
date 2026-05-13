'use client'

import { useMemo, useState } from 'react'
import type { Prospect, ProspectStatus } from '@/lib/types'
import { KanbanSidePanel } from './kanban-side-panel'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PipelineColumn {
  status: ProspectStatus
  label: string
  color: string
}

interface PipelineClientProps {
  columns: PipelineColumn[]
  prospectsByStatus: Record<ProspectStatus, Prospect[]>
}

// Colonnes d'archive — masquées par défaut, affichées via toggle.
// On les déclare en local car la page n'en envoie que 5 visibles ; ces 2 colonnes
// sont conceptuellement spécifiques au panneau "Archive" du Kanban.
const ARCHIVE_COLUMNS: PipelineColumn[] = [
  { status: 'rejected', label: 'Rejeté', color: 'red' },
  { status: 'on_hold', label: 'En pause', color: 'orange' },
]

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
}

// Les chaînes de transition (prev/next) vivent maintenant dans kanban-side-panel.tsx
// puisque c'est le seul endroit où on les déclenche.

// ── Composant principal ───────────────────────────────────────────────────────

export function PipelineClient({
  columns,
  prospectsByStatus,
}: PipelineClientProps) {
  const [prospects, setProspects] = useState(prospectsByStatus)
  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null)
  const [showArchive, setShowArchive] = useState(false)

  // Fusion visuelle : les prospects "intéressés" sont rendus dans la colonne
  // Qualifié, avec un badge "Intéressé" en plus. La logique de transition
  // (PATCH /api/prospects/[id]) ne change pas — seule la présentation est fusionnée.
  const displayedByColumn = useMemo<Record<ProspectStatus, Prospect[]>>(() => {
    const merged: Record<ProspectStatus, Prospect[]> = {
      ...prospects,
      qualified: [
        ...(prospects.qualified ?? []),
        ...(prospects.interested ?? []),
      ],
    }
    return merged
  }, [prospects])

  const archiveCount =
    (prospects.rejected?.length ?? 0) + (prospects.on_hold?.length ?? 0)

  const visibleColumns = showArchive ? [...columns, ...ARCHIVE_COLUMNS] : columns

  function handleStatusChange(id: string, newStatus: ProspectStatus) {
    setProspects((prev) => {
      const updated = { ...prev }
      // Retire le prospect de toutes les colonnes
      for (const key of Object.keys(updated) as ProspectStatus[]) {
        updated[key] = updated[key].filter((p) => p.id !== id)
      }
      // Cherche le prospect dans les données précédentes pour le mettre à jour
      const allProspects = Object.values(prev).flat()
      const prospect = allProspects.find((p) => p.id === id)
      if (prospect) {
        updated[newStatus] = [{ ...prospect, statut: newStatus }, ...updated[newStatus]]
      }
      return updated
    })
  }

  return (
    <>
      {/* Barre Kanban — toggle archive à droite */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Kanban
        </p>
        <button
          type="button"
          onClick={() => setShowArchive((v) => !v)}
          aria-pressed={showArchive}
          aria-label={
            showArchive
              ? "Masquer l'archive"
              : `Afficher l'archive (${archiveCount} prospects)`
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:bg-gray-800"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
          {showArchive ? "Masquer l'archive" : `Voir l'archive`}
          <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {archiveCount}
          </span>
        </button>
      </div>

      {/* Kanban — scroll horizontal */}
      <div
        className="flex gap-4 overflow-x-auto pb-6"
        role="region"
        aria-label="Pipeline CRM — vue kanban"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {visibleColumns.map((column) => {
          const items = displayedByColumn[column.status] ?? []
          const styles = COLUMN_STYLES[column.color] ?? COLUMN_STYLES.gray

          return (
            <div
              key={column.status}
              className="flex w-[280px] flex-none flex-col gap-3 sm:w-[300px]"
              role="group"
              aria-label={`Colonne ${column.label} — ${items.length} prospect${items.length > 1 ? 's' : ''}`}
              style={{ scrollSnapAlign: 'start' }}
            >
              {/* En-tête colonne */}
              <div
                className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 ${styles.header}`}
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

              {/* Cards prospects */}
              <div className="flex flex-col gap-2">
                {items.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-200 px-4 py-8 text-center dark:border-gray-800">
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
                    <button
                      key={prospect.id}
                      type="button"
                      onClick={() => setSelectedProspect(prospect)}
                      aria-label={`Voir les détails de ${prospect.raison_sociale}`}
                      className={`group w-full rounded-xl border bg-white p-4 text-left shadow-sm transition-all duration-150 dark:bg-gray-900 ${styles.card} ${styles.cardHover} hover:-translate-y-0.5`}
                    >
                      {/* Nom de l'entreprise */}
                      <p className="font-semibold leading-tight text-gray-900 line-clamp-1 transition-colors group-hover:text-green-700 dark:text-white dark:group-hover:text-green-400">
                        {prospect.raison_sociale}
                      </p>

                      {/* Badge "Intéressé" — visible uniquement pour les prospects
                          fusionnés depuis le statut interested dans la colonne Qualifié. */}
                      {prospect.statut === 'interested' && (
                        <span
                          className="mt-2 inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-700 ring-1 ring-green-200 dark:bg-green-950/50 dark:text-green-300 dark:ring-green-900/60"
                          aria-label="Statut intéressé"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                          </svg>
                          Intéressé
                        </span>
                      )}

                      {/* Secteur tag */}
                      {prospect.secteur_libelle && (
                        <span className="mt-2 inline-block max-w-full truncate rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                          {prospect.secteur_libelle}
                        </span>
                      )}

                      {/* Footer : ville + score */}
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-gray-400 dark:text-gray-600">
                          {prospect.ville ?? '—'}
                        </span>
                        {/* Score badge circulaire */}
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
                    </button>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Side panel détail prospect — slide-in droit. On garde le composant
          monté pour conserver la transition de sortie ; il gère lui-même
          l'état visible via la prop `open`. */}
      {selectedProspect && (
        <KanbanSidePanel
          prospect={selectedProspect}
          columns={columns}
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
