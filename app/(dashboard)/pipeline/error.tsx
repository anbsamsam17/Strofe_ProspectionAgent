'use client'

import { useEffect } from 'react'

interface PipelineErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * Error boundary spécifique à /pipeline. Évite que toute la page crashe sur
 * une erreur SSR d'un sous-composant (KpiCards, ConversionFunnel, AgentStats).
 *
 * En prod, Next.js masque `error.message` pour éviter les fuites de secrets,
 * mais expose `error.digest` (un hash de l'erreur côté serveur). Le digest se
 * retrouve dans les Vercel Runtime Logs avec le message original.
 */
export default function PipelineError({ error, reset }: PipelineErrorProps) {
  useEffect(() => {
    // Sentry + Vercel logs capturent automatiquement ce console.error
    console.error('[/pipeline] Server Components render error', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    })
  }, [error])

  return (
    <div className="mx-auto max-w-2xl space-y-4 py-12">
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 dark:border-red-900/40 dark:bg-red-950/30">
        <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">
          Erreur lors du chargement du Pipeline
        </h2>
        <p className="mt-2 text-sm text-red-600 dark:text-red-300">
          Une erreur s&apos;est produite côté serveur. Le diagnostic ci-dessous
          permet de retrouver le message complet dans les Vercel Runtime Logs.
        </p>
        <dl className="mt-4 space-y-2 text-xs">
          {error.digest && (
            <div>
              <dt className="font-semibold text-red-700 dark:text-red-400">
                Digest
              </dt>
              <dd className="mt-0.5 font-mono text-red-600 dark:text-red-300">
                {error.digest}
              </dd>
            </div>
          )}
          {/* En prod, error.message est souvent "An error occurred..." mais
              parfois le message complet est exposé selon la nature de l'erreur. */}
          <div>
            <dt className="font-semibold text-red-700 dark:text-red-400">
              Message
            </dt>
            <dd className="mt-0.5 font-mono text-red-600 dark:text-red-300">
              {error.message || '(masqué en prod)'}
            </dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={reset}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-700"
        >
          Réessayer
        </button>
      </div>
    </div>
  )
}
