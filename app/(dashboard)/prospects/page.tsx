import { redirect } from 'next/navigation'
import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'
import type { Prospect, ProspectStatus } from '@/lib/types'
import { ProspectsFilters } from '@/components/prospects/prospects-filters'
import { ProspectActionsMenu } from '@/components/prospects/prospect-actions-menu'
import { buildBegesUrl } from '@/lib/utils/beges-url'
import { RunStatusBanner } from '@/components/dashboard/run-status-banner'
import {
  STATUS_LABELS_COMPACT,
} from '@/lib/constants/prospect-status'

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

// ── Styles badge tech dark (ring-1 translucide, visible sur fond navy) ────────

const STATUS_STYLES_TECH: Record<string, { badge: string; dot: string }> = {
  sourced:    { badge: 'bg-gray-500/10 text-gray-300 ring-1 ring-gray-500/20',     dot: 'bg-gray-400' },
  qualified:  { badge: 'bg-blue-500/10 text-blue-300 ring-1 ring-blue-500/20',     dot: 'bg-blue-400' },
  contacted:  { badge: 'bg-yellow-500/10 text-yellow-300 ring-1 ring-yellow-500/20', dot: 'bg-yellow-400' },
  interested: { badge: 'bg-green-500/10 text-green-300 ring-1 ring-green-500/20',  dot: 'bg-green-400' },
  rdv:        { badge: 'bg-green-500/10 text-green-300 ring-1 ring-green-500/20',  dot: 'bg-green-400' },
  offer_sent: { badge: 'bg-indigo-500/10 text-indigo-300 ring-1 ring-indigo-500/20', dot: 'bg-indigo-400' },
  converted:  { badge: 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20', dot: 'bg-emerald-400' },
  rejected:   { badge: 'bg-red-500/10 text-red-300 ring-1 ring-red-500/20',        dot: 'bg-red-400' },
  on_hold:    { badge: 'bg-orange-500/10 text-orange-300 ring-1 ring-orange-500/20', dot: 'bg-orange-400' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type SortableColumn =
  | 'raison_sociale'
  | 'score_priorite'
  | 'statut'
  | 'updated_at'
  | 'created_at'

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
      className="ml-1 text-green-400"
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
      className="ml-1 text-green-400"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function ScoreCell({ score }: { score: number }) {
  const barColor =
    score >= 75
      ? 'bg-gradient-to-r from-green-500 to-emerald-400'
      : score >= 50
        ? 'bg-gradient-to-r from-yellow-500 to-amber-400'
        : 'bg-gray-600'

  return (
    <div className="flex items-center gap-2">
      <span className="w-7 text-right font-mono text-sm font-bold tabular-nums text-white">
        {score}
      </span>
      <div
        className="h-1 w-14 overflow-hidden rounded-full bg-white/10"
        aria-hidden="true"
      >
        <div
          className={`h-1 rounded-full transition-all ${barColor}`}
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
    badgeClass = 'bg-green-500/10 text-green-300 ring-1 ring-green-500/20'
    badgeLabel = 'Publié'
  } else if (begesPublie && !begesValide) {
    badgeClass = 'bg-orange-500/10 text-orange-300 ring-1 ring-orange-500/20'
    badgeLabel = 'Expiré'
  } else {
    badgeClass = 'bg-red-500/10 text-red-300 ring-1 ring-red-500/20'
    badgeLabel = 'Absent'
  }

  const title = begesDate
    ? `Dernière publication : ${new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'short',
      }).format(new Date(begesDate))}`
    : undefined

  const badge = (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}
      title={title}
    >
      {badgeLabel}
      {begesDate && (
        <span className="opacity-60">
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
  /** "missing" pour ne lister que les entreprises avec BEGES absent OU expiré. */
  beges?: string
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
  const begesFilter: 'missing' | undefined = params.beges === 'missing' ? 'missing' : undefined

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
  if (begesFilter === 'missing') {
    // BEGES manquant = absent (beges_publie=false) OU expiré (beges_publie=true && beges_valide=false).
    // En SQL : `WHERE beges_publie = false OR beges_valide = false`.
    query = query.or('beges_publie.eq.false,beges_valide.eq.false')
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

  // Classes header colonne — label mono tech cyan
  const th =
    'px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/70'

  const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' })

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Bandeau live run agent — visible quand un sourcing est en cours,
          même si l'utilisateur a navigué hors du dashboard. */}
      <RunStatusBanner />

      {/* ── En-tête tech cockpit ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* Label mono au-dessus du titre */}
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-green-400/70">
            <span>{'// glan · base prospects'}</span>
          </p>
          <h1 className="mt-1 bg-gradient-to-br from-white via-green-100 to-green-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
            Prospects
          </h1>
          <p className="mt-1 font-mono text-[11px] text-green-400/70">
            {'// '}{totalCount} au total
            {newSinceLastRun > 0 && (
              <span className="ml-1 text-green-300/90">
                · {newSinceLastRun} nouveau{newSinceLastRun > 1 ? 'x' : ''} dernier run
              </span>
            )}
          </p>
        </div>
      </div>

      {/* ── Filtres sticky — wrapper translucide pour effet continuité ──── */}
      <div className="sticky top-0 z-10 -mx-4 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        {/* Fond semi-transparent pour masquer le contenu qui passe derrière */}
        <div className="absolute inset-0 bg-[oklch(11%_0.022_250_/_0.85)] backdrop-blur-xl" aria-hidden="true" />
        <div className="relative">
          <ProspectsFilters
            currentStatuts={statutFilter}
            currentSecteur={secteurFilter}
            currentScoreMin={scoreMin}
            currentArchived={showArchived}
            currentContactTypes={contactTypes}
            currentBegesFilter={begesFilter}
          />
        </div>
      </div>

      {/* ── Tableau prospects — style glassmorphism tech ─────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md">
        {/* Accent top border brand */}
        <div className="h-px w-full bg-gradient-to-r from-transparent via-green-400/50 to-transparent" aria-hidden="true" />

        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Liste des prospects">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
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
                    className="group inline-flex items-center hover:text-cyan-300"
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
                    className="group inline-flex items-center hover:text-cyan-300"
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
                  BEGES
                </th>
                <th
                  scope="col"
                  className={th}
                  aria-sort={ariaSortFor('statut', params.sort, params.order)}
                >
                  <Link
                    href={buildSortHref('statut')}
                    className="group inline-flex items-center hover:text-cyan-300"
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
                    className="group inline-flex items-center hover:text-cyan-300"
                  >
                    Dernière action
                    <SortIcon
                      column="updated_at"
                      currentSort={params.sort}
                      currentOrder={params.order}
                    />
                  </Link>
                </th>
                <th
                  scope="col"
                  className={`${th} hidden xl:table-cell`}
                  aria-sort={ariaSortFor('created_at', params.sort, params.order)}
                >
                  <Link
                    href={buildSortHref('created_at')}
                    className="group inline-flex items-center hover:text-cyan-300"
                  >
                    Ajouté le
                    <SortIcon
                      column="created_at"
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
                  const statut = prospect.statut as ProspectStatus
                  const statusStyle =
                    STATUS_STYLES_TECH[statut] ?? STATUS_STYLES_TECH.sourced
                  const statusLabel = STATUS_LABELS_COMPACT[statut] ?? prospect.statut
                  const rank = from + idx + 1

                  return (
                    <tr
                      key={prospect.id}
                      className="group relative border-b border-white/[0.04] transition-all duration-200 last:border-0 hover:bg-gradient-to-r hover:from-green-500/[0.04] hover:via-cyan-500/[0.03] hover:to-transparent hover:shadow-[inset_2px_0_0_0_oklch(70%_0.18_152_/_0.55)]"
                    >
                      {/* 1. Rang */}
                      <td className="px-4 py-3.5 font-mono text-xs tabular-nums text-gray-400">
                        {rank}
                      </td>

                      {/* 2. Score */}
                      <td className="px-4 py-3.5">
                        <ScoreCell score={prospect.score_priorite} />
                      </td>

                      {/* 3. Entreprise */}
                      <td className="px-4 py-3.5">
                        <Link href={`/prospects/${prospect.id}`} className="block">
                          <p className="font-semibold text-white transition-colors group-hover:text-green-300">
                            {prospect.raison_sociale}
                          </p>
                          {prospect.siren && (
                            <p className="mt-0.5 font-mono text-[10px] text-gray-400">
                              {prospect.siren}
                            </p>
                          )}
                        </Link>
                      </td>

                      {/* 4. Taille */}
                      <td className="hidden px-4 py-3.5 text-sm tabular-nums text-gray-400 lg:table-cell">
                        {prospect.effectif_min && prospect.effectif_max ? (
                          <span>
                            {prospect.effectif_min}–{prospect.effectif_max}
                          </span>
                        ) : prospect.effectif_min ? (
                          <span>+{prospect.effectif_min}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>

                      {/* 5. Géographie */}
                      <td className="hidden px-4 py-3.5 text-sm text-gray-400 sm:table-cell">
                        {prospect.ville ? (
                          <span>
                            {prospect.ville}
                            {prospect.code_postal && (
                              <span className="ml-1 font-mono text-[10px] text-gray-400">
                                {prospect.code_postal}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
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
                      <td className="hidden px-4 py-3.5 font-mono text-xs tabular-nums text-gray-400 xl:table-cell">
                        {dateFmt.format(new Date(prospect.updated_at))}
                      </td>

                      {/* 9. Ajouté le */}
                      <td className="hidden px-4 py-3.5 font-mono text-xs tabular-nums text-gray-400 xl:table-cell">
                        {dateFmt.format(new Date(prospect.created_at))}
                      </td>

                      {/* 10. Actions */}
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
                  <td colSpan={10} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      {/* Icône cercle translucide */}
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.04] ring-1 ring-white/[0.08]">
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
                          className="text-gray-400"
                          aria-hidden="true"
                        >
                          <circle cx="11" cy="11" r="8" />
                          <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                      </div>
                      <p className="text-sm font-semibold text-gray-200">
                        Aucun prospect trouvé
                      </p>
                      <p className="text-xs text-gray-400">
                        {hasActiveFilters
                          ? 'Modifiez ou réinitialisez vos filtres.'
                          : 'La prochaine campagne nocturne remplira cette liste.'}
                      </p>
                      {hasActiveFilters && (
                        <Link
                          href="/prospects"
                          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-medium text-gray-300 transition-colors hover:border-green-500/30 hover:bg-green-500/10 hover:text-green-300"
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

        {/* ── Pagination — style translucide ───────────────────────────── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3.5">
            <p className="font-mono text-xs text-gray-400">
              p.{' '}
              <span className="tabular-nums text-gray-300">
                {page}
              </span>
              {' / '}
              <span className="tabular-nums text-gray-300">
                {totalPages}
              </span>
              {' — '}
              <span className="tabular-nums text-gray-300">
                {totalCount}
              </span>{' '}
              résultats
            </p>
            <div className="flex items-center gap-1.5">
              {page > 1 ? (
                <Link
                  href={buildHref({ page: String(page - 1) })}
                  aria-label="Page précédente"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 font-mono text-xs text-gray-300 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
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
                  Préc.
                </Link>
              ) : (
                <span className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-1.5 font-mono text-xs text-gray-400">
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
                  Préc.
                </span>
              )}

              <span className="rounded-lg bg-green-500/15 px-3 py-1.5 font-mono text-xs font-semibold tabular-nums text-green-300 ring-1 ring-green-500/30">
                {page}
              </span>

              {page < totalPages ? (
                <Link
                  href={buildHref({ page: String(page + 1) })}
                  aria-label="Page suivante"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 font-mono text-xs text-gray-300 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                >
                  Suiv.
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
                <span className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-1.5 font-mono text-xs text-gray-400">
                  Suiv.
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
