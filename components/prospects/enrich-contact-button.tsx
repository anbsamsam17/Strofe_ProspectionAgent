'use client'

// ============================================================
// EnrichContactButton — bouton "Vérifier maintenant"
//
// Re-déclenche la cascade d'enrichissement (Pappers → Hunter → INPI → pattern)
// pour le prospect courant, via POST /api/prospects/[id]/enrich.
//
// UX :
//   - État idle  : libellé "Vérifier maintenant" + icône refresh
//   - État loading : spinner + libellé "Vérification en cours…" + disabled
//   - Succès : toast inline en haut, auto-clear après 4s, router.refresh()
//   - Erreur : toast inline en haut, auto-clear après 6s
//
// Style : bouton secondaire glass dark (cf. design system Glan).
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface EnrichContactButtonProps {
  prospectId: string
}

interface SuccessPayload {
  added: string[]
  sources: string[]
  reason?: string
}

type ToastState =
  | { kind: 'idle' }
  | { kind: 'success'; message: string }
  | { kind: 'info'; message: string }
  | { kind: 'error'; message: string }

const SUCCESS_TOAST_MS = 4_000
const ERROR_TOAST_MS = 6_000

/**
 * Mappe les noms de champs techniques en libellés FR pour le toast utilisateur.
 */
const FIELD_LABELS: Record<string, string> = {
  contact_nom: 'nom',
  contact_prenom: 'prénom',
  contact_poste: 'poste',
  contact_telephone: 'téléphone',
  contact_email: 'email',
  contact_linkedin: 'LinkedIn',
  contact_linkedin_entreprise: 'page LinkedIn entreprise',
}

function formatAddedFields(added: string[]): string {
  if (added.length === 0) return 'aucun champ'
  const labels = added.map((k) => FIELD_LABELS[k] ?? k)
  if (labels.length === 1) return labels[0]
  return labels.slice(0, -1).join(', ') + ' et ' + labels[labels.length - 1]
}

export function EnrichContactButton({ prospectId }: EnrichContactButtonProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [, startTransition] = useTransition()
  const [toast, setToast] = useState<ToastState>({ kind: 'idle' })

  function showToast(next: ToastState, ttlMs: number): void {
    setToast(next)
    if (next.kind !== 'idle') {
      window.setTimeout(() => {
        setToast((current) => (current === next ? { kind: 'idle' } : current))
      }, ttlMs)
    }
  }

  async function handleClick(): Promise<void> {
    if (isLoading) return
    setIsLoading(true)
    setToast({ kind: 'idle' })

    try {
      const response = await fetch(`/api/prospects/${prospectId}/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const body: unknown = await response.json().catch(() => ({}))

      if (!response.ok) {
        const msg =
          typeof body === 'object' &&
          body !== null &&
          'error' in body &&
          typeof (body as { error?: { message?: string } }).error?.message === 'string'
            ? (body as { error: { message: string } }).error.message
            : 'Erreur inconnue lors de l\'enrichissement'
        showToast({ kind: 'error', message: msg }, ERROR_TOAST_MS)
        return
      }

      const data =
        typeof body === 'object' && body !== null && 'data' in body
          ? ((body as { data: SuccessPayload }).data)
          : { added: [], sources: [] }

      if (!data.added || data.added.length === 0) {
        showToast(
          {
            kind: 'info',
            message:
              data.reason === 'email_perso_filtered'
                ? 'Aucune donnée nouvelle (un email perso a été ignoré).'
                : 'Aucune nouvelle donnée trouvée.',
          },
          SUCCESS_TOAST_MS,
        )
        return
      }

      const fieldsLabel = formatAddedFields(data.added)
      const sourcesLabel =
        data.sources.length > 0 ? ` (via ${data.sources.join(', ')})` : ''
      showToast(
        {
          kind: 'success',
          message: `Enrichi : ${fieldsLabel}${sourcesLabel}.`,
        },
        SUCCESS_TOAST_MS,
      )

      // Rafraîchir le Server Component parent pour refléter les nouveaux champs.
      startTransition(() => {
        router.refresh()
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast(
        { kind: 'error', message: 'Erreur réseau : ' + message },
        ERROR_TOAST_MS,
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        aria-label="Re-déclencher l'enrichissement contact pour ce prospect"
        aria-busy={isLoading}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-gray-200 backdrop-blur transition-colors hover:bg-white/[0.08] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isLoading ? (
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
            className="animate-spin"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : (
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
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        )}
        <span>{isLoading ? 'Vérification…' : 'Vérifier maintenant'}</span>
      </button>

      {toast.kind !== 'idle' && (
        <p
          role="status"
          aria-live="polite"
          className={
            'max-w-xs rounded-md px-2.5 py-1 text-[11px] ring-1 ' +
            (toast.kind === 'success'
              ? 'bg-green-500/15 text-green-200 ring-green-500/25'
              : toast.kind === 'error'
                ? 'bg-red-500/15 text-red-200 ring-red-500/25'
                : 'bg-cyan-500/15 text-cyan-200 ring-cyan-500/25')
          }
        >
          {toast.message}
        </p>
      )}
    </div>
  )
}
