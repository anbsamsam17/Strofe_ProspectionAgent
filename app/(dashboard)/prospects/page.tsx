import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Prospect, ProspectStatus } from '@/lib/types'
import { ProspectsFilters } from '@/components/prospects/prospects-filters'

// Force le rendu dynamique — la table prospects change à chaque run agent
// et après chaque feedback d'appel (statut mis à jour)
export const dynamic = 'force-dynamic'

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20

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

const STATUS_STYLES: Record<ProspectStatus, { badge: string; dot: string }> = {
  sourced: {
    badge: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    dot: 'bg-gray-400',
  },
  qualified: {
    badge: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  contacted: {
    badge: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400',
    dot: 'bg-yellow-500',
  },
  interested: {
    badge: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400',
    dot: 'bg-green-500',
  },
  rdv: {
    badge: 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400',
    dot: 'bg-purple-500',
  },
  converted: {
    badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  rejected: {
    badge: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
    dot: 'bg-red-500',
  },
  on_hold: {
    badge: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-400',
    dot: 'bg-orange-500',
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type SortableColumn = 'raison_sociale' | 'score_priorite' | 'statut' | 'updated_at'

function getSortOrder(
  column: SortableColumn,
  currentSort: string | undefined,
  currentOrder: string | undefined
): { sort: SortableColumn; order: 'asc' | 'desc' } {
  if (currentSort === column) {
    return { sort: column, order: currentOrder === 'asc' ? 'desc' : 'asc' }
  }
  return { sort: column, order: 'desc' }
}

function SortIcon({
  column,
  currentSort,
  currentOrder,
}: {
  column: string
  currentSort: string | undefined
  currentOrder: string | undefined
}) {
  const isActive = currentSort === column
  if (!isActive) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="ml-1 opacity-30 transition-opacity group-hover:opacity-60"
        aria-hidden="true"
      >
        <polyline points="8 15 12 19 16 15" />
        <polyline points="8 9 12 5 16 9" />
      </svg>
    )
  }
  return currentOrder === 'asc' ? (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="ml-1 text-green-600 dark:text-green-400"
      aria-hidden="true"
    >
      <polyline points="18 15 12 9 6 15" />
    </svg>
  ) : (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="ml-1 text-green-600 dark:text-green-400"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface SearchParams {
  page?: string
  sort?: string
  order?: string
  statut?: string
  secteur?: string
  score_min?: string
}

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const params = await searchParams
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const sortCol = (params.sort as SortableColumn) ?? 'score_priorite'
  const sortOrder = params.order === 'asc' ? true : false // ascending = true
  const statutFilter = params.statut ? params.statut.split(',') : []
  const secteurFilter = params.secteur ?? ''
  const scoreMin = params.score_min ? parseInt(params.score_min, 10) : 0

  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  // Construction de la requête avec filtres
  let query = supabase
    .from('prospects')
    .select('*', { count: 'exact' })
    .eq('user_id', user.id)
    .order(sortCol, { ascending: sortOrder })
    .range(from, to)

  if (statutFilter.length > 0) {
    query = query.in('statut', statutFilter)
  }
  if (secteurFilter) {
    query = query.ilike('secteur_libelle', `%${secteurFilter}%`)
  }
  if (scoreMin > 0) {
    query = query.gte('score_priorite', scoreMin)
  }

  const { data: prospects, count } = await query

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)

  function buildHref(newParams: Record<string, string>) {
    const merged: Record<string, string> = {
      page: String(page),
      sort: sortCol,
      order: params.order ?? 'desc',
      ...(params.statut ? { statut: params.statut } : {}),
      ...(secteurFilter ? { secteur: secteurFilter } : {}),
      ...(scoreMin > 0 ? { score_min: String(scoreMin) } : {}),
      ...newParams,
    }
    const qs = new URLSearchParams(merged).toString()
    return `/prospects?${qs}`
  }

  function buildSortHref(column: SortableColumn) {
    const { sort, order } = getSortOrder(column, params.sort, params.order)
    return buildHref({ sort, order, page: '1' })
  }

  const th =
    'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400'

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* En-tête */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            Prospects
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-gray-700 dark:text-gray-300">{count ?? 0}</span>{' '}
            prospect{(count ?? 0) > 1 ? 's' : ''} au total
          </p>
        </div>
      </div>

      {/* Filtres */}
      <ProspectsFilters
        currentStatuts={statutFilter}
        currentSecteur={secteurFilter}
        currentScoreMin={scoreMin}
      />

      {/* Tableau */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Liste des prospects">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-800/40">
                <th scope="col" className={th}>
                  <Link
                    href={buildSortHref('raison_sociale')}
                    className="group inline-flex items-center hover:text-gray-900 dark:hover:text-white"
                  >
                    Entreprise
                    <SortIcon column="raison_sociale" currentSort={params.sort} currentOrder={params.order} />
                  </Link>
                </th>
                <th scope="col" className={`${th} hidden md:table-cell`}>
                  Secteur
                </th>
                <th scope="col" className={`${th} hidden sm:table-cell`}>
                  Ville
                </th>
                <th scope="col" className={`${th} hidden lg:table-cell`}>
                  Effectif
                </th>
                <th scope="col" className={th}>
                  <Link
                    href={buildSortHref('score_priorite')}
                    className="group inline-flex items-center hover:text-gray-900 dark:hover:text-white"
                  >
                    Score
                    <SortIcon column="score_priorite" currentSort={params.sort} currentOrder={params.order} />
                  </Link>
                </th>
                <th scope="col" className={`${th} hidden lg:table-cell`}>
                  BEGES
                </th>
                <th scope="col" className={th}>
                  <Link
                    href={buildSortHref('statut')}
                    className="group inline-flex items-center hover:text-gray-900 dark:hover:text-white"
                  >
                    Statut
                    <SortIcon column="statut" currentSort={params.sort} currentOrder={params.order} />
                  </Link>
                </th>
                <th scope="col" className={`${th} hidden xl:table-cell`}>
                  <Link
                    href={buildSortHref('updated_at')}
                    className="group inline-flex items-center hover:text-gray-900 dark:hover:text-white"
                  >
                    Dernière action
                    <SortIcon column="updated_at" currentSort={params.sort} currentOrder={params.order} />
                  </Link>
                </th>
              </tr>
            </thead>
            <tbody>
              {prospects && prospects.length > 0 ? (
                (prospects as unknown as Prospect[]).map((prospect, idx) => {
                  const statusStyle =
                    STATUS_STYLES[prospect.statut as ProspectStatus] ?? STATUS_STYLES.sourced
                  const isEven = idx % 2 === 0
                  return (
                    <tr
                      key={prospect.id}
                      className={`group border-b border-gray-100 transition-colors last:border-0 hover:bg-green-50/40 dark:border-gray-800/60 dark:hover:bg-green-950/10 ${
                        isEven ? '' : 'bg-gray-50/40 dark:bg-gray-800/10'
                      }`}
                    >
                      {/* Entreprise */}
                      <td className="px-4 py-3.5">
                        <Link href={`/prospects/${prospect.id}`} className="block">
                          <p className="font-semibold text-gray-900 transition-colors group-hover:text-green-700 dark:text-white dark:group-hover:text-green-400">
                            {prospect.raison_sociale}
                          </p>
                          {prospect.siren && (
                            <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-600">
                              SIREN {prospect.siren}
                            </p>
                          )}
                        </Link>
                      </td>

                      {/* Secteur */}
                      <td className="hidden px-4 py-3.5 md:table-cell">
                        {prospect.secteur_libelle ? (
                          <span className="inline-block max-w-[180px] truncate rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                            {prospect.secteur_libelle}
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-600">—</span>
                        )}
                      </td>

                      {/* Ville */}
                      <td className="hidden px-4 py-3.5 text-sm text-gray-600 dark:text-gray-400 sm:table-cell">
                        {prospect.ville ?? (
                          <span className="text-gray-400 dark:text-gray-600">—</span>
                        )}
                      </td>

                      {/* Effectif */}
                      <td className="hidden px-4 py-3.5 text-sm text-gray-600 dark:text-gray-400 lg:table-cell">
                        {prospect.effectif_min && prospect.effectif_max
                          ? `${prospect.effectif_min}–${prospect.effectif_max}`
                          : prospect.effectif_min
                            ? `+${prospect.effectif_min}`
                            : <span className="text-gray-400 dark:text-gray-600">—</span>}
                      </td>

                      {/* Score */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="w-6 text-right text-sm font-bold tabular-nums text-gray-900 dark:text-white">
                            {prospect.score_priorite}
                          </span>
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                            <div
                              className={`h-1.5 rounded-full transition-all ${
                                prospect.score_priorite >= 75
                                  ? 'bg-green-500'
                                  : prospect.score_priorite >= 50
                                    ? 'bg-yellow-500'
                                    : 'bg-gray-400'
                              }`}
                              style={{ width: `${Math.min(100, prospect.score_priorite)}%` }}
                              aria-hidden="true"
                            />
                          </div>
                        </div>
                      </td>

                      {/* BEGES */}
                      <td className="hidden px-4 py-3.5 lg:table-cell">
                        {(() => {
                          const begesPublie = prospect.beges_publie
                          const begesValide = prospect.beges_valide
                          const begesUrl = prospect.beges_url
                          const begesDate = prospect.beges_derniere_publication

                          let badgeClass: string
                          let badgeLabel: string

                          if (begesPublie && begesValide) {
                            badgeClass = 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-400 dark:border-green-800'
                            badgeLabel = 'Publié'
                          } else if (begesPublie && !begesValide) {
                            badgeClass = 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-400 dark:border-orange-800'
                            badgeLabel = 'Expiré'
                          } else {
                            badgeClass = 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800'
                            badgeLabel = 'Absent'
                          }

                          const badge = (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${badgeClass}`}
                              title={begesDate ? `Dernière publication : ${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' }).format(new Date(begesDate))}` : undefined}
                            >
                              {badgeLabel}
                              {begesDate && (
                                <span className="opacity-70">
                                  {' '}
                                  {new Intl.DateTimeFormat('fr-FR', { year: 'numeric' }).format(new Date(begesDate))}
                                </span>
                              )}
                            </span>
                          )

                          if (begesUrl) {
                            return (
                              <a
                                href={begesUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Voir le BEGES de ${prospect.raison_sociale} (ouvre dans un nouvel onglet)`}
                                className="inline-flex hover:opacity-80 transition-opacity"
                              >
                                {badge}
                              </a>
                            )
                          }
                          return badge
                        })()}
                      </td>

                      {/* Statut */}
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.badge}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${statusStyle.dot}`}
                            aria-hidden="true"
                          />
                          {STATUS_LABELS[prospect.statut as ProspectStatus] ?? prospect.statut}
                        </span>
                      </td>

                      {/* Dernière action */}
                      <td className="hidden px-4 py-3.5 text-sm text-gray-500 dark:text-gray-500 xl:table-cell">
                        {new Intl.DateTimeFormat('fr-FR', {
                          dateStyle: 'short',
                        }).format(new Date(prospect.updated_at))}
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-gray-400 dark:text-gray-600"
                          aria-hidden="true"
                        >
                          <circle cx="11" cy="11" r="8" />
                          <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                        Aucun prospect trouvé
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-600">
                        Essayez de modifier ou réinitialiser vos filtres.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3.5 dark:border-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Page{' '}
              <span className="font-semibold text-gray-700 dark:text-gray-300">{page}</span>{' '}
              sur{' '}
              <span className="font-semibold text-gray-700 dark:text-gray-300">{totalPages}</span>
              {' '}—{' '}
              <span className="font-semibold text-gray-700 dark:text-gray-300">{count}</span>{' '}
              résultats
            </p>
            <div className="flex items-center gap-1.5">
              {page > 1 ? (
                <Link
                  href={buildHref({ page: String(page - 1) })}
                  aria-label="Page précédente"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  Précédent
                </Link>
              ) : (
                <span className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-gray-100 bg-white px-3 py-1.5 text-xs font-medium text-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-700">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  Précédent
                </span>
              )}

              <span className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white">
                {page}
              </span>

              {page < totalPages ? (
                <Link
                  href={buildHref({ page: String(page + 1) })}
                  aria-label="Page suivante"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Suivant
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Link>
              ) : (
                <span className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-gray-100 bg-white px-3 py-1.5 text-xs font-medium text-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-700">
                  Suivant
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
