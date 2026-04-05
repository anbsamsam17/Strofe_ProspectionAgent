'use client'

import { useState } from 'react'
import type { Prospect, ProspectStatus } from '@/lib/types'

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
}

const NEXT_STATUS: Partial<Record<ProspectStatus, ProspectStatus>> = {
  sourced: 'qualified',
  qualified: 'contacted',
  contacted: 'rdv',
  rdv: 'converted',
}

const PREV_STATUS: Partial<Record<ProspectStatus, ProspectStatus>> = {
  qualified: 'sourced',
  contacted: 'qualified',
  rdv: 'contacted',
  converted: 'rdv',
}

// ── Modale détail prospect ────────────────────────────────────────────────────

function ProspectModal({
  prospect,
  columns,
  onClose,
  onStatusChange,
}: {
  prospect: Prospect
  columns: PipelineColumn[]
  onClose: () => void
  onStatusChange: (id: string, newStatus: ProspectStatus) => void
}) {
  const [isChanging, setIsChanging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nextStatus = NEXT_STATUS[prospect.statut as ProspectStatus]
  const prevStatus = PREV_STATUS[prospect.statut as ProspectStatus]

  async function handleChangeStatus(newStatus: ProspectStatus) {
    setIsChanging(true)
    setError(null)
    try {
      const response = await fetch(`/api/prospects/${prospect.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statut: newStatus }),
      })
      if (!response.ok) {
        const data = await response.json() as { error?: string }
        throw new Error(data.error ?? 'Erreur lors du changement de statut')
      }
      onStatusChange(prospect.id, newStatus)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setIsChanging(false)
    }
  }

  const currentColumn = columns.find((c) => c.status === prospect.statut)
  const styles = COLUMN_STYLES[currentColumn?.color ?? 'gray'] ?? COLUMN_STYLES.gray

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm dark:bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Contenu */}
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 dark:bg-gray-900 dark:ring-white/10">
        {/* Bande couleur en haut */}
        <div className={`h-1 w-full rounded-t-2xl ${styles.accent}`} aria-hidden="true" />

        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4">
          <div className="min-w-0 flex-1">
            <h2
              id="modal-title"
              className="truncate text-lg font-bold text-gray-900 dark:text-white"
            >
              {prospect.raison_sociale}
            </h2>
            {currentColumn && (
              <span
                className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles.badge}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} aria-hidden="true" />
                {currentColumn.label}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer la modale"
            className="ml-4 flex-shrink-0 rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Corps */}
        <div className="space-y-4 px-6 pb-6">
          {/* Infos grille */}
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-800/50">
            {prospect.secteur_libelle && (
              <div>
                <p className="text-xs font-medium text-gray-400 dark:text-gray-500">Secteur</p>
                <p className="mt-0.5 font-medium text-gray-900 dark:text-white">
                  {prospect.secteur_libelle}
                </p>
              </div>
            )}
            {prospect.ville && (
              <div>
                <p className="text-xs font-medium text-gray-400 dark:text-gray-500">Ville</p>
                <p className="mt-0.5 font-medium text-gray-900 dark:text-white">{prospect.ville}</p>
              </div>
            )}
            {(prospect.effectif_min || prospect.effectif_max) && (
              <div>
                <p className="text-xs font-medium text-gray-400 dark:text-gray-500">Effectif</p>
                <p className="mt-0.5 font-medium text-gray-900 dark:text-white">
                  {prospect.effectif_min}–{prospect.effectif_max} sal.
                </p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-gray-400 dark:text-gray-500">Score</p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-lg font-bold text-green-600 dark:text-green-400">
                  {prospect.score_priorite}
                </span>
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className="h-1.5 rounded-full bg-green-500"
                    style={{ width: `${Math.min(100, prospect.score_priorite)}%` }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            </div>

            {(prospect.contact_nom || prospect.contact_prenom) && (
              <div className="col-span-2">
                <p className="text-xs font-medium text-gray-400 dark:text-gray-500">Contact</p>
                <p className="mt-0.5 font-medium text-gray-900 dark:text-white">
                  {[prospect.contact_prenom, prospect.contact_nom].filter(Boolean).join(' ')}
                  {prospect.contact_poste ? ` — ${prospect.contact_poste}` : ''}
                </p>
                {prospect.contact_telephone && (
                  <a
                    href={`tel:${prospect.contact_telephone.replace(/\s/g, '')}`}
                    className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-green-600 hover:text-green-700 dark:text-green-400"
                    aria-label={`Appeler ${prospect.contact_telephone}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.5 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 5.27 5.27l1.17-1.17a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.28 15l.64 1.92z" />
                    </svg>
                    {prospect.contact_telephone}
                  </a>
                )}
              </div>
            )}
          </div>

          {error && (
            <p
              className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400"
              role="alert"
            >
              {error}
            </p>
          )}

          {/* Actions changement de statut */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Changer le statut
            </p>
            <div className="flex flex-wrap gap-2">
              {prevStatus && (
                <button
                  onClick={() => handleChangeStatus(prevStatus)}
                  disabled={isChanging}
                  aria-label={`Rétrograder vers ${columns.find((c) => c.status === prevStatus)?.label}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-600 transition-all hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-600"
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
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  {columns.find((c) => c.status === prevStatus)?.label}
                </button>
              )}
              {nextStatus && (
                <button
                  onClick={() => handleChangeStatus(nextStatus)}
                  disabled={isChanging}
                  aria-label={`Avancer vers ${columns.find((c) => c.status === nextStatus)?.label}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3.5 py-2 text-sm font-semibold text-white transition-all hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {columns.find((c) => c.status === nextStatus)?.label}
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
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────

export function PipelineClient({
  columns,
  prospectsByStatus,
}: PipelineClientProps) {
  const [prospects, setProspects] = useState(prospectsByStatus)
  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null)

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
      {/* Kanban — scroll horizontal */}
      <div
        className="flex gap-4 overflow-x-auto pb-6"
        role="region"
        aria-label="Pipeline CRM — vue kanban"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {columns.map((column) => {
          const items = prospects[column.status] ?? []
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

      {/* Modale détail */}
      {selectedProspect && (
        <ProspectModal
          prospect={selectedProspect}
          columns={columns}
          onClose={() => setSelectedProspect(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </>
  )
}
