import Link from 'next/link'
import type { Prospect, ProspectStatus } from '@/lib/types'

interface TopPrioritiesProps {
  prospects: Prospect[]
  /**
   * Cible du lien "Voir tout le top 50" dans le header.
   * Construit par la page parente pour préserver les filtres courants
   * pertinents (mode archivé exclu côté parent).
   */
  topAllHref: string
}

const TOP_TITLE = 'Top 15 à appeler aujourd’hui'
const TOP_ALL_LABEL = 'Voir tout le top 50'

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

const STATUS_BADGE: Record<ProspectStatus, string> = {
  sourced: 'bg-gray-100 text-gray-700 dark:bg-gray-800/70 dark:text-gray-300',
  qualified: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
  contacted: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-300',
  interested: 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300',
  rdv: 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300',
  converted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300',
  on_hold: 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300',
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
  if (score >= 75) {
    return 'bg-green-600 text-white shadow-sm dark:bg-green-500'
  }
  if (score >= 50) {
    return 'bg-yellow-200 text-yellow-900 dark:bg-yellow-900/60 dark:text-yellow-200'
  }
  return 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
}

/** Icônes inline — pas de dépendance externe sur ce projet (Tailwind v4 brut). */
function PhoneIcon() {
  return (
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
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  )
}

function ArrowRightIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

function StarIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      className="text-amber-500"
      aria-hidden="true"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

export function TopPriorities({ prospects, topAllHref }: TopPrioritiesProps) {
  if (prospects.length === 0) {
    return (
      <section
        aria-label="Top 15 à appeler aujourd’hui"
        className="overflow-hidden rounded-2xl border border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 p-7 dark:border-green-900/60 dark:from-green-950/30 dark:to-emerald-950/30"
      >
        <div className="flex items-center gap-2">
          <StarIcon />
          <h2 className="text-lg font-bold tracking-tight text-green-900 dark:text-green-200">
            {TOP_TITLE}
          </h2>
        </div>
        <p className="mt-2 text-sm text-green-800/80 dark:text-green-300/80">
          Aucun prospect actif à prioriser pour l’instant. Lancez le sourcing
          nocturne ou réinitialisez vos filtres.
        </p>
      </section>
    )
  }

  return (
    <section
      aria-label="Top 15 prospects à appeler aujourd’hui"
      className="overflow-hidden rounded-2xl border border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 shadow-sm dark:border-green-900/60 dark:from-green-950/30 dark:to-emerald-950/30"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-5">
        <div className="flex items-center gap-2.5">
          <StarIcon />
          <div>
            <h2 className="text-lg font-bold tracking-tight text-green-900 dark:text-green-100">
              {TOP_TITLE}
            </h2>
            <p className="mt-0.5 text-xs text-green-800/70 dark:text-green-300/70">
              Trié par score décroissant — clique « Appeler » pour démarrer.
            </p>
          </div>
        </div>
        <Link
          href={topAllHref}
          className="inline-flex items-center gap-1.5 rounded-lg border border-green-300/60 bg-white/60 px-3 py-1.5 text-xs font-semibold text-green-800 backdrop-blur-sm transition-colors hover:bg-white hover:text-green-900 dark:border-green-800/60 dark:bg-green-950/40 dark:text-green-200 dark:hover:bg-green-950/70"
        >
          {TOP_ALL_LABEL}
          <ArrowRightIcon />
        </Link>
      </header>

      <ol className="divide-y divide-green-200/60 border-t border-green-200/60 bg-white/60 backdrop-blur-sm dark:divide-green-900/40 dark:border-green-900/40 dark:bg-green-950/20">
        {prospects.map((prospect, idx) => {
          const statut = prospect.statut as ProspectStatus
          const phone = prospect.contact_telephone?.trim()
          const hasPhone = Boolean(phone)
          const detailHref = `/prospects/${prospect.id}`

          return (
            <li
              key={prospect.id}
              className="group flex items-center gap-3 px-6 py-2.5 transition-colors hover:bg-green-100/40 dark:hover:bg-green-950/40"
            >
              {/* Rang */}
              <span
                className="w-7 flex-shrink-0 text-right text-xs font-bold tabular-nums text-green-700/70 dark:text-green-400/70"
                aria-hidden="true"
              >
                #{idx + 1}
              </span>

              {/* Score */}
              <span
                className={`inline-flex h-7 w-9 flex-shrink-0 items-center justify-center rounded-md text-xs font-bold tabular-nums ${scoreBadgeClass(
                  prospect.score_priorite,
                )}`}
                aria-label={`Score ${prospect.score_priorite}`}
              >
                {prospect.score_priorite}
              </span>

              {/* Raison sociale → vers la fiche */}
              <Link
                href={detailHref}
                className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 transition-colors hover:text-green-700 dark:text-white dark:hover:text-green-300"
              >
                {prospect.raison_sociale}
              </Link>

              {/* Secteur */}
              <span className="hidden flex-shrink-0 truncate text-xs text-gray-600 dark:text-gray-400 sm:inline-block sm:max-w-[180px]">
                {prospect.secteur_libelle ?? '—'}
              </span>

              {/* Ville */}
              <span className="hidden flex-shrink-0 truncate text-xs text-gray-500 dark:text-gray-500 md:inline-block md:max-w-[120px]">
                {prospect.ville ?? '—'}
              </span>

              {/* Statut */}
              <span
                className={`hidden flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium lg:inline-flex ${STATUS_BADGE[statut] ?? STATUS_BADGE.sourced}`}
              >
                <span
                  className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${STATUS_DOT[statut] ?? STATUS_DOT.sourced}`}
                  aria-hidden="true"
                />
                {STATUS_LABELS[statut] ?? statut}
              </span>

              {/* CTA : Appeler (si tel disponible) sinon flèche vers fiche */}
              {hasPhone && phone ? (
                <a
                  href={`tel:${phone}`}
                  aria-label={`Appeler ${prospect.raison_sociale} au ${phone}`}
                  className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded-md bg-green-600 px-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-1 dark:bg-green-500 dark:hover:bg-green-400"
                >
                  <PhoneIcon />
                  <span>Appeler</span>
                </a>
              ) : (
                <Link
                  href={detailHref}
                  aria-label={`Ouvrir la fiche de ${prospect.raison_sociale}`}
                  className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-white/80 text-gray-600 transition-colors hover:bg-white hover:text-gray-900 dark:bg-gray-800/80 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                >
                  <ArrowRightIcon />
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
