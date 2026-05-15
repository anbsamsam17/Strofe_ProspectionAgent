/**
 * Loading global pour toutes les pages /dashboard, /prospects, /prospects/[id],
 * /pipeline, /settings, /daily-list, /alpha — sauf si un segment fournit son
 * propre loading.tsx (Next.js prend le plus proche).
 *
 * Squelette neutre — l'app étant complète avec sidebar + header gérés au layout,
 * on n'affiche qu'un placeholder de contenu central.
 */
export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Titre placeholder */}
      <div className="space-y-2">
        <div
          className="h-7 w-48 animate-pulse rounded-md bg-gray-200 dark:bg-gray-800"
          aria-hidden="true"
        />
        <div
          className="h-4 w-72 animate-pulse rounded-md bg-gray-200 dark:bg-gray-800"
          aria-hidden="true"
        />
      </div>

      {/* Grille de cartes placeholder */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
            aria-hidden="true"
          />
        ))}
      </div>

      {/* Liste placeholder */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <div className="h-10 w-10 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/5 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                <div className="h-3 w-2/5 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
              </div>
              <div className="h-6 w-20 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" />
            </div>
          ))}
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        Chargement en cours
      </p>
    </div>
  )
}
