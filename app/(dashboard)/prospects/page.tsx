import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Prospect, ProspectStatus } from '@/lib/types'
import { ProspectsFilters } from '@/components/prospects/prospects-filters'
import { ProspectActionsMenu } from '@/components/prospects/prospect-actions-menu'
import { TopPriorities } from '@/components/prospects/top-priorities'
import { buildBegesUrl } from '@/lib/utils/beges-url'
import { RunStatusBanner } from '@/components/dashboard/run-status-banner'

// ── Types contact filter ──────────────────────────────────────────────────────

const CONTACT_TYPES = ['phone', 'email', 'linkedin'] as const
type ContactFilterType = (typeof CONTACT_TYPES)[number]

function parseContactTypes(raw: string | undefined): ContactFilterType[] {
  if (!raw) return []
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return parts.filter((p): p is ContactFilterType =>
    (CONTACT_TYPES as ReadonlyArray<string>).includes(p),
  )
}

const CONTACT_FIELD_BY_TYPE: Record<ContactFilterType, string> = {
  phone: 'contact_telephone',
  email: 'contact_email',
  linkedin: 'contact_linkedin',
}

// Force le rendu dynamique — la table prospects change à chaque run agent
// et après chaque feedback d'appel (statut mis à jour)
export const dynamic = 'force-dynamic'

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20
// Aligné sur `daily_call_target` standard (15 appels/jour) — voir CLAUDE.md.
const TOP_PRIORITIES_LIMIT = 15
// Cible du lien "Voir tout le top 50" depuis le hero Top 15.
const TOP_ALL_LIMIT = 50

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
  /** "1" pour afficher uniquement les prospects archivés. */
  archived?: string
  contact_type?: string
}

// Statuts terminaux exclus du Top 15 par défaut (déjà traités côté commercial).
const TERMINAL_STATUTS_TOP: ProspectStatus[] = ['converted', 'rejected']

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
  const showArchived = params.archived === '1'
  const contactTypes = parseContactTypes(params.contact_type)

  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  // Construction de la requête avec filtres
  let query = supabase
    .from('prospects')
    .select('*', { count: 'exact' })
    .eq('user_id', user.id)
    .order(sortCol, { ascending: sortOrder })
    .range(from, to)

  // Mode "archivés" : on affiche uniquement les prospects archivés.
  // Mode normal (défaut) : on masque les archivés.
  if (showArchived) {
    query = query.not('archived_at', 'is', null)
  } else {
    query = query.is('archived_at', null)
  }

  if (statutFilter.length > 0) {
    query = query.in('statut', statutFilter)
  }
  if (secteurFilter) {
    query = query.ilike('secteur_libelle', `%${secteurFilter}%`)
  }
  if (scoreMin > 0) {
    query = query.gte('score_priorite', scoreMin)
  }
  if (contactTypes.length > 0) {
    // Multi-select = OR : un prospect matche s'il a AU MOINS un des canaux choisis.
    const orClause = contactTypes
      .map((t) => `${CONTACT_FIELD_BY_TYPE[t]}.not.is.null`)
      .join(',')
    query = query.or(orClause)
  }

  // Top 15 priorités — vue défaut, calculée indépendamment des filtres tabulaires
  // pour rester stable même quand l'utilisateur explore. On l'affiche uniquement
  // dans le mode "non archivés" (ça n'aurait pas de sens sur la pile d'archives).
  const topPrioritiesPromise = showArchived
    ? Promise.resolve({ data: [] as Prospect[] })
    : supabase
        .from('prospects')
        .select('*')
        .eq('user_id', user.id)
        .is('archived_at', null)
        .not('statut', 'in', `(${TERMINAL_STATUTS_TOP.join(',')})`)
        .order('score_priorite', { ascending: false })
        .limit(TOP_PRIORITIES_LIMIT)

  // Compteur "nouveaux dernier run" — récupère le started_at du dernier run agent
  // pour le user courant, puis compte les prospects créés depuis. RLS filtre
  // implicitement (session SSR). Si pas de run, on omet le segment côté UI.
  const lastRunPromise = supabase
    .from('agent_runs')
    .select('started_at')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const [{ data: prospects, count }, topRes, lastRunRes] = await Promise.all([
    query,
    topPrioritiesPromise,
    lastRunPromise,
  ])
  const topPriorities = (topRes.data ?? []) as unknown as Prospect[]

  const lastRunStartedAt =
    (lastRunRes.data as { started_at: string } | null)?.started_at ?? null

  // Le compteur ne fait sens que s'il existe un run de référence.
  let newSinceLastRun = 0
  if (lastRunStartedAt) {
    const { count: newCount } = await supabase
      .from('prospects')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', lastRunStartedAt)
    newSinceLastRun = newCount ?? 0
  }

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)

  function buildHref(newParams: Record<string, string>) {
    const merged: Record<string, string> = {
      page: String(page),
      sort: sortCol,
      order: params.order ?? 'desc',
      ...(params.statut ? { statut: params.statut } : {}),
      ...(secteurFilter ? { secteur: secteurFilter } : {}),
      ...(scoreMin > 0 ? { score_min: String(scoreMin) } : {}),
      ...(showArchived ? { archived: '1' } : {}),
      ...(contactTypes.length > 0 ? { contact_type: contactTypes.join(',') } : {}),
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
      {/* Bandeau live run agent — visible quand un sourcing est en cours,
          même si l'utilisateur a navigué hors du dashboard. */}
      <RunStatusBanner />

      {/* En-tête */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            Prospects
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-gray-700 dark:text-gray-300">{count ?? 0}</span>{' '}
            au total
            {newSinceLastRun > 0 && (
              <>
                {' · '}
                <span className="font-semibold text-green-700 dark:text-green-400">
                  {newSinceLastRun} nouveau{newSinceLastRun > 1 ? 'x' : ''}
                </span>{' '}
                dernier run
              </>
            )}
          </p>
        </div>
      </div>

      {/* Top 15 priorités — hero, axe principal de l'app.
          Le lien "Voir tout le top 50" ramène le tableau en haut de page,
          trié par score décroissant — l'utilisateur paginera 20+20+10 pour
          parcourir le top 50 (PAGE_SIZE=20). `TOP_ALL_LIMIT` reste un label
          sémantique côté CTA, pas un paramètre d'URL. */}
      {!showArchived && (
        <TopPriorities
          prospects={topPriorities}
          topAllHref="/prospects?sort=score_priorite&order=desc&page=1"
        />
      )}

      {/* Filtres — sticky en haut du scroll pour rester accessibles en exploration.
          Wrapper -mx-... pour étendre le fond jusqu'aux bords du <main> et masquer
          le contenu qui passe derrière le sticky (sinon halo visuel). */}
      <div className="sticky top-0 z-10 -mx-4 border-b border-gray-200/80 bg-gray-50/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-gray-50/80 dark:border-gray-800/80 dark:bg-gray-950/95 dark:supports-[backdrop-filter]:bg-gray-950/80 sm:-mx-6 sm:px-6">
        <ProspectsFilters
          currentStatuts={statutFilter}
          currentSecteur={secteurFilter}
          currentScoreMin={scoreMin}
          currentArchived={showArchived}
          currentContactTypes={contactTypes}
        />
      </div>

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
                <th scope="col" className={th}>
                  <span className="sr-only">Actions</span>
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
                          const begesUrl = buildBegesUrl(prospect)
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

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <ProspectActionsMenu
                            prospectId={prospect.id}
                            prospectName={prospect.raison_sociale}
                            currentStatut={prospect.statut}
                            archived={Boolean(prospect.archived_at)}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center">
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
