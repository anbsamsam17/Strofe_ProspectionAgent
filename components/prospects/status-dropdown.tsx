'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ProspectStatus } from '@/lib/types'
import { Confetti } from '@/components/ui/confetti'

// ── Constantes ────────────────────────────────────────────────────────────────

interface StatusOption {
  value: ProspectStatus
  label: string
  dot: string
  badge: string
}

// Labels alignés sur les conventions UI partagées avec Agent C.
// Dark-forced theme : variantes translucides (glass) uniquement, pas de bg-{c}-50/100.
const STATUS_OPTIONS: StatusOption[] = [
  {
    value: 'sourced',
    label: 'Nouveau',
    dot: 'bg-gray-400',
    badge: 'bg-white/[0.06] text-gray-200 ring-1 ring-white/[0.08]',
  },
  {
    value: 'qualified',
    label: 'Qualifié',
    dot: 'bg-blue-400',
    badge: 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/25',
  },
  // Migration 028 — décision humaine d'amorce, entre 'qualified' et 'contacted'.
  // Cyan : visuellement distinct du bleu 'qualified' (qualif auto) et du jaune
  // 'contacted' (1er contact effectif).
  {
    value: 'to_contact',
    label: 'À contacter',
    dot: 'bg-cyan-400',
    badge: 'bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-500/25',
  },
  {
    value: 'contacted',
    label: 'Contacté',
    dot: 'bg-yellow-400',
    badge: 'bg-yellow-500/15 text-yellow-200 ring-1 ring-yellow-500/25',
  },
  {
    value: 'interested',
    label: 'Intéressé',
    dot: 'bg-green-400',
    badge: 'bg-green-500/15 text-green-200 ring-1 ring-green-500/25',
  },
  {
    value: 'offer_sent',
    label: 'Offre envoyée',
    dot: 'bg-indigo-400',
    badge: 'bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-500/25',
  },
  {
    value: 'converted',
    label: 'Affaire conclue',
    dot: 'bg-emerald-400',
    badge: 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/25',
  },
  {
    value: 'rejected',
    label: 'Sans suite',
    dot: 'bg-red-400',
    badge: 'bg-red-500/15 text-red-200 ring-1 ring-red-500/25',
  },
  {
    value: 'on_hold',
    label: 'En stand-by',
    dot: 'bg-orange-400',
    badge: 'bg-orange-500/15 text-orange-200 ring-1 ring-orange-500/25',
  },
  // Migration 017 : opt-out manuel utilisateur — sémantique "ne jamais contacter".
  // Slate (neutre) délibérément distinct du rouge 'rejected' (refus actif).
  {
    value: 'do_not_contact',
    label: 'Ne pas contacter',
    dot: 'bg-slate-400',
    badge: 'bg-slate-500/15 text-slate-200 ring-1 ring-slate-500/25',
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
  // Confetti — trigger ponctuel quand on bascule en "converted" (affaire conclue).
  const [confettiTrigger, setConfettiTrigger] = useState(false)
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
      // Confetti uniquement quand on entre dans "converted" (et que ce n'était pas le cas avant).
      if (next === 'converted' && previous !== 'converted') {
        setConfettiTrigger(true)
        setTimeout(() => setConfettiTrigger(false), 2500)
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
      {/* Confetti — célèbre une conversion (passage en "converted"). */}
      <Confetti trigger={confettiTrigger} />
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
          className="absolute right-0 z-30 mt-1 w-56 origin-top-right overflow-hidden rounded-xl border border-white/[0.08] bg-[oklch(14%_0.02_240)]/95 py-1 shadow-2xl ring-1 ring-black/30 backdrop-blur-xl"
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
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-white/[0.06] disabled:opacity-50"
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
                    className="text-green-400"
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
          className="absolute right-0 top-full z-30 mt-1 rounded-md bg-red-500/15 px-2.5 py-1 text-xs text-red-300 ring-1 ring-red-500/30 shadow-sm"
        >
          {error}
        </p>
      )}
    </div>
  )
}
