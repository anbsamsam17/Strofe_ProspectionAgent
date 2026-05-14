import { redirect } from 'next/navigation'
import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'
import type { Prospect, ProspectStatus } from '@/lib/types'
import { ProspectsFilters } from '@/components/prospects/prospects-filters'
import { ProspectActionsMenu } from '@/components/prospects/prospect-actions-menu'
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
// et après chaque feedback d'appel (statut mis à jour).
export const dynamic = 'force-dynamic'

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20

/**
 * Étendu temporairement pour anticiper l'ajout du statut `offer_sent` côté
 * Agent A (migration `ProspectStatus`). Tant que le type partagé ne contient
 * pas la valeur, on l'isole ici pour ne pas casser le typage et garder la
 * page lisible dès que la migration est mergée.
 */
// TODO(Agent A): retirer cette extension dès que `offer_sent` sera ajouté à ProspectStatus.
type ProspectStatusExt = ProspectStatus | 'offer_sent'

const STATUS_LABELS: Record<ProspectStatusExt, string> = {
  sourced: 'Pas de contact identifié',
  qualified: 'Qualifié',
  contacted: 'Contacté',
  interested: 'Intéressé',
  // Legacy : `rdv` mappé visuellement vers Intéressé pour fusionner deux statuts
  // historiquement séparés dans le pipeline commercial.
  rdv: 'Intéressé',
  offer_sent: 'Offre envoyée',
  converted: 'Affaire conclue',
  rejected: 'Sans suite',
  on_hold: 'En stand-by',
}

const STATUS_STYLES: Record<ProspectStatusExt, { badge: string; dot: string }> = {
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
    badge: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400',
    dot: 'bg-green-500',
  },
  offer_sent: {
    badge: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400',
    dot: 'bg-indigo-500',
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
  currentOrder: string | undefined,
): { sort: SortableColumn; order: 'asc' | 'desc' } {
  if (currentSort === column) {
    return { sort: column, order: currentOrder === 'asc' ? 'desc' : 'asc' }
  }
  return { sort: column, order: 'desc' }
}

function ariaSortFor(
  column: SortableColumn,
  currentSort: string | undefined,
  currentOrder: string | undefined,
): 'ascending' | 'descending' | 'none' {
  if (currentSort !== column) return 'none'
  return currentOrder === 'asc' ? 'ascending' : 'descending'
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

function ScoreCell({ score }: { score: number }) {
  const tone =
    score >= 75 ? 'bg-green-500' : score >= 50 ? 'bg-yellow-500' : 'bg-gray-400'
  return (
    <div className="flex items-center gap-2">
      <span className="w-7 text-right text-sm font-bold tabular-nums text-gray-900 dark:text-white">
        {score}
      </span>
      <div
        className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
        aria-hidden="true"
      >
        <div
          className={`h-1.5 rounded-full transition-all ${tone}`}
          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
        />
      </div>
    </div>
  )
}

function BegesBadge({ prospect }: { prospect: Prospect }) {
  const begesPublie = prospect.beges_publie
  const begesValide = prospect.beges_valide
  const begesUrl = buildBegesUrl(prospect)
  const begesDate = prospect.beges_derniere_publication

  let badgeClass: string
  let badgeLabel: string

  if (begesPublie && begesValide) {
    badgeClass =
      'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-400 dark:border-green-800'
    badgeLabel = 'Publié'
  } else if (begesPublie && !begesValide) {
    badgeClass =
      'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-400 dark:border-orange-800'
    badgeLabel = 'Expiré'
  } else {
    badgeClass =
      'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800'
    badgeLabel = 'Absent'
  }

  const title = begesDate
    ? `Dernière publication : ${new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'short',
      }).format(new Date(begesDate))}`
    : undefined

  const badge = (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${badgeClass}`}
      title={title}
    >
      {badgeLabel}
      {begesDate && (
        <span className="opacity-70">
          {' '}
          {new Intl.DateTimeFormat('fr-FR', { year: 'numeric' }).format(
            new Date(begesDate),
          )}
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
        className="inline-flex transition-opacity hover:opacity-80"
      >
        {badge}
      </a>
    )
  }
  return badge
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
  // Tri par défaut : score décroissant — c'est l'axe principal de l'app.
  const sortCol = (params.sort as SortableColumn) ?? 'score_priorite'
  const sortOrderAsc = params.order === 'asc'
  const statutFilter = params.statut ? params.statut.split(',') : []
  const secteurFilter = params.secteur ?? ''
  const scoreMin = params.score_min ? parseInt(params.score_min, 10) : 0
  const showArchived = params.archived === '1'
  const contactTypes = parseContactTypes(params.contact_type)

  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  // RLS Supabase filtre déjà par auth.uid() côté policies — pas de .eq('user_id', ...)
  // ajouté côté app (cf. .claude/rules/security.md).
  let query = supabase
    .from('prospects')
    .select('*', { count: 'exact' })
    .order(sortCol, { ascending: sortOrderAsc })
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

  // Compteur "nouveaux dernier run" — récupère le started_at du dernier run agent
  // pour le user courant, puis compte les prospects créés depuis. RLS filtre
  // implicitement (session SSR). Si pas de run, on omet le segment côté UI.
  const lastRunPromise = supabase
    .from('agent_runs')
    .select('started_at')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const [{ data: prospects, count }, lastRunRes] = await Promise.all([
    query,
    lastRunPromise,
  ])

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

  const totalCount = count ?? 0
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  const hasActiveFilters =
    statutFilter.length > 0 ||
    Boolean(secteurFilter) ||
    scoreMin > 0 ||
    showArchived ||
    contactTypes.length > 0

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

  const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' })

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
            <span className="font-semibold text-gray-700 dark:text-gray-300">
              {totalCount}
            </span>{' '}
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

      {/* Filtres sticky en haut du scroll. Le wrapper étend le fond aux bords
          du <main> pour masquer le contenu qui passe derrière (sinon halo). */}
      <div className="sticky top-0 z-10 -mx-4 border-b border-gray-200/80 bg-gray-50/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-gray-50/80 dark:border-gray-800/80 dark:bg-gray-950/95 dark:supports-[backdrop-filter]:bg-gray-950/80 sm:-mx-6 sm:px-6">
        <ProspectsFilters
          currentStatuts={statutFilter}
          currentSecteur={secteurFilter}
          currentScoreMin={scoreMin}
          currentArchived={showArchived}
          currentContactTypes={contactTypes}
        />
      </div>

      {/* Tableau unifié — tous les prospects triés par score décroissant (défaut). */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Liste des prospects">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-800/40">
                <th scope="col" className={th}>
                  <span className="sr-only">Rang</span>
                  <span aria-hidden="true">#</span>
                </th>
                <th
                  scope="col"
                  className={th}
                  aria-sort={ariaSortFor('score_priorite', params.sort, params.order)}
                >
                  <Link
                    href={buildSortHref('score_priorite')}
                    className="group inline-flex items-center hover:text-gray-900 dark:hover:text-white"
                  >
                    Score
                    <SortIcon
                      column="score_priorite"
                      currentSort={params.sort}
                      currentOrder={params.order}
                    />
                  </Link>
                </th>
                <th
                  scope="col"
                  className={th}
                  aria-sort={ariaSortFor('raison_sociale', params.sort, params.order)}
                >
                  <Link
                    href={buildSortHref('raison_sociale')}
                    className="group inline-flex items-center hover:text-gray-900 dark:hover:text-white"
                  >
                    Entreprise
                    <SortIcon
                      column="raison_sociale"
                      currentSort={params.sort}
                      currentOrder={params.order}
                    />
                  </Link>
                </th>
                <th scope="col" className={`${th} hidden lg:table-cell`}>
                  Taille
                </th>
                <th scope="col" className={`${th} hidden sm:table-cell`}>
                  Géographie
                </th>
                <th scope="col" className={`${th} hidden lg:table-cell`}>
                  État BEGES
                </th>
                <th
                  scope="col"
                  className={th}
                  aria-sort={ariaSortFor('statut', params.sort, params.order)}
                >
                  <Link
                    href={buildSortHref('statut')}
                    className="group inline-flex items-center hover:text-gray-900 dark:hover:text-white"
                  >
                    Statut
                    <SortIcon
                      column="statut"
                      currentSort={params.sort}
                      currentOrder={params.order}
                    />
                  </Link>
                </th>
                <th
                  scope="col"
                  className={`${th} hidden xl:table-cell`}
                  aria-sort={ariaSortFor('updated_at', params.sort, params.order)}
                >
                  <Link
                    href={buildSortHref('updated_at')}
                    className="group inline-flex items-center hover:text-gray-900 dark:hover:text-white"
                  >
                    Dernière action
                    <SortIcon
                      column="updated_at"
                      currentSort={params.sort}
                      currentOrder={params.order}
                    />
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
                  const statut = prospect.statut as ProspectStatusExt
                  const statusStyle = STATUS_STYLES[statut] ?? STATUS_STYLES.sourced
                  const statusLabel = STATUS_LABELS[statut] ?? prospect.statut
                  const isEven = idx % 2 === 0
                  const rank = from + idx + 1

                  return (
                    <tr
                      key={prospect.id}
                      className={`group border-b border-gray-100 transition-colors duration-150 last:border-0 hover:bg-green-50/40 dark:border-gray-800/60 dark:hover:bg-green-950/10 ${
                        isEven ? '' : 'bg-gray-50/40 dark:bg-gray-800/10'
                      }`}
                    >
                      {/* 1. Rang */}
                      <td className="px-4 py-3.5 text-xs font-medium tabular-nums text-gray-400 dark:text-gray-600">
                        {rank}
                      </td>

                      {/* 2. Score */}
                      <td className="px-4 py-3.5">
                        <ScoreCell score={prospect.score_priorite} />
                      </td>

                      {/* 3. Entreprise */}
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

                      {/* 4. Taille */}
                      <td className="hidden px-4 py-3.5 text-sm text-gray-600 dark:text-gray-400 lg:table-cell">
                        {prospect.effectif_min && prospect.effectif_max ? (
                          <span className="tabular-nums">
                            {prospect.effectif_min}–{prospect.effectif_max}
                          </span>
                        ) : prospect.effectif_min ? (
                          <span className="tabular-nums">+{prospect.effectif_min}</span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-600">—</span>
                        )}
                      </td>

                      {/* 5. Géographie */}
                      <td className="hidden px-4 py-3.5 text-sm text-gray-600 dark:text-gray-400 sm:table-cell">
                        {prospect.ville ? (
                          <span>
                            {prospect.ville}
                            {prospect.code_postal && (
                              <span className="ml-1 text-xs text-gray-400 dark:text-gray-600">
                                ({prospect.code_postal})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-600">—</span>
                        )}
                      </td>

                      {/* 6. État BEGES */}
                      <td className="hidden px-4 py-3.5 lg:table-cell">
                        <BegesBadge prospect={prospect} />
                      </td>

                      {/* 7. Statut */}
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.badge}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${statusStyle.dot}`}
                            aria-hidden="true"
                          />
                          {statusLabel}
                        </span>
                      </td>

                      {/* 8. Dernière action */}
                      <td className="hidden px-4 py-3.5 text-sm tabular-nums text-gray-500 dark:text-gray-500 xl:table-cell">
                        {dateFmt.format(new Date(prospect.updated_at))}
                      </td>

                      {/* 9. Actions */}
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
                        {hasActiveFilters
                          ? 'Essayez de modifier ou réinitialiser vos filtres.'
                          : 'La prochaine campagne nocturne remplira cette liste.'}
                      </p>
                      {hasActiveFilters && (
                        <Link
                          href="/prospects"
                          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                          Réinitialiser les filtres
                        </Link>
                      )}
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
              <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-300">
                {page}
              </span>{' '}
              sur{' '}
              <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-300">
                {totalPages}
              </span>{' '}
              —{' '}
              <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-300">
                {totalCount}
              </span>{' '}
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

              <span className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold tabular-nums text-white">
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
