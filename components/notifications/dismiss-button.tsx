'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface DismissButtonProps {
  exchangeId: string
}

// Client Component minimal — un seul état (pending) + un fetch PATCH.
export function DismissButton({ exchangeId }: DismissButtonProps) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)

  async function handleDismiss() {
    setPending(true)
    try {
      const res = await fetch('/api/notifications/dismiss', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchange_id: exchangeId }),
      })
      if (res.ok) {
        setDone(true)
        // Refresh pour que la page Server Component recalcule les données
        // et retire la relance de la liste.
        router.refresh()
      }
    } finally {
      setPending(false)
    }
  }

  if (done) return null

  return (
    <button
      type="button"
      onClick={handleDismiss}
      disabled={pending}
      aria-label="Marquer cette relance comme traitée"
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-green-500/30 hover:bg-green-500/10 hover:text-green-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400/60 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? (
        <svg
          className="animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      ) : (
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
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {pending ? 'Traitement…' : 'Traité'}
    </button>
  )
}
