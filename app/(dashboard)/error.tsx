'use client'

import { useEffect } from 'react'

interface DashboardErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * Error boundary global pour le groupe (dashboard) — couvre toutes les pages
 * qui n'ont pas leur propre error.tsx (pipeline en a un dédié plus détaillé).
 *
 * En prod, Next.js masque error.message pour éviter fuites de secrets ;
 * error.digest reste consultable dans Vercel Runtime Logs.
 */
export default function DashboardError({ error, reset }: DashboardErrorProps) {
  useEffect(() => {
    console.error('[(dashboard)] Server Components render error', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    })
  }, [error])

  return (
    <div className="mx-auto max-w-2xl space-y-4 py-12">
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 dark:border-red-900/40 dark:bg-red-950/30">
        <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">
          Une erreur est survenue
        </h2>
        <p className="mt-2 text-sm text-red-600 dark:text-red-300">
          Le chargement de la page a échoué côté serveur. Si l&apos;erreur
          persiste, réessayez dans quelques instants ou contactez le support.
        </p>

        {error.digest && (
          <dl className="mt-4 space-y-1 text-xs">
            <dt className="font-semibold text-red-700 dark:text-red-400">
              Identifiant d&apos;erreur
            </dt>
            <dd className="font-mono text-red-600 dark:text-red-300">
              {error.digest}
            </dd>
          </dl>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-700"
          >
            Réessayer
          </button>
          <a
            href="/prospects"
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950/30"
          >
            Retour aux prospects
          </a>
        </div>
      </div>
    </div>
  )
}
