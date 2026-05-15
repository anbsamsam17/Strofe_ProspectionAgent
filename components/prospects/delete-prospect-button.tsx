'use client'

// ============================================================
// DeleteProspectButton
//
// Bouton icône poubelle + dialog modal de confirmation pour
// supprimer définitivement un prospect.
//
// Comportement :
//   - Click sur le trigger → ouvre le dialog.
//   - Confirmation → DELETE /api/prospects/[id], puis router.refresh().
//   - ESC + clic backdrop + bouton "Annuler" → ferment.
//   - Erreur API → message inline rouge dans le dialog.
//   - CASCADE supprime aussi prospect_contacts + prospect_exchanges (FK ON DELETE CASCADE).
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface DeleteProspectButtonProps {
  prospectId: string
  prospectName: string
  prospectSiren: string | null
  /** Callback optionnel après suppression (toast parent, etc.). */
  onDeleted?: () => void
}

export function DeleteProspectButton({
  prospectId,
  prospectName,
  prospectSiren,
  onDeleted,
}: DeleteProspectButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  // Focus "Annuler" à l'ouverture (action moins destructive par défaut) + ESC.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => cancelRef.current?.focus(), 30)
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
    setError(null)
    triggerRef.current?.focus()
  }

  async function handleConfirm() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/prospects/${prospectId}`, { method: 'DELETE' })
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
      onDeleted?.()
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
        aria-label={`Supprimer ${prospectName}`}
        title={`Supprimer ${prospectName}`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md text-red-300/80 transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:opacity-50"
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
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`delete-prospect-title-${prospectId}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDialog()
          }}
        >
          <div className="w-[calc(100vw-2rem)] max-w-md rounded-2xl border border-white/[0.08] bg-[oklch(14%_0.02_240)]/95 backdrop-blur-md p-6 shadow-2xl ring-1 ring-black/30">
            <div className="mb-5 flex items-start gap-3">
              {/* Icône warning rouge */}
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
                  id={`delete-prospect-title-${prospectId}`}
                  className="text-lg font-semibold text-white"
                >
                  Supprimer DÉFINITIVEMENT ce prospect ?
                </h3>
                <p className="mt-1.5 text-sm text-gray-300">
                  <span className="font-semibold text-white">{prospectName}</span>
                  {prospectSiren && (
                    <>
                      {' '}
                      <span className="font-mono text-xs text-gray-400">
                        (SIREN {prospectSiren})
                      </span>
                    </>
                  )}
                </p>
                <p className="mt-2 text-xs text-gray-400">
                  Cette action supprimera également les contacts et les échanges
                  associés. Elle est <span className="font-semibold text-red-300">irréversible</span>.
                </p>
              </div>
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
                ref={cancelRef}
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
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? 'Suppression…' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
