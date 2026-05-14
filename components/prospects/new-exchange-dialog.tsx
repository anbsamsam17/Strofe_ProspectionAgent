'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// ── Types locaux (TODO(coord-A): déplacer dans lib/types.ts) ──────────────────

type ExchangeType = 'appel' | 'email' | 'linkedin' | 'rdv' | 'autre'

interface ExchangeFormState {
  occurred_at: string // datetime-local
  type: ExchangeType
  result: string // libre, peut matcher CallResult
  notes: string
  callback_date: string // date (YYYY-MM-DD)
}

// ── Constantes ────────────────────────────────────────────────────────────────

const TYPE_OPTIONS: { value: ExchangeType; label: string }[] = [
  { value: 'appel', label: 'Appel' },
  { value: 'email', label: 'Email' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'rdv', label: 'Rendez-vous' },
  { value: 'autre', label: 'Autre' },
]

// Résultats préremplis — clés alignées sur CallResult pour réutiliser les
// couleurs dans ExchangesPanel. Mais le champ reste libre (TEXT côté DB).
const RESULT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Aucun résultat spécifique' },
  { value: 'interested', label: 'Intéressé' },
  { value: 'callback', label: 'Rappel demandé' },
  { value: 'not_interested', label: 'Pas intéressé' },
  { value: 'wrong_contact', label: 'Mauvais contact' },
  { value: 'no_answer', label: 'Pas de réponse' },
  { value: 'voicemail', label: 'Répondeur' },
  { value: 'email_sent', label: 'Email envoyé' },
]

// Datetime-local format : YYYY-MM-DDTHH:mm (sans timezone).
function nowDatetimeLocal(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function emptyForm(): ExchangeFormState {
  return {
    occurred_at: nowDatetimeLocal(),
    type: 'appel',
    result: '',
    notes: '',
    callback_date: '',
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface NewExchangeDialogProps {
  prospectId: string
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function NewExchangeDialog({ prospectId }: NewExchangeDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<ExchangeFormState>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const firstFieldRef = useRef<HTMLInputElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    setForm(emptyForm())
    const t = setTimeout(() => firstFieldRef.current?.focus(), 30)
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
    setOpen(false)
    setError(null)
    triggerRef.current?.focus()
  }

  function update<K extends keyof ExchangeFormState>(key: K, value: ExchangeFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!form.occurred_at) {
      setError('La date de l’échange est obligatoire.')
      return
    }

    setPending(true)
    try {
      // Convertir datetime-local (local time naïf) en ISO UTC pour la DB.
      const occurredIso = new Date(form.occurred_at).toISOString()
      const callbackIso = form.callback_date ? new Date(form.callback_date).toISOString() : undefined

      const res = await fetch(`/api/prospects/${prospectId}/exchanges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          occurred_at: occurredIso,
          type: form.type,
          result: form.result || undefined,
          notes: form.notes.trim() || undefined,
          callback_date: callbackIso,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string | { message?: string } }
        const msg =
          typeof data.error === 'string'
            ? data.error
            : data.error?.message ?? "Erreur lors de l'ajout de l'échange"
        throw new Error(msg)
      }
      closeDialog()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-green-700"
      >
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
        Nouvel échange
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-exchange-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDialog()
          }}
        >
          <div className="w-[calc(100vw-2rem)] max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h3 id="new-exchange-title" className="text-lg font-semibold text-gray-900 dark:text-white">
                  Nouvel échange
                </h3>
                <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                  Consigner un appel, un email, un message LinkedIn ou un RDV.
                </p>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                aria-label="Fermer la fenêtre"
                className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
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

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="exchange-occurred"
                  className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
                >
                  Date et heure
                </label>
                <input
                  id="exchange-occurred"
                  ref={firstFieldRef}
                  type="datetime-local"
                  required
                  value={form.occurred_at}
                  onChange={(e) => update('occurred_at', e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="exchange-type"
                    className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    Type
                  </label>
                  <select
                    id="exchange-type"
                    value={form.type}
                    onChange={(e) => update('type', e.target.value as ExchangeType)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  >
                    {TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="exchange-result"
                    className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    Résultat
                  </label>
                  <select
                    id="exchange-result"
                    value={form.result}
                    onChange={(e) => update('result', e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  >
                    {RESULT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="exchange-notes"
                  className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
                >
                  Notes
                </label>
                <textarea
                  id="exchange-notes"
                  rows={4}
                  value={form.notes}
                  onChange={(e) => update('notes', e.target.value)}
                  placeholder="Contenu de l'échange, points abordés, prochaines étapes..."
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-600"
                />
              </div>

              <div>
                <label
                  htmlFor="exchange-callback"
                  className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
                >
                  Date de rappel (optionnel)
                </label>
                <input
                  id="exchange-callback"
                  type="date"
                  value={form.callback_date}
                  onChange={(e) => update('callback_date', e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-400"
                >
                  {error}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={pending}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pending ? 'Enregistrement…' : "Enregistrer l'échange"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
