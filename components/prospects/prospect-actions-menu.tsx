'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ProspectStatus } from '@/lib/types'

interface ProspectActionsMenuProps {
  prospectId: string
  prospectName: string
  currentStatut: ProspectStatus
  archived: boolean
}

const STATUS_OPTIONS: { value: ProspectStatus; label: string; dot: string }[] = [
  { value: 'sourced', label: 'Sourcé', dot: 'bg-gray-400' },
  { value: 'qualified', label: 'Qualifié', dot: 'bg-blue-500' },
  { value: 'contacted', label: 'Contacté', dot: 'bg-yellow-500' },
  { value: 'interested', label: 'Intéressé', dot: 'bg-green-500' },
  { value: 'rdv', label: 'RDV', dot: 'bg-purple-500' },
  { value: 'converted', label: 'Converti', dot: 'bg-emerald-500' },
  { value: 'rejected', label: 'Rejeté', dot: 'bg-red-500' },
  { value: 'on_hold', label: 'En pause', dot: 'bg-orange-500' },
]

// Statuts dont la suppression directe est interdite côté API (cf. route DELETE).
// On les utilise ici pour griser le bouton "Supprimer" si le prospect n'est pas archivé.
const PROTECTED_STATUTS: ProspectStatus[] = ['interested', 'rdv', 'converted']

export function ProspectActionsMenu({
  prospectId,
  prospectName,
  currentStatut,
  archived,
}: ProspectActionsMenuProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Fermer si clic hors menu (pattern dropdown standard).
  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setStatusOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/prospects/${prospectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? 'Erreur lors de la mise à jour')
      }
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      return false
    } finally {
      setPending(false)
    }
  }

  async function handleArchive() {
    const ok = await patch({ archived: !archived })
    if (ok) {
      setOpen(false)
      router.refresh()
    }
  }

  async function handleStatusChange(next: ProspectStatus) {
    if (next === currentStatut) {
      setStatusOpen(false)
      setOpen(false)
      return
    }
    const ok = await patch({ statut: next })
    if (ok) {
      setStatusOpen(false)
      setOpen(false)
      router.refresh()
    }
  }

  async function handleDelete() {
    const isProtected = PROTECTED_STATUTS.includes(currentStatut)
    if (isProtected && !archived) {
      setError('Statut protégé — archivez d’abord ce prospect.')
      return
    }
    const confirmed = window.confirm(
      `Supprimer définitivement "${prospectName}" ? Cette action est irréversible.`,
    )
    if (!confirmed) return

    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/prospects/${prospectId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? 'Erreur lors de la suppression')
      }
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setPending(false)
    }
  }

  function handleOpenNotes() {
    // Pas d'éditeur inline sur la ligne du tableau — on renvoie vers la fiche
    // où le composant ProspectNotes propose l'édition complète.
    setOpen(false)
    router.push(`/prospects/${prospectId}#notes`)
  }

  const deleteBlocked = PROTECTED_STATUTS.includes(currentStatut) && !archived

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions pour ${prospectName}`}
        disabled={pending}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md text-gray-300 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white disabled:opacity-60"
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
          <circle cx="12" cy="5" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="12" cy="19" r="1" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-56 origin-top-right overflow-hidden rounded-lg border border-white/[0.08] bg-[oklch(14%_0.02_240)]/95 backdrop-blur-xl py-1 shadow-2xl ring-1 ring-black/30"
        >
          {/* Statut */}
          <button
            type="button"
            role="menuitem"
            onClick={() => setStatusOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-white/[0.06]"
          >
            <span className="inline-flex items-center gap-2">
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
                <polyline points="16 3 21 3 21 8" />
                <line x1="4" y1="20" x2="21" y2="3" />
                <polyline points="21 16 21 21 16 21" />
                <line x1="15" y1="15" x2="21" y2="21" />
                <line x1="4" y1="4" x2="9" y2="9" />
              </svg>
              Changer le statut
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform ${statusOpen ? 'rotate-90' : ''}`}
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          {statusOpen && (
            <div className="border-t border-white/[0.06] bg-white/[0.02] py-1">
              {STATUS_OPTIONS.map((opt) => {
                const isCurrent = opt.value === currentStatut
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="menuitem"
                    disabled={pending || isCurrent}
                    onClick={() => handleStatusChange(opt.value)}
                    className="flex w-full items-center gap-2 px-5 py-1.5 text-left text-xs text-gray-300 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span
                      className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${opt.dot}`}
                      aria-hidden="true"
                    />
                    {opt.label}
                    {isCurrent && (
                      <span className="ml-auto text-[10px] text-green-400">
                        actuel
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {/* Notes */}
          <button
            type="button"
            role="menuitem"
            onClick={handleOpenNotes}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-white/[0.06]"
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
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <line x1="10" y1="9" x2="8" y2="9" />
            </svg>
            Notes
          </button>

          {/* Archive / Désarchive */}
          <button
            type="button"
            role="menuitem"
            disabled={pending}
            onClick={handleArchive}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-white/[0.06] disabled:opacity-50"
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
            {archived ? 'Désarchiver' : 'Archiver'}
          </button>

          {/* Supprimer */}
          <div className="my-1 border-t border-white/[0.06]" />
          <button
            type="button"
            role="menuitem"
            disabled={pending || deleteBlocked}
            onClick={handleDelete}
            title={
              deleteBlocked
                ? 'Statut protégé — archivez d’abord ce prospect.'
                : `Supprimer ${prospectName}`
            }
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
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
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
            </svg>
            Supprimer
          </button>

          {error && (
            <p
              role="alert"
              className="border-t border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200"
            >
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
