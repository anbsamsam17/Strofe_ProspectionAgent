'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ProspectStatus } from '@/lib/types'

// ── Constantes ────────────────────────────────────────────────────────────────

interface StatusOption {
  value: ProspectStatus
  label: string
  dot: string
  badge: string
}

// Labels alignés sur les conventions UI partagées avec Agent C.
const STATUS_OPTIONS: StatusOption[] = [
  {
    value: 'sourced',
    label: 'Pas de contact identifié',
    dot: 'bg-gray-400',
    badge: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
  {
    value: 'qualified',
    label: 'Qualifié',
    dot: 'bg-blue-500',
    badge: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  },
  {
    value: 'contacted',
    label: 'Contacté',
    dot: 'bg-yellow-500',
    badge: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400',
  },
  {
    value: 'interested',
    label: 'Intéressé',
    dot: 'bg-green-500',
    badge: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400',
  },
  {
    value: 'offer_sent',
    label: 'Offre envoyée',
    dot: 'bg-indigo-500',
    badge: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400',
  },
  {
    value: 'converted',
    label: 'Affaire conclue',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  },
  {
    value: 'rejected',
    label: 'Sans suite',
    dot: 'bg-red-500',
    badge: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
  },
  {
    value: 'on_hold',
    label: 'En stand-by',
    dot: 'bg-orange-500',
    badge: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-400',
  },
]

// ── Props ─────────────────────────────────────────────────────────────────────

interface StatusDropdownProps {
  prospectId: string
  currentStatut: ProspectStatus
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function StatusDropdown({ prospectId, currentStatut }: StatusDropdownProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Optimistic state — l'UI bascule au clic, puis se cale sur le serveur via router.refresh().
  const [statut, setStatut] = useState<ProspectStatus>(currentStatut)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    setStatut(currentStatut)
  }, [currentStatut])

  // Fermer si clic hors menu / ESC.
  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  async function handleSelect(next: ProspectStatus) {
    if (next === statut) {
      setOpen(false)
      return
    }
    const previous = statut
    setStatut(next)
    setOpen(false)
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/prospects/${prospectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statut: next }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string | { message?: string } }
        const msg =
          typeof data.error === 'string'
            ? data.error
            : data.error?.message ?? 'Erreur lors de la mise à jour du statut'
        throw new Error(msg)
      }
      router.refresh()
    } catch (err) {
      // Rollback optimistic update.
      setStatut(previous)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setPending(false)
    }
  }

  const current = STATUS_OPTIONS.find((o) => o.value === statut) ?? STATUS_OPTIONS[0]

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Statut CRM : ${current.label}. Cliquer pour modifier.`}
        className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${current.badge}`}
      >
        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${current.dot}`} aria-hidden="true" />
        <span>{current.label}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Sélectionner un statut CRM"
          className="absolute right-0 z-30 mt-1 w-56 origin-top-right overflow-hidden rounded-xl border border-white/[0.08] bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {STATUS_OPTIONS.map((opt) => {
            const isCurrent = opt.value === statut
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isCurrent}
                disabled={pending}
                onClick={() => handleSelect(opt.value)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-white/[0.06] disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${opt.dot}`} aria-hidden="true" />
                <span className="flex-1">{opt.label}</span>
                {isCurrent && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-green-600 dark:text-green-400"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="absolute right-0 top-full z-30 mt-1 rounded-md bg-red-50 px-2.5 py-1 text-xs text-red-700 shadow-sm dark:bg-red-950/50 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  )
}
