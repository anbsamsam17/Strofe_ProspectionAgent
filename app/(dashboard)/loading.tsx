/**
 * Loading global pour toutes les pages /dashboard, /prospects, /prospects/[id],
 * /pipeline, /settings, /daily-list, /alpha — sauf si un segment fournit son
 * propre loading.tsx (Next.js prend le plus proche).
 *
 * Squelette neutre — l'app étant complète avec sidebar + header gérés au layout,
 * on n'affiche qu'un placeholder de contenu central.
 *
 * Shimmer : utilise `animate-shimmer` (cf. app/globals.css) — gradient
 * translucide qui balaie de gauche à droite, plus tech qu'un `animate-pulse`.
 */
const SHIMMER =
  'animate-shimmer bg-gradient-to-r from-white/[0.04] via-white/[0.10] to-white/[0.04] bg-[length:200%_100%]'

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Titre placeholder */}
      <div className="space-y-2">
        <div
          className={`h-7 w-48 rounded-md ${SHIMMER}`}
          aria-hidden="true"
        />
        <div
          className={`h-4 w-72 rounded-md ${SHIMMER}`}
          aria-hidden="true"
        />
      </div>

      {/* Grille de cartes placeholder */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className={`h-28 rounded-2xl border border-white/[0.08] ${SHIMMER}`}
            aria-hidden="true"
          />
        ))}
      </div>

      {/* Liste placeholder */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md">
        <div className="divide-y divide-white/[0.06]">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <div className={`h-10 w-10 rounded-full ${SHIMMER}`} />
              <div className="flex-1 space-y-2">
                <div className={`h-3 w-3/5 rounded ${SHIMMER}`} />
                <div className={`h-3 w-2/5 rounded ${SHIMMER}`} />
              </div>
              <div className={`h-6 w-20 rounded-full ${SHIMMER}`} />
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
