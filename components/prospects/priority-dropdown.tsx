'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Priority } from '@/lib/types'

// Alias pour la priorité éditable manuellement (3 valeurs uniquement).
// TODO(coord-A): aligner sur ManualPriority si réintroduit dans lib/types.ts.
type ManualPriority = Extract<Priority, 'haute' | 'moyenne' | 'basse'>

// ── Constantes ────────────────────────────────────────────────────────────────

interface PriorityOption {
  value: ManualPriority
  label: string
  dot: string
  badge: string
}

const PRIORITY_OPTIONS: PriorityOption[] = [
  {
    value: 'haute',
    label: 'Priorité haute',
    dot: 'bg-red-500',
    badge:
      'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800',
  },
  {
    value: 'moyenne',
    label: 'Priorité moyenne',
    dot: 'bg-yellow-500',
    badge:
      'bg-yellow-50 text-yellow-700 border border-yellow-200 dark:bg-yellow-950/50 dark:text-yellow-400 dark:border-yellow-800',
  },
  {
    value: 'basse',
    label: 'Priorité basse',
    dot: 'bg-gray-400',
    badge:
      'bg-gray-100 text-gray-600 border border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
  },
]

// ── Props ─────────────────────────────────────────────────────────────────────

interface PriorityDropdownProps {
  prospectId: string
  currentPriorite: ManualPriority
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function PriorityDropdown({ prospectId, currentPriorite }: PriorityDropdownProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [priorite, setPriorite] = useState<ManualPriority>(currentPriorite)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    setPriorite(currentPriorite)
  }, [currentPriorite])

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

  async function handleSelect(next: ManualPriority) {
    if (next === priorite) {
      setOpen(false)
      return
    }
    const previous = priorite
    setPriorite(next)
    setOpen(false)
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/prospects/${prospectId}/priority`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priorite: next }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string | { message?: string } }
        const msg =
          typeof data.error === 'string'
            ? data.error
            : data.error?.message ?? 'Erreur lors de la mise à jour de la priorité'
        throw new Error(msg)
      }
      router.refresh()
    } catch (err) {
      setPriorite(previous)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setPending(false)
    }
  }

  const current = PRIORITY_OPTIONS.find((o) => o.value === priorite) ?? PRIORITY_OPTIONS[1]

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${current.label}. Cliquer pour modifier.`}
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
          aria-label="Sélectionner une priorité"
          className="absolute right-0 z-30 mt-1 w-48 origin-top-right overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {PRIORITY_OPTIONS.map((opt) => {
            const isCurrent = opt.value === priorite
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isCurrent}
                disabled={pending}
                onClick={() => handleSelect(opt.value)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800"
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
