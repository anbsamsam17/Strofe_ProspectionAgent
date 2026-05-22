'use client'

// ============================================================
// EditExchangeDialog — modale d'édition d'un échange existant
//
// Sprint 3 retour client #11. Calqué sur `new-exchange-dialog.tsx` mais :
//   - Pré-rempli avec les valeurs de l'échange reçu en props.
//   - PATCH /api/prospects/[id]/exchanges/[exchangeId] au submit.
//   - Trigger : bouton "Éditer" (icône crayon) inline dans la timeline.
//
// RGPD : la table `prospect_exchanges` sert de trace `first_contact_at`
// (Art. 14 RGPD — démonstration de la base légale d'intérêt légitime). La
// modification rétroactive de la date `occurred_at` ou des notes impacte
// cette preuve. TODO(GLN-rgpd) — voir route PATCH côté API : audit log
// append-only à mettre en place en post-Sprint 4 avant audit de conformité.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'

// ── Types locaux ──────────────────────────────────────────────────────────────

type ExchangeType = 'appel' | 'email' | 'linkedin' | 'rdv' | 'autre'

interface EditableExchange {
  id: string
  occurred_at: string
  type: ExchangeType
  result: string | null
  notes: string | null
  callback_date: string | null
}

interface ExchangeFormState {
  occurred_at: string // datetime-local
  type: ExchangeType
  result: string
  notes: string
  callback_date: string // date (YYYY-MM-DD)
}

// ── Constantes (alignées sur new-exchange-dialog.tsx) ─────────────────────────

const TYPE_OPTIONS: { value: ExchangeType; label: string }[] = [
  { value: 'appel', label: 'Appel' },
  { value: 'email', label: 'Email' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'rdv', label: 'Rendez-vous' },
  { value: 'autre', label: 'Autre' },
]

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoToDatetimeLocal(iso: string): string {
  // datetime-local attend YYYY-MM-DDTHH:mm en LOCAL (pas UTC).
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return ''
  }
}

function isoToDateInput(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  } catch {
    return ''
  }
}

function toForm(exchange: EditableExchange): ExchangeFormState {
  return {
    occurred_at: isoToDatetimeLocal(exchange.occurred_at),
    type: exchange.type,
    result: exchange.result ?? '',
    notes: exchange.notes ?? '',
    callback_date: isoToDateInput(exchange.callback_date),
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface EditExchangeDialogProps {
  prospectId: string
  exchange: EditableExchange
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function EditExchangeDialog({ prospectId, exchange }: EditExchangeDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<ExchangeFormState>(() => toForm(exchange))
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const firstFieldRef = useRef<HTMLInputElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const closeDialog = useCallback(() => {
    setOpen(false)
    setError(null)
    setForm(toForm(exchange))
    triggerRef.current?.focus()
  }, [exchange])

  // Re-sync au cas où le parent refresh.
  useEffect(() => {
    if (!open) setForm(toForm(exchange))
  }, [exchange, open])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => firstFieldRef.current?.focus(), 30)
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeDialog()
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, closeDialog])

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
      const occurredIso = new Date(form.occurred_at).toISOString()
      const callbackIso = form.callback_date
        ? new Date(form.callback_date).toISOString()
        : null

      const res = await fetch(
        `/api/prospects/${prospectId}/exchanges/${exchange.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            occurred_at: occurredIso,
            type: form.type,
            // result vide → null (suppression du résultat).
            result: form.result || '',
            notes: form.notes,
            callback_date: callbackIso,
          }),
        },
      )
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string | { message?: string }
        }
        const msg =
          typeof data.error === 'string'
            ? data.error
            : data.error?.message ?? 'Erreur lors de la mise à jour de l’échange'
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
        aria-label="Éditer cet échange"
        title="Éditer cet échange"
        className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-1.5 py-0.5 text-xs font-medium text-gray-300 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.08] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
      >
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
          aria-hidden="true"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
        <span className="sr-only">Éditer</span>
      </button>

      {open && mounted && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-exchange-title"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDialog()
          }}
        >
          <div className="w-[calc(100vw-2rem)] max-w-lg rounded-2xl border border-white/[0.08] bg-[oklch(14%_0.02_240)]/95 backdrop-blur-md p-6 shadow-2xl ring-1 ring-black/30">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h3 id="edit-exchange-title" className="text-lg font-semibold text-white">
                  Éditer l’échange
                </h3>
                <p className="mt-0.5 text-sm text-gray-400">
                  Corriger un appel, email, message LinkedIn ou RDV passé.
                </p>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                aria-label="Fermer la fenêtre"
                className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-gray-200"
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

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-exchange-occurred"
                  className="block font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80"
                >
                  Date et heure
                </label>
                <input
                  id="edit-exchange-occurred"
                  ref={firstFieldRef}
                  type="datetime-local"
                  required
                  value={form.occurred_at}
                  onChange={(e) => update('occurred_at', e.target.value)}
                  className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2.5 text-sm text-white placeholder:text-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 [color-scheme:dark]"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label
                    htmlFor="edit-exchange-type"
                    className="block font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80"
                  >
                    Type
                  </label>
                  <select
                    id="edit-exchange-type"
                    value={form.type}
                    onChange={(e) => update('type', e.target.value as ExchangeType)}
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2.5 text-sm text-white placeholder:text-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 [color-scheme:dark]"
                  >
                    {TYPE_OPTIONS.map((opt) => (
                      <option
                        key={opt.value}
                        value={opt.value}
                        className="bg-[oklch(14%_0.02_240)] text-white"
                      >
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="edit-exchange-result"
                    className="block font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80"
                  >
                    Résultat
                  </label>
                  <select
                    id="edit-exchange-result"
                    value={form.result}
                    onChange={(e) => update('result', e.target.value)}
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2.5 text-sm text-white placeholder:text-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 [color-scheme:dark]"
                  >
                    {RESULT_OPTIONS.map((opt) => (
                      <option
                        key={opt.value}
                        value={opt.value}
                        className="bg-[oklch(14%_0.02_240)] text-white"
                      >
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="edit-exchange-notes"
                  className="block font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80"
                >
                  Notes
                </label>
                <textarea
                  id="edit-exchange-notes"
                  rows={4}
                  value={form.notes}
                  onChange={(e) => update('notes', e.target.value)}
                  placeholder="Contenu de l'échange, points abordés, prochaines étapes..."
                  className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2.5 text-sm leading-relaxed text-white placeholder:text-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="edit-exchange-callback"
                  className="block font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80"
                >
                  Date de rappel (optionnel)
                </label>
                <input
                  id="edit-exchange-callback"
                  type="date"
                  value={form.callback_date}
                  onChange={(e) => update('callback_date', e.target.value)}
                  className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2.5 text-sm text-white placeholder:text-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 [color-scheme:dark]"
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="mt-1.5 rounded-lg bg-red-500/15 px-3 py-2.5 text-sm text-red-200 ring-1 ring-red-500/25"
                >
                  {error}
                </p>
              )}

              <div className="flex items-center justify-end gap-3 border-t border-white/[0.06] pt-5">
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={pending}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-4 py-2.5 text-sm font-medium text-gray-200 transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pending ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
