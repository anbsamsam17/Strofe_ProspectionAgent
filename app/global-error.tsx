'use client'

// app/global-error.tsx — Error boundary global Next.js 15 avec reporting Sentry
//
// Ce composant capture les erreurs non gérées qui surviennent dans le layout racine
// (app/layout.tsx), là où un error.tsx ordinaire ne peut pas intervenir.
// C'est le dernier filet de sécurité de l'application.
//
// Contrainte Next.js : global-error.tsx DOIT inclure <html> et <body> car il remplace
// entièrement le layout racine lors d'une erreur critique.
//
// Ref: https://nextjs.org/docs/app/api-reference/file-conventions/error#global-errorjs
// Ref: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#react-render-errors

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

interface GlobalErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Envoie l'erreur à Sentry avec le digest Next.js pour corrélation dans les logs serveur
    Sentry.captureException(error, {
      tags: {
        boundary: 'global',
        digest: error.digest ?? 'unknown',
      },
    })
  }, [error])

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          backgroundColor: '#0f172a',
          color: '#e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            maxWidth: '480px',
            padding: '2rem',
          }}
        >
          <p
            style={{
              fontSize: '3rem',
              margin: '0 0 1rem',
              lineHeight: 1,
            }}
            aria-hidden="true"
          >
            500
          </p>

          <h1
            style={{
              fontSize: '1.25rem',
              fontWeight: 600,
              margin: '0 0 0.75rem',
              color: '#f1f5f9',
            }}
          >
            Une erreur critique est survenue
          </h1>

          <p
            style={{
              fontSize: '0.875rem',
              color: '#94a3b8',
              margin: '0 0 2rem',
              lineHeight: 1.6,
            }}
          >
            L&apos;erreur a ete signalée automatiquement. Vous pouvez essayer de
            recharger la page.
          </p>

          {/* Affiche le digest uniquement en développement pour faciliter le debug */}
          {process.env.NODE_ENV === 'development' && error.digest && (
            <p
              style={{
                fontSize: '0.75rem',
                color: '#64748b',
                fontFamily: 'monospace',
                margin: '0 0 1.5rem',
                padding: '0.5rem 0.75rem',
                backgroundColor: '#1e293b',
                borderRadius: '0.375rem',
                wordBreak: 'break-all',
              }}
            >
              digest: {error.digest}
            </p>
          )}

          <button
            onClick={reset}
            style={{
              backgroundColor: '#22c55e',
              color: '#fff',
              border: 'none',
              borderRadius: '0.5rem',
              padding: '0.625rem 1.5rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background-color 0.15s ease',
            }}
            onMouseOver={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.backgroundColor =
                '#16a34a'
            }}
            onMouseOut={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.backgroundColor =
                '#22c55e'
            }}
          >
            Recharger la page
          </button>
        </div>
      </body>
    </html>
  )
}
