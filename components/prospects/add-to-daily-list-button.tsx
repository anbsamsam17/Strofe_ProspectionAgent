'use client'

import { useState } from 'react'

interface AddToDailyListButtonProps {
  prospectId: string
  prospectName: string
}

export function AddToDailyListButton({ prospectId, prospectName }: AddToDailyListButtonProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleAdd() {
    if (status !== 'idle') return
    setStatus('loading')
    setErrorMsg(null)

    try {
      const response = await fetch('/api/daily-list/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospectId }),
      })

      if (!response.ok) {
        const data = await response.json() as { error?: string }
        throw new Error(data.error ?? "Erreur lors de l'ajout à la liste")
      }

      setStatus('success')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur inconnue')
      setStatus('error')
      // Reset vers idle après 3 s pour permettre une nouvelle tentative
      setTimeout(() => {
        setStatus('idle')
        setErrorMsg(null)
      }, 3000)
    }
  }

  // Succès : icône check permanente
  if (status === 'success') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 dark:bg-green-950/40 dark:text-green-400"
        role="status"
        aria-label={`${prospectName} ajouté à la liste du jour`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Ajouté
      </span>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleAdd}
        disabled={status === 'loading'}
        aria-label={`Ajouter ${prospectName} à la liste du jour`}
        title={errorMsg ?? `Ajouter ${prospectName} à la liste du jour`}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-gray-900 ${
          status === 'error'
            ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-400'
            : 'border-green-200 bg-white text-green-700 hover:border-green-400 hover:bg-green-50 dark:border-green-800 dark:bg-gray-900 dark:text-green-400 dark:hover:border-green-600 dark:hover:bg-green-950/20'
        }`}
      >
        {status === 'loading' ? (
          <>
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
            <span>Ajout...</span>
          </>
        ) : status === 'error' ? (
          <>
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
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>Erreur</span>
          </>
        ) : (
          <>
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
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Ajouter</span>
          </>
        )}
      </button>
    </div>
  )
}
