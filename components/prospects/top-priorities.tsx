import Link from 'next/link'
import type { Prospect, ProspectStatus } from '@/lib/types'

interface TopPrioritiesProps {
  prospects: Prospect[]
}

const STATUS_LABELS: Record<ProspectStatus, string> = {
  sourced: 'Sourcé',
  qualified: 'Qualifié',
  contacted: 'Contacté',
  interested: 'Intéressé',
  rdv: 'RDV',
  converted: 'Converti',
  rejected: 'Rejeté',
  on_hold: 'En pause',
}

const STATUS_DOT: Record<ProspectStatus, string> = {
  sourced: 'bg-gray-400',
  qualified: 'bg-blue-500',
  contacted: 'bg-yellow-500',
  interested: 'bg-green-500',
  rdv: 'bg-purple-500',
  converted: 'bg-emerald-500',
  rejected: 'bg-red-500',
  on_hold: 'bg-orange-500',
}

function scoreBadgeClass(score: number): string {
  if (score >= 75) return 'bg-white text-green-700 ring-2 ring-white/60'
  if (score >= 50) return 'bg-yellow-100 text-yellow-800'
  return 'bg-white/80 text-gray-700'
}

export function TopPriorities({ prospects }: TopPrioritiesProps) {
  if (prospects.length === 0) {
    return (
      <div className="overflow-hidden rounded-2xl border border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 p-6 dark:border-green-900 dark:from-green-950/40 dark:to-emerald-950/30">
        <h2 className="text-lg font-bold text-green-900 dark:text-green-200">
          Top 20 priorités
        </h2>
        <p className="mt-2 text-sm text-green-800/80 dark:text-green-300/80">
          Aucun prospect actif à prioriser pour l’instant. Lancez le sourcing
          nocturne ou réinitialisez vos filtres.
        </p>
      </div>
    )
  }

  return (
    <section
      aria-label="Top 20 prospects à contacter en priorité"
      className="overflow-hidden rounded-2xl border border-green-300/60 bg-gradient-to-br from-green-600 via-emerald-600 to-teal-700 text-white shadow-sm dark:border-green-800/60"
    >
      <header className="flex flex-wrap items-end justify-between gap-3 px-6 py-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Top 20 priorités</h2>
          <p className="mt-0.5 text-xs text-white/80">
            Trié par score décroissant — vue axe principal de l’app
          </p>
        </div>
        <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur-sm">
          {prospects.length} prospect{prospects.length > 1 ? 's' : ''}
        </span>
      </header>

      <ol className="divide-y divide-white/10 bg-white/5 backdrop-blur-sm">
        {prospects.map((prospect, idx) => (
          <li
            key={prospect.id}
            className="group flex items-center gap-3 px-6 py-2.5 transition-colors hover:bg-white/10"
          >
            <span
              className="w-6 flex-shrink-0 text-right text-xs font-bold tabular-nums text-white/70"
              aria-hidden="true"
            >
              #{idx + 1}
            </span>

            <span
              className={`inline-flex h-7 w-9 flex-shrink-0 items-center justify-center rounded-md text-xs font-bold tabular-nums ${scoreBadgeClass(
                prospect.score_priorite,
              )}`}
              aria-label={`Score ${prospect.score_priorite}`}
            >
              {prospect.score_priorite}
            </span>

            <Link
              href={`/prospects/${prospect.id}`}
              className="min-w-0 flex-1 truncate text-sm font-semibold text-white transition-colors hover:text-white/90"
            >
              {prospect.raison_sociale}
            </Link>

            <span className="hidden flex-shrink-0 truncate text-xs text-white/70 sm:inline-block sm:max-w-[160px]">
              {prospect.secteur_libelle ?? '—'}
            </span>

            <span className="hidden flex-shrink-0 text-xs text-white/70 md:inline-block">
              {prospect.ville ?? '—'}
            </span>

            <span className="hidden flex-shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm lg:inline-flex">
              <span
                className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${STATUS_DOT[prospect.statut]}`}
                aria-hidden="true"
              />
              {STATUS_LABELS[prospect.statut] ?? prospect.statut}
            </span>

            <Link
              href={`/prospects/${prospect.id}`}
              aria-label={`Ouvrir la fiche de ${prospect.raison_sociale}`}
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-white/10 text-white transition-colors hover:bg-white/20"
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
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
