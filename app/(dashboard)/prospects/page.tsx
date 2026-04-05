import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Prospect, ProspectStatus } from '@/lib/types'
import { ProspectsFilters } from '@/components/prospects/prospects-filters'

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

const STATUS_STYLES: Record<ProspectStatus, string> = {
  sourced: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  qualified: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  contacted: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400',
  interested: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  rdv: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400',
  converted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  on_hold: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400',
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
  if (currentSort !== column) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-1 text-gray-400" aria-hidden="true">
        <polyline points="8 15 12 19 16 15" />
        <polyline points="8 9 12 5 16 9" />
      </svg>
    )
  }
  return currentOrder === 'asc' ? (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-1 text-green-600" aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-1 text-green-600" aria-hidden="true">
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

  function buildSortHref(column: SortableColumn): string {
    const { sort, order } = getSortOrder(column, params.sort, params.order)
    return buildHref({ sort, order, page: '1' })
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Prospects
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {count ?? 0} prospect{(count ?? 0) > 1 ? 's' : ''} au total
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
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Liste des prospects">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-800/50">
                <th scope="col" className="px-4 py-3 text-left">
                  <Link
                    href={buildSortHref('raison_sociale')}
                    className="inline-flex items-center font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                  >
                    Entreprise
                    <SortIcon column="raison_sociale" currentSort={params.sort} currentOrder={params.order} />
                  </Link>
                </th>
                <th scope="col" className="hidden px-4 py-3 text-left md:table-cell">
                  <span className="font-semibold text-gray-600 dark:text-gray-400">Secteur</span>
                </th>
                <th scope="col" className="hidden px-4 py-3 text-left sm:table-cell">
                  <span className="font-semibold text-gray-600 dark:text-gray-400">Ville</span>
                </th>
                <th scope="col" className="hidden px-4 py-3 text-left lg:table-cell">
                  <span className="font-semibold text-gray-600 dark:text-gray-400">Effectif</span>
                </th>
                <th scope="col" className="px-4 py-3 text-left">
                  <Link
                    href={buildSortHref('score_priorite')}
                    className="inline-flex items-center font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                  >
                    Score
                    <SortIcon column="score_priorite" currentSort={params.sort} currentOrder={params.order} />
                  </Link>
                </th>
                <th scope="col" className="px-4 py-3 text-left">
                  <Link
                    href={buildSortHref('statut')}
                    className="inline-flex items-center font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                  >
                    Statut
                    <SortIcon column="statut" currentSort={params.sort} currentOrder={params.order} />
                  </Link>
                </th>
                <th scope="col" className="hidden px-4 py-3 text-left xl:table-cell">
                  <Link
                    href={buildSortHref('updated_at')}
                    className="inline-flex items-center font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                  >
                    Dernière action
                    <SortIcon column="updated_at" currentSort={params.sort} currentOrder={params.order} />
                  </Link>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {prospects && prospects.length > 0 ? (
                (prospects as Prospect[]).map((prospect) => (
                  <tr
                    key={prospect.id}
                    className="group transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/prospects/${prospect.id}`}
                        className="block"
                      >
                        <p className="font-medium text-gray-900 group-hover:text-green-700 dark:text-white dark:group-hover:text-green-400">
                          {prospect.raison_sociale}
                        </p>
                        {prospect.siren && (
                          <p className="text-xs text-gray-400 dark:text-gray-600">
                            SIREN {prospect.siren}
                          </p>
                        )}
                      </Link>
                    </td>
                    <td className="hidden px-4 py-3 text-gray-600 dark:text-gray-400 md:table-cell">
                      {prospect.secteur_libelle ?? '—'}
                    </td>
                    <td className="hidden px-4 py-3 text-gray-600 dark:text-gray-400 sm:table-cell">
                      {prospect.ville ?? '—'}
                    </td>
                    <td className="hidden px-4 py-3 text-gray-600 dark:text-gray-400 lg:table-cell">
                      {prospect.effectif_min && prospect.effectif_max
                        ? `${prospect.effectif_min}–${prospect.effectif_max}`
                        : prospect.effectif_min
                          ? `+${prospect.effectif_min}`
                          : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="font-semibold tabular-nums text-gray-900 dark:text-white">
                          {prospect.score_priorite}
                        </span>
                        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                          <div
                            className="h-1.5 rounded-full bg-green-500"
                            style={{ width: `${Math.min(100, prospect.score_priorite)}%` }}
                            aria-hidden="true"
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[prospect.statut as ProspectStatus] ??
                          STATUS_STYLES.sourced
                        }`}
                      >
                        {STATUS_LABELS[prospect.statut as ProspectStatus] ??
                          prospect.statut}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 text-gray-500 dark:text-gray-500 xl:table-cell">
                      {new Intl.DateTimeFormat('fr-FR', {
                        dateStyle: 'short',
                      }).format(new Date(prospect.updated_at))}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                    Aucun prospect trouvé avec ces filtres.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Page {page} sur {totalPages} — {count} résultats
            </p>
            <div className="flex items-center gap-2">
              {page > 1 && (
                <Link
                  href={buildHref({ page: String(page - 1) })}
                  aria-label="Page précédente"
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  ← Précédent
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={buildHref({ page: String(page + 1) })}
                  aria-label="Page suivante"
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Suivant →
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
