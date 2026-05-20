'use client'

// ============================================================
// VerifyEmailButton — déclenche Hunter Email Verifier
// ------------------------------------------------------------
// Ticket : GLN-062 (verification email + score confiance Hunter)
//
// Bouton discret (icône loupe + tooltip) qui POST /api/contacts/[id]/verify.
// Met à jour le badge associé via un état local optimiste : le composant
// rend lui-même le ContactEmailStatusBadge à côté du bouton, après vérif.
//
// État cible :
//   - idle      → loupe + label "Vérifier"
//   - loading   → spinner + "…"
//   - success   → badge mis à jour inline (status + score)
//   - error     → toast inline rouge (5s)
//
// Logique d'affichage du bouton :
//   - Toujours affiché si l'email est défini ; seul le label varie selon
//     `email_verified_at` (jamais vérifié OU > 30 jours = "Vérifier",
//      sinon "Re-vérifier" si l'utilisateur veut forcer).
// ============================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// ------------------------------------------------------------
// TYPES
// ------------------------------------------------------------

interface VerifyEmailButtonProps {
  contactId: string
  /** ISO timestamp de la dernière vérif — null si jamais vérifié. */
  emailVerifiedAt?: string | null
}

interface ToastState {
  message: string
}

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

/** Au-delà de 30 jours, on considère la vérif obsolète et on encourage à re-vérifier. */
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000

const ERROR_TOAST_MS = 5_000

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function isStale(verifiedAt?: string | null): boolean {
  if (!verifiedAt) return true
  const ts = new Date(verifiedAt).getTime()
  if (Number.isNaN(ts)) return true
  return Date.now() - ts > STALE_THRESHOLD_MS
}

// ------------------------------------------------------------
// COMPOSANT
// ------------------------------------------------------------

export function VerifyEmailButton({
  contactId,
  emailVerifiedAt,
}: VerifyEmailButtonProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<ToastState | null>(null)

  const stale = isStale(emailVerifiedAt)
  const idleLabel = emailVerifiedAt ? 'Re-vérifier' : 'Vérifier'
  const tooltip = emailVerifiedAt
    ? stale
      ? `Vérification > 30 jours — re-lancer Hunter Email Verifier`
      : 'Re-lancer Hunter Email Verifier sur cet email'
    : 'Lancer Hunter Email Verifier pour valider cet email'

  async function handleClick(): Promise<void> {
    if (isLoading) return
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/contacts/${contactId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body: unknown = await response.json().catch(() => ({}))

      if (!response.ok) {
        const message =
          typeof body === 'object' &&
          body !== null &&
          'error' in body &&
          typeof (body as { error?: { message?: string } }).error?.message === 'string'
            ? (body as { error: { message: string } }).error.message
            : 'Erreur lors de la vérification'
        setError({ message })
        window.setTimeout(() => setError(null), ERROR_TOAST_MS)
        return
      }

      // Succès : on délègue au refresh Next.js pour re-rendre la page avec
      // les nouvelles données (badge, timestamp). Pas d'état local — la
      // source de vérité reste la DB.
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError({ message: 'Erreur réseau : ' + message })
      window.setTimeout(() => setError(null), ERROR_TOAST_MS)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        aria-label={tooltip}
        aria-busy={isLoading}
        title={tooltip}
        className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isLoading ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="11"
            height="11"
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
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        )}
        <span>{isLoading ? '…' : idleLabel}</span>
      </button>

      {error && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-md bg-red-500/15 px-2 py-0.5 text-[10px] text-red-200 ring-1 ring-red-500/25"
        >
          {error.message}
        </p>
      )}
    </div>
  )
}
