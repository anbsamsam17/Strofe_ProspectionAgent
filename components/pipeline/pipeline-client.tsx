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

const COLUMN_STYLES: Record<string, { header: string; dot: string }> = {
  gray: {
    header: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    dot: 'bg-gray-400',
  },
  blue: {
    header: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  yellow: {
    header: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400',
    dot: 'bg-yellow-500',
  },
  purple: {
    header: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400',
    dot: 'bg-purple-500',
  },
  green: {
    header: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
    dot: 'bg-green-500',
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 dark:bg-black/70"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Contenu */}
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4">
          <div>
            <h2 id="modal-title" className="text-lg font-bold text-gray-900 dark:text-white">
              {prospect.raison_sociale}
            </h2>
            {currentColumn && (
              <span
                className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  COLUMN_STYLES[currentColumn.color]?.header ?? COLUMN_STYLES.gray.header
                }`}
              >
                {currentColumn.label}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer la modale"
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Corps */}
        <div className="space-y-4 px-6 pb-6">
          <div className="grid grid-cols-2 gap-3 text-sm">
            {prospect.secteur_libelle && (
              <div>
                <p className="text-xs font-medium text-gray-400 dark:text-gray-500">Secteur</p>
                <p className="font-medium text-gray-900 dark:text-white">{prospect.secteur_libelle}</p>
              </div>
            )}
            {prospect.ville && (
              <div>
                <p className="text-xs font-medium text-gray-400 dark:text-gray-500">Ville</p>
                <p className="font-medium text-gray-900 dark:text-white">{prospect.ville}</p>
              </div>
            )}
            {(prospect.effectif_min || prospect.effectif_max) && (
              <div>
                <p className="text-xs font-medium text-gray-400 dark:text-gray-500">Effectif</p>
                <p className="font-medium text-gray-900 dark:text-white">
                  {prospect.effectif_min}–{prospect.effectif_max} sal.
                </p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-gray-400 dark:text-gray-500">Score</p>
              <p className="font-bold text-green-600 dark:text-green-400">{prospect.score_priorite}</p>
            </div>
            {(prospect.contact_nom || prospect.contact_prenom) && (
              <div className="col-span-2">
                <p className="text-xs font-medium text-gray-400 dark:text-gray-500">Contact</p>
                <p className="font-medium text-gray-900 dark:text-white">
                  {[prospect.contact_prenom, prospect.contact_nom].filter(Boolean).join(' ')}
                  {prospect.contact_poste ? ` — ${prospect.contact_poste}` : ''}
                </p>
                {prospect.contact_telephone && (
                  <a
                    href={`tel:${prospect.contact_telephone.replace(/\s/g, '')}`}
                    className="mt-0.5 inline-flex items-center gap-1 text-sm text-green-600 hover:text-green-700 dark:text-green-400"
                    aria-label={`Appeler ${prospect.contact_telephone}`}
                  >
                    {prospect.contact_telephone}
                  </a>
                )}
              </div>
            )}
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400" role="alert">
              {error}
            </p>
          )}

          {/* Actions changement de statut */}
          <div className="flex flex-col gap-2 pt-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Changer le statut
            </p>
            <div className="flex flex-wrap gap-2">
              {prevStatus && (
                <button
                  onClick={() => handleChangeStatus(prevStatus)}
                  disabled={isChanging}
                  aria-label={`Rétrograder vers ${columns.find((c) => c.status === prevStatus)?.label}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  ← {columns.find((c) => c.status === prevStatus)?.label}
                </button>
              )}
              {nextStatus && (
                <button
                  onClick={() => handleChangeStatus(nextStatus)}
                  disabled={isChanging}
                  aria-label={`Avancer vers ${columns.find((c) => c.status === nextStatus)?.label}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {columns.find((c) => c.status === nextStatus)?.label} →
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
      {/* Kanban — scroll horizontal sur mobile */}
      <div
        className="flex gap-4 overflow-x-auto pb-4"
        role="region"
        aria-label="Pipeline CRM — vue kanban"
      >
        {columns.map((column) => {
          const items = prospects[column.status] ?? []
          const styles = COLUMN_STYLES[column.color] ?? COLUMN_STYLES.gray

          return (
            <div
              key={column.status}
              className="flex w-64 flex-none flex-col gap-3 sm:w-72"
              role="group"
              aria-label={`Colonne ${column.label} — ${items.length} prospects`}
            >
              {/* En-tête colonne */}
              <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${styles.header}`}>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${styles.dot}`} aria-hidden="true" />
                  <span className="text-sm font-semibold">{column.label}</span>
                </div>
                <span className="rounded-full bg-white/60 px-2 py-0.5 text-xs font-bold tabular-nums dark:bg-black/20">
                  {items.length}
                </span>
              </div>

              {/* Cards prospects */}
              <div className="flex flex-col gap-2">
                {items.length === 0 ? (
                  <div className="rounded-xl border-2 border-dashed border-gray-200 p-4 text-center text-xs text-gray-400 dark:border-gray-800 dark:text-gray-600">
                    Aucun prospect
                  </div>
                ) : (
                  items.map((prospect) => (
                    <button
                      key={prospect.id}
                      type="button"
                      onClick={() => setSelectedProspect(prospect)}
                      aria-label={`Voir les détails de ${prospect.raison_sociale}`}
                      className="w-full rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:border-green-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-green-700"
                    >
                      <p className="font-semibold text-gray-900 line-clamp-1 dark:text-white">
                        {prospect.raison_sociale}
                      </p>
                      {prospect.secteur_libelle && (
                        <p className="mt-0.5 text-xs text-gray-500 line-clamp-1 dark:text-gray-400">
                          {prospect.secteur_libelle}
                        </p>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs text-gray-400 dark:text-gray-600">
                          {prospect.ville ?? '—'}
                        </span>
                        <span className="flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                          <span className="text-green-500" aria-hidden="true">◆</span>
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
