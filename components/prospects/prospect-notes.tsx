'use client'

import { useEffect, useRef, useState } from 'react'

interface ProspectNotesProps {
  prospectId: string
  initialNotes: string | null
}

// Debounce de 800 ms : pause de frappe normale d'un utilisateur, évite de
// spammer l'API à chaque touche tout en gardant la sensation "auto-save".
const DEBOUNCE_MS = 800
const NOTES_MAX_LENGTH = 4000

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function ProspectNotes({ prospectId, initialNotes }: ProspectNotesProps) {
  const [value, setValue] = useState<string>(initialNotes ?? '')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef<string>(initialNotes ?? '')

  // Cleanup du timer si le composant est démonté pendant un debounce en cours.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  async function save(next: string) {
    setStatus('saving')
    setErrorMsg(null)
    try {
      const response = await fetch(`/api/prospects/${prospectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: next === '' ? null : next }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? 'Erreur lors de la sauvegarde')
      }
      lastSavedRef.current = next
      setStatus('saved')
      // Retour à idle après 1.5 s pour libérer l'indicateur visuel.
      setTimeout(() => setStatus('idle'), 1500)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur inconnue')
      setStatus('error')
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value
    setValue(next)

    if (timerRef.current) clearTimeout(timerRef.current)
    // Ne déclencher la sauvegarde que si la valeur diffère de la dernière sauvée.
    if (next === lastSavedRef.current) {
      setStatus('idle')
      return
    }
    timerRef.current = setTimeout(() => {
      void save(next)
    }, DEBOUNCE_MS)
  }

  const charCount = value.length
  const isNearLimit = charCount > NOTES_MAX_LENGTH * 0.9

  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={handleChange}
        maxLength={NOTES_MAX_LENGTH}
        rows={5}
        placeholder="Notes libres sur ce prospect (contexte, historique, prochaines actions...)"
        aria-label="Notes sur le prospect"
        className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2 text-sm text-white placeholder:text-gray-500 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
      />
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-2 text-gray-400">
          {status === 'saving' && (
            <>
              <svg
                className="animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Enregistrement…
            </>
          )}
          {status === 'saved' && (
            <span className="text-green-400">Enregistré</span>
          )}
          {status === 'error' && (
            <span className="text-red-300" role="alert">
              {errorMsg ?? 'Erreur de sauvegarde'}
            </span>
          )}
          {status === 'idle' && (
            <span className="text-gray-500">
              Sauvegarde automatique
            </span>
          )}
        </span>
        <span
          className={`tabular-nums ${
            isNearLimit
              ? 'font-semibold text-orange-300'
              : 'text-gray-500'
          }`}
        >
          {charCount}/{NOTES_MAX_LENGTH}
        </span>
      </div>
    </div>
  )
}
