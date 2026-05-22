'use client'

// ============================================================
// BulkDeleteButton
//
// Bouton "Supprimer N prospects" placé dans le header de /prospects.
// Visible uniquement si au moins UN filtre est actif (garde-fou
// pour ne JAMAIS supprimer toute la base par accident).
//
// Confirmation forte :
//   - Affiche le count exact des prospects ciblés.
//   - Liste les filtres actifs en bullets.
//   - L'utilisateur doit taper SUPPRIMER pour activer le bouton.
//   - Dialog modal classique (ESC + backdrop + Annuler).
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ProspectStatus } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export type BulkContactFilter = 'phone' | 'email' | 'linkedin'
export type BulkBegesFilter = 'missing' | 'obligation'

export interface BulkDeleteFilters {
  statut?: ProspectStatus[]
  secteur?: string
  score_min?: number
  archived?: boolean
  contact_type?: BulkContactFilter[]
  beges?: BulkBegesFilter[]
}

interface BulkDeleteButtonProps {
  /** Filtres tels qu'appliqués sur la page (issus de searchParams). */
  filters: BulkDeleteFilters
  /** Nombre de prospects ciblés (count exact retourné par la query parent). */
  count: number
}

// ── Constantes ────────────────────────────────────────────────────────────────

const CONFIRM_WORD = 'SUPPRIMER'

const STATUS_LABELS_FR: Record<string, string> = {
  sourced: 'Nouveau',
  qualified: 'Qualifié',
  contacted: 'Contacté',
  interested: 'Intéressé',
  rdv: 'RDV',
  offer_sent: 'Offre envoyée',
  converted: 'Affaire conclue',
  rejected: 'Sans suite',
  on_hold: 'En stand-by',
  do_not_contact: 'Ne pas contacter',
}

const CONTACT_LABELS_FR: Record<BulkContactFilter, string> = {
  phone: 'Téléphone',
  email: 'Email',
  linkedin: 'LinkedIn',
}

const BEGES_LABELS_FR: Record<BulkBegesFilter, string> = {
  missing: 'BEGES manquant',
  obligation: 'Obligation BEGES',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isFilterActive(filters: BulkDeleteFilters): boolean {
  return Boolean(
    (filters.statut && filters.statut.length > 0) ||
      (filters.secteur && filters.secteur.length > 0) ||
      (filters.score_min !== undefined && filters.score_min > 0) ||
      filters.archived === true ||
      (filters.contact_type && filters.contact_type.length > 0) ||
      (filters.beges && filters.beges.length > 0),
  )
}

function formatFiltersForDisplay(filters: BulkDeleteFilters): string[] {
  const bullets: string[] = []

  if (filters.statut && filters.statut.length > 0) {
    const labels = filters.statut.map((s) => STATUS_LABELS_FR[s] ?? s).join(', ')
    bullets.push(`Statut : ${labels}`)
  }
  if (filters.secteur && filters.secteur.length > 0) {
    bullets.push(`Secteur : "${filters.secteur}"`)
  }
  if (filters.score_min !== undefined && filters.score_min > 0) {
    bullets.push(`Score ≥ ${filters.score_min}`)
  }
  if (filters.archived === true) {
    bullets.push('Archivés uniquement')
  } else {
    bullets.push('Non archivés uniquement')
  }
  if (filters.contact_type && filters.contact_type.length > 0) {
    const labels = filters.contact_type.map((t) => CONTACT_LABELS_FR[t]).join(', ')
    bullets.push(`Canal disponible : ${labels}`)
  }
  if (filters.beges && filters.beges.length > 0) {
    const labels = filters.beges.map((b) => BEGES_LABELS_FR[b]).join(', ')
    bullets.push(labels)
  }

  return bullets
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function BulkDeleteButton({ filters, count }: BulkDeleteButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const filterIsActive = isFilterActive(filters)
  const filterBullets = useMemo(() => formatFiltersForDisplay(filters), [filters])
  const canConfirm = confirmText.trim() === CONFIRM_WORD && !pending

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeDialog()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function closeDialog() {
    if (pending) return
    setOpen(false)
    setConfirmText('')
    setError(null)
    triggerRef.current?.focus()
  }

  async function handleConfirm() {
    if (!canConfirm) return
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/prospects/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string | { message?: string }
        }
        const msg =
          typeof data.error === 'string'
            ? data.error
            : data.error?.message ?? 'Erreur lors de la suppression'
        throw new Error(msg)
      }
      setOpen(false)
      setConfirmText('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setPending(false)
    }
  }

  // Pas d'affichage si pas de filtre actif — garde-fou strict.
  // (On affiche tout de même un bouton désactivé en cas de count 0 pour la lisibilité.)
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => filterIsActive && setOpen(true)}
        disabled={!filterIsActive || count === 0}
        aria-label={
          filterIsActive
            ? `Supprimer les ${count} prospects filtrés`
            : 'Aucun filtre actif — suppression en masse désactivée'
        }
        title={
          filterIsActive
            ? `Supprimer ${count} prospects correspondant aux filtres`
            : 'Appliquez au moins un filtre pour activer la suppression en masse'
        }
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 ring-1 ring-red-500/25 transition-colors hover:border-red-500/40 hover:bg-red-500/20 hover:text-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 disabled:cursor-not-allowed disabled:opacity-40"
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
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        </svg>
        Supprimer les filtrés
        {filterIsActive && (
          <span className="ml-1 rounded-md bg-red-500/20 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-red-200">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-delete-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDialog()
          }}
        >
          <div className="w-[calc(100vw-2rem)] max-w-md rounded-2xl border border-white/[0.08] bg-[oklch(14%_0.02_240)]/95 backdrop-blur-md p-6 shadow-2xl ring-1 ring-black/30">
            <div className="mb-5 flex items-start gap-3">
              <div
                aria-hidden="true"
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-500/15 ring-1 ring-red-500/25"
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
                  className="text-red-300"
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div className="flex-1">
                <h3
                  id="bulk-delete-title"
                  className="text-lg font-semibold text-white"
                >
                  Supprimer {count} prospect{count > 1 ? 's' : ''} ?
                </h3>
                <p className="mt-1.5 text-sm text-gray-300">
                  Cette action correspond aux filtres actifs et est{' '}
                  <span className="font-semibold text-red-300">IRRÉVERSIBLE</span>.
                </p>
              </div>
            </div>

            {/* Filtres actifs en bullets */}
            <div className="mb-5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
                Filtres actifs
              </p>
              <ul className="space-y-1 text-xs text-gray-300">
                {filterBullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-gray-500"
                    />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Champ de confirmation textuelle */}
            <div className="mb-5">
              <label
                htmlFor="bulk-delete-confirm"
                className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80"
              >
                Taper{' '}
                <span className="font-bold text-red-300">{CONFIRM_WORD}</span>{' '}
                pour confirmer
              </label>
              <input
                ref={inputRef}
                id="bulk-delete-confirm"
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={CONFIRM_WORD}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2.5 text-sm text-white placeholder:text-gray-500 transition focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/30"
              />
            </div>

            {error && (
              <p
                role="alert"
                className="mb-4 rounded-lg bg-red-500/15 px-3 py-2.5 text-sm text-red-200 ring-1 ring-red-500/25"
              >
                {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeDialog}
                disabled={pending}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-4 py-2.5 text-sm font-medium text-gray-200 transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!canConfirm}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending
                  ? 'Suppression…'
                  : `Supprimer ${count} prospect${count > 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
