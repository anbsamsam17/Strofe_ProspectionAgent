import { redirect } from 'next/navigation'
import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'
import type { Prospect, ProspectStatus } from '@/lib/types'
import { ProspectsFilters } from '@/components/prospects/prospects-filters'
import { ProspectActionsMenu } from '@/components/prospects/prospect-actions-menu'
import { DeleteProspectButton } from '@/components/prospects/delete-prospect-button'
import {
  BulkDeleteButton,
  type BulkBegesFilter,
  type BulkContactFilter,
  type BulkDeleteFilters,
} from '@/components/prospects/bulk-delete-button'
import { ImportCsvModal } from '@/components/prospects/import-csv-modal'
import { buildBegesUrl } from '@/lib/utils/beges-url'
import { isBegesExpiringSoon } from '@/lib/agent/beges-expiration'
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
    <div className="flex flex-shrink-0 items-center gap-2">
      <span className="w-7 flex-shrink-0 text-right font-mono text-sm font-bold tabular-nums text-white">
        {score}
      </span>
      <div
        className="h-1 w-14 flex-shrink-0 overflow-hidden rounded-full bg-white/10"
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

  // GLN-080 — Indicateur discret "expire dans <3 mois" : un point orange
  // après le badge (visible mais ne casse pas la lecture du tableau).
  const expiringSoon =
    begesPublie === true &&
    begesValide === true &&
    isBegesExpiringSoon({
      beges_derniere_publication: prospect.beges_derniere_publication ?? null,
      entite_publique: prospect.entite_publique ?? null,
    })

  const title = begesDate
    ? `Dernière publication : ${new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'short',
      }).format(new Date(begesDate))}${expiringSoon ? ' · expire dans moins de 3 mois' : ''}`
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
      {expiringSoon && (
        <span
          className="ml-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-orange-400"
          aria-label="BEGES expirant dans moins de 3 mois"
          title="BEGES expirant dans moins de 3 mois"
        />
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
  /**
   * Nouveau format compact (post-pivot) : `score_desc` / `score_asc`
   * / `created_desc` / `created_asc`. Défaut côté serveur = `score_desc`.
   * Le format historique `?sort=score_priorite&order=desc` reste supporté
   * via mapping rétrocompat (cf. `mapLegacySort` ci-dessous).
   */
  sort?: string
  order?: string
  statut?: string
  secteur?: string
  score_min?: string
  /**
   * Borne supérieure du range de score (0-100). Combinée à `score_min` pour
   * former un filtre [min, max]. Absente = 100 = pas de filtre haut.
   */
  score_max?: string
  /** "1" pour afficher uniquement les prospects archivés. */
  archived?: string
  contact_type?: string
  /** "missing" pour ne lister que les entreprises avec BEGES absent OU expiré. */
  beges?: string
  /** "1" pour le filtre rapide "Hot leads uniquement" (GLN-081). */
  hot?: string
  /** "1" pour le filtre rapide "BEGES non conforme Décret 2022" (GLN-006). */
  decret_non_compliant?: string
}

// ── Sort (pills inline) ──────────────────────────────────────────────────────

/** Valeurs valides du tri compact (UI pills). */
const SORT_VALUES = ['score_desc', 'score_asc', 'created_desc', 'created_asc'] as const
type SortValue = (typeof SORT_VALUES)[number]
const DEFAULT_SORT: SortValue = 'score_desc'

/**
 * Mapping tri → colonne Supabase + sens.
 * Source de vérité unique partagée entre la query DB et l'UI.
 */
const SORT_TO_ORDER: Record<SortValue, { column: SortableColumn; ascending: boolean }> = {
  score_desc: { column: 'score_priorite', ascending: false },
  score_asc: { column: 'score_priorite', ascending: true },
  created_desc: { column: 'created_at', ascending: false },
  created_asc: { column: 'created_at', ascending: true },
}

/**
 * Parse `?sort=` avec fallback vers le défaut.
 * Anti-fuzzing : toute valeur hors liste → défaut silencieusement.
 * Rétrocompat : ?sort=score_priorite&order=desc/asc → score_desc/asc.
 */
function parseSort(rawSort: string | undefined, rawOrder: string | undefined): SortValue {
  if (rawSort && (SORT_VALUES as readonly string[]).includes(rawSort)) {
    return rawSort as SortValue
  }
  // Rétrocompat : ancien format `?sort=<col>&order=<asc|desc>`.
  // On ne migre que les colonnes encore exposées en UI compact (score, created).
  if (rawSort === 'score_priorite') {
    return rawOrder === 'asc' ? 'score_asc' : 'score_desc'
  }
  if (rawSort === 'created_at') {
    return rawOrder === 'asc' ? 'created_asc' : 'created_desc'
  }
  return DEFAULT_SORT
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

  // Tri — deux formats supportés en parallèle :
  //   1) Compact pills UI : ?sort=score_desc / score_asc / created_desc / created_asc
  //   2) Legacy column-header : ?sort=raison_sociale&order=asc (toujours utilisé
  //      pour les colonnes Entreprise / Statut / Dernière action).
  // On essaie d'abord la résolution legacy par nom de colonne ; sinon on
  // bascule sur parseSort (compact + défaut).
  const LEGACY_SORT_COLUMNS: readonly SortableColumn[] = [
    'raison_sociale',
    'score_priorite',
    'statut',
    'updated_at',
    'created_at',
  ]
  let sortCol: SortableColumn
  let sortOrderAsc: boolean
  let sortValue: SortValue = DEFAULT_SORT
  if (
    params.sort &&
    (LEGACY_SORT_COLUMNS as readonly string[]).includes(params.sort) &&
    params.sort !== 'score_priorite' &&
    params.sort !== 'created_at'
  ) {
    // Format legacy strict (col qui n'a pas d'équivalent pill) : on respecte.
    sortCol = params.sort as SortableColumn
    sortOrderAsc = params.order === 'asc'
  } else {
    sortValue = parseSort(params.sort, params.order)
    const mapping = SORT_TO_ORDER[sortValue]
    sortCol = mapping.column
    sortOrderAsc = mapping.ascending
  }
  // Statuts valides post-migration 017 (ENUM prospect_status).
  // Filtre defensive : on retire silencieusement les valeurs URL qui ne
  // correspondent pas à un statut connu (anti-fuzzing).
  const VALID_STATUTS: readonly ProspectStatus[] = [
    'sourced',
    'qualified',
    'contacted',
    'interested',
    'rdv',
    'offer_sent',
    'converted',
    'rejected',
    'on_hold',
    'do_not_contact',
  ]
  const statutFilter: ProspectStatus[] = params.statut
    ? params.statut
        .split(',')
        .filter((s): s is ProspectStatus =>
          (VALID_STATUTS as readonly string[]).includes(s),
        )
    : []
  const secteurFilter = params.secteur ?? ''
  const scoreMin = params.score_min ? parseInt(params.score_min, 10) : 0
  // Borne haute du range. Défaut 100 = pas de filtre. Clamp défensif 0-100
  // (anti-fuzzing URL) et garantit max >= min (sinon on neutralise le filtre).
  const scoreMaxRaw = params.score_max ? parseInt(params.score_max, 10) : 100
  const scoreMax =
    Number.isFinite(scoreMaxRaw) && scoreMaxRaw >= 0 && scoreMaxRaw <= 100
      ? Math.max(scoreMaxRaw, scoreMin)
      : 100
  const showArchived = params.archived === '1'
  // GLN-081 — Filtre Hot leads uniquement (colonne GENERATED is_hot_lead).
  const hotOnly = params.hot === '1'
  // GLN-006 — Filtre BEGES non conforme Décret 2022-982 (publié post-2023
  // sans scope 3 OU sans plan d'action). Cible commerciale renouvellement.
  const decretNonCompliantOnly = params.decret_non_compliant === '1'
  const contactTypes = parseContactTypes(params.contact_type)
  // Parsing CSV : ?beges=missing,obligation → ['missing', 'obligation']
  // Toggles combinables (AND) côté query Supabase.
  const begesFilters: ('missing' | 'obligation')[] = (params.beges ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is 'missing' | 'obligation' => s === 'missing' || s === 'obligation')

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
  // Range score [min, max] — on omet `.gte` si min=0 et `.lte` si max=100
  // pour ne pas surfiltrer une plage qui couvre tout.
  if (scoreMin > 0) {
    query = query.gte('score_priorite', scoreMin)
  }
  if (scoreMax < 100) {
    query = query.lte('score_priorite', scoreMax)
  }
  if (contactTypes.length > 0) {
    // Multi-select = OR : un prospect matche s'il a AU MOINS un des canaux choisis.
    const orClause = contactTypes
      .map((t) => `${CONTACT_FIELD_BY_TYPE[t]}.not.is.null`)
      .join(',')
    query = query.or(orClause)
  }
  // Filtres BEGES combinables (AND entre eux).
  if (begesFilters.includes('obligation')) {
    // Entreprises soumises à l'obligation BEGES (Article L. 229-25).
    query = query.eq('obligation_beges', true)
  }
  if (begesFilters.includes('missing')) {
    // BEGES manquant = absent (beges_publie=false) OU expiré (beges_publie=true && beges_valide=false).
    query = query.or('beges_publie.eq.false,beges_valide.eq.false')
  }
  // GLN-081 — Filtre rapide "Hot leads uniquement". S'appuie sur la colonne
  // GENERATED is_hot_lead (migration 024) — formule composite côté DB.
  if (hotOnly) {
    query = query.eq('is_hot_lead', true)
  }
  // GLN-006 — Filtre rapide "BEGES non conforme Décret 2022". S'appuie sur
  // la colonne tristate beges_decret_2022_compliant (migration 023 + helper
  // lib/agent/decret-2022.ts). Cible : BEGES publié post-2023 mais sans
  // scope 3 ou sans plan d'action — renouvellement quasi-obligatoire.
  if (decretNonCompliantOnly) {
    query = query.eq('beges_decret_2022_compliant', false)
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
    contactTypes.length > 0 ||
    begesFilters.length > 0 ||
    hotOnly ||
    decretNonCompliantOnly

  // Filtres pour le BulkDeleteButton — strictement alignés avec la query GET
  // ci-dessus. Cast safe : statutFilter sort de parseContactTypes/searchParams
  // et a déjà été validé par la query Supabase (statuts inconnus ignorés).
  const bulkFilters: BulkDeleteFilters = {
    statut: statutFilter as ProspectStatus[],
    secteur: secteurFilter || undefined,
    score_min: scoreMin > 0 ? scoreMin : undefined,
    archived: showArchived,
    contact_type: contactTypes as BulkContactFilter[],
    beges: begesFilters as BulkBegesFilter[],
  }

  // Si l'URL a été générée par les pills (sort=score_desc...), on préserve la
  // forme compacte. Sinon on garde le legacy ?sort=<col>&order=<dir>.
  const isCompactSort =
    params.sort !== undefined && (SORT_VALUES as readonly string[]).includes(params.sort)
  const sortDefaults: Record<string, string> = isCompactSort
    ? { sort: params.sort as string }
    : { sort: sortCol, order: params.order ?? 'desc' }

  function buildHref(newParams: Record<string, string>) {
    const merged: Record<string, string> = {
      page: String(page),
      ...sortDefaults,
      ...(params.statut ? { statut: params.statut } : {}),
      ...(secteurFilter ? { secteur: secteurFilter } : {}),
      ...(scoreMin > 0 ? { score_min: String(scoreMin) } : {}),
      ...(showArchived ? { archived: '1' } : {}),
      ...(contactTypes.length > 0 ? { contact_type: contactTypes.join(',') } : {}),
      ...(hotOnly ? { hot: '1' } : {}),
      ...(decretNonCompliantOnly ? { decret_non_compliant: '1' } : {}),
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

      {/* ── Bandeau onboarding — conditionnel : 0 prospects ET aucun run ── */}
      {totalCount === 0 && !lastRunStartedAt && (
        <div className="relative overflow-hidden rounded-2xl border border-green-500/20 bg-white/[0.03] p-6 backdrop-blur-md">
          {/* Accent top */}
          <div
            className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-green-400/50 to-transparent"
            aria-hidden="true"
          />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-white">
                Bienvenue. Je n&apos;ai encore rien glané pour vous.
              </p>
              <p className="max-w-xl text-xs leading-relaxed text-gray-400">
                Quelques minutes de configuration (offre, secteurs cibles,
                pondérations 3 piliers), puis vous me lancez. Je glane Sirene et
                l&apos;ADEME, vous récupérez une liste priorisée.
              </p>
            </div>
            <Link
              href="/glan"
              className="inline-flex flex-shrink-0 items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 px-5 py-2.5 text-sm font-semibold text-green-300 transition-colors hover:border-green-500/50 hover:bg-green-500/20"
            >
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
                <path d="M5 12h14m-7-7 7 7-7 7" />
              </svg>
              Lancer Glan
            </Link>
          </div>
        </div>
      )}

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

        {/* Actions header — import warm + bulk-delete (visible seulement si filtres actifs). */}
        <div className="flex items-center gap-2">
          <ImportCsvModal />
          <BulkDeleteButton filters={bulkFilters} count={totalCount} />
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
            currentBegesFilters={begesFilters}
            currentSort={sortValue}
            currentHotOnly={hotOnly}
            currentDecretNonCompliantOnly={decretNonCompliantOnly}
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
                          <p className="flex items-center gap-1.5 font-semibold text-white transition-colors group-hover:text-green-300">
                            {prospect.raison_sociale || (
                              <span className="italic text-gray-500">— sans nom —</span>
                            )}
                            {/* GLN-081 — Micro-badge Hot lead (icône flamme),
                                visible directement dans la liste à côté du nom. */}
                            {prospect.is_hot_lead && (
                              <span
                                title="Top opportunité (Hot lead)"
                                aria-label="Top opportunité (Hot lead)"
                                className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-300 ring-1 ring-red-500/30"
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="9"
                                  height="9"
                                  viewBox="0 0 24 24"
                                  fill="currentColor"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
                                </svg>
                              </span>
                            )}
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
                          <span className="whitespace-nowrap">
                            {prospect.ville}
                            {prospect.code_postal && (
                              <span className="ml-1.5 font-mono text-[10px] text-gray-400">
                                · {prospect.code_postal}
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
                          <DeleteProspectButton
                            prospectId={prospect.id}
                            prospectName={prospect.raison_sociale}
                            prospectSiren={prospect.siren}
                          />
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
                          : "Lancez Glan depuis la page de l’agent pour glaner vos premiers prospects BEGES, ou ajustez vos critères."}
                      </p>
                      {!hasActiveFilters && (
                        <Link
                          href="/glan"
                          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-xs font-medium text-green-300 transition-colors hover:border-green-500/50 hover:bg-green-500/20"
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
                            <path d="M5 12h14m-7-7 7 7-7 7" />
                          </svg>
                          Lancer Glan
                        </Link>
                      )}
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
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-xs text-gray-300 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-[oklch(11%_0.022_250)]"
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
                <span className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 font-mono text-xs text-gray-400">
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

              <span className="rounded-lg bg-green-500/15 px-3 py-2 font-mono text-xs font-semibold tabular-nums text-green-300 ring-1 ring-green-500/30">
                {page}
              </span>

              {page < totalPages ? (
                <Link
                  href={buildHref({ page: String(page + 1) })}
                  aria-label="Page suivante"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-xs text-gray-300 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-[oklch(11%_0.022_250)]"
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
                <span className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 font-mono text-xs text-gray-400">
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
