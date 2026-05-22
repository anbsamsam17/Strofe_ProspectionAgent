'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { ProspectStatus } from '@/lib/types'

export type ContactFilterType = 'phone' | 'email' | 'linkedin'

/**
 * Filtres BEGES — combinables (AND) :
 *   - 'missing' : BEGES absent OU expiré (cible commerciale chaude).
 *   - 'obligation' : entreprises soumises à l'obligation BEGES (Article L. 229-25).
 * Tableau vide = aucun filtre BEGES.
 */
export type BegesFilterValue = 'missing' | 'obligation'

/**
 * Tri inline visible (pills). Valeurs URL : ?sort=<value>.
 * `score_desc` reste le défaut côté serveur ; côté UI on l'affiche actif
 * même quand `?sort` est absent.
 */
export type SortValue = 'score_desc' | 'score_asc' | 'created_desc' | 'created_asc'

interface ProspectsFiltersProps {
  currentStatuts: string[]
  currentSecteur: string
  currentScoreMin: number
  /**
   * Borne supérieure du range de score (0-100). Défaut = 100 = pas de filtre haut.
   * Combiné avec `currentScoreMin`, formant un range [min, max].
   */
  currentScoreMax?: number
  currentArchived: boolean
  currentContactTypes?: ContactFilterType[]
  currentBegesFilters?: BegesFilterValue[]
  currentSort?: SortValue
  /** GLN-081 — Filtre rapide "Hot leads uniquement" (?hot=1). */
  currentHotOnly?: boolean
  /** GLN-006 — Filtre rapide "BEGES non conforme Décret 2022" (?decret_non_compliant=1). */
  currentDecretNonCompliantOnly?: boolean
  /**
   * Sprint 3 retour client #1 — Etat replie/deplie de la zone de filtres.
   * `true` = barre compacte affichee (gain de place). Etat persiste via
   * `?filters=collapsed` pour conserver le choix entre onglets et au partage URL.
   */
  currentCollapsed?: boolean
  /**
   * Sprint 3 retour client #2 — Recherche libre cote serveur (raison sociale,
   * SIREN, email contact, nom dirigeant). Submit Enter ou blur → push ?q=...
   */
  currentSearchQuery?: string
}

// TODO(Agent A): `offer_sent` à ajouter à `ProspectStatus` (`lib/types.ts`).
// En attendant la migration, on l'expose ici en union locale pour rester
// compatible avec les futurs prospects sans casser le typage de `lib/types.ts`.
type StatusFilterValue = ProspectStatus | 'offer_sent'

// Labels alignés sur la colonne Statut du tableau (`app/(dashboard)/prospects/page.tsx`).
// `rdv` est legacy — fusionné visuellement avec « Intéressé ». On garde la valeur
// dans le pipeline tant que des lignes existantes en base ne sont pas migrées.
const ALL_STATUTS: { value: StatusFilterValue; label: string; dot: string }[] = [
  { value: 'sourced', label: 'Nouveau', dot: 'bg-gray-400' },
  { value: 'qualified', label: 'Qualifié', dot: 'bg-blue-500' },
  { value: 'contacted', label: 'Contacté', dot: 'bg-yellow-500' },
  { value: 'interested', label: 'Intéressé', dot: 'bg-green-500' },
  { value: 'offer_sent', label: 'Offre envoyée', dot: 'bg-indigo-500' },
  { value: 'converted', label: 'Affaire conclue', dot: 'bg-emerald-500' },
  { value: 'rejected', label: 'Sans suite', dot: 'bg-red-500' },
  { value: 'on_hold', label: 'En stand-by', dot: 'bg-orange-500' },
  // Migration 017 : slate (neutre) — distinct du red 'rejected'.
  { value: 'do_not_contact', label: 'Ne pas contacter', dot: 'bg-slate-400' },
]

const ALL_CONTACT_TYPES: { value: ContactFilterType; label: string }[] = [
  { value: 'phone', label: 'Téléphone' },
  { value: 'email', label: 'Email' },
  { value: 'linkedin', label: 'LinkedIn' },
]

// Pills tri — labels préfixés "Tri :" pour clarifier la sémantique (TRI vs FILTRE).
// On garde les glyphes flèches "Score ↓" / "Score ↑" / "Récent" / "Ancien" en suffixe
// pour rester lisible d'un coup d'oeil et compat des tests existants.
const ALL_SORTS: { value: SortValue; label: string }[] = [
  { value: 'score_desc', label: 'Tri : Score ↓' },
  { value: 'score_asc', label: 'Tri : Score ↑' },
  { value: 'created_desc', label: 'Tri : Récent' },
  { value: 'created_asc', label: 'Tri : Ancien' },
]

const DEFAULT_SORT: SortValue = 'score_desc'

// Bornes du range score (filtre [min, max], 0-100, pas de 5).
const SCORE_MIN_BOUND = 0
const SCORE_MAX_BOUND = 100
const SCORE_STEP = 5

export function ProspectsFilters({
  currentStatuts,
  currentSecteur,
  currentScoreMin,
  currentScoreMax = SCORE_MAX_BOUND,
  currentArchived,
  currentContactTypes = [],
  currentBegesFilters = [],
  currentSort = DEFAULT_SORT,
  currentHotOnly = false,
  currentDecretNonCompliantOnly = false,
  currentCollapsed = false,
  currentSearchQuery = '',
}: ProspectsFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [collapsed, setCollapsed] = useState<boolean>(currentCollapsed)
  const [searchQuery, setSearchQuery] = useState<string>(currentSearchQuery)

  function commitSearchQuery(value: string) {
    const trimmed = value.trim().slice(0, 200)
    // Skip si pas de changement effectif (evite re-render inutile au blur).
    if (trimmed === currentSearchQuery) return
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', '1')
    if (trimmed) {
      params.set('q', trimmed)
    } else {
      params.delete('q')
    }
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    // Persistance URL pour preserver l'etat multi-onglets / partage de lien.
    const params = new URLSearchParams(searchParams.toString())
    if (next) {
      params.set('filters', 'collapsed')
    } else {
      params.delete('filters')
    }
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  const [statuts, setStatuts] = useState<string[]>(currentStatuts)
  const [secteur, setSecteur] = useState(currentSecteur)
  const [scoreMin, setScoreMin] = useState(currentScoreMin)
  const [scoreMax, setScoreMax] = useState(currentScoreMax)
  const [archived, setArchived] = useState<boolean>(currentArchived)
  const [contactTypes, setContactTypes] = useState<ContactFilterType[]>(currentContactTypes)
  const [begesFilters, setBegesFilters] = useState<BegesFilterValue[]>(currentBegesFilters)
  const [sort, setSort] = useState<SortValue>(currentSort)
  const [hotOnly, setHotOnly] = useState<boolean>(currentHotOnly)
  const [decretNonCompliantOnly, setDecretNonCompliantOnly] = useState<boolean>(
    currentDecretNonCompliantOnly,
  )
  const [moreOpen, setMoreOpen] = useState<boolean>(false)

  function applyFilters(
    newStatuts: string[],
    newSecteur: string,
    newScoreMin: number,
    newScoreMax: number,
    newArchived: boolean,
    newContactTypes: ContactFilterType[],
    newBegesFilters: BegesFilterValue[],
    newSort: SortValue,
    newHotOnly: boolean = hotOnly,
    newDecretNonCompliantOnly: boolean = decretNonCompliantOnly,
  ) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', '1')

    // GLN-081 — Filtre rapide Hot leads uniquement (?hot=1).
    if (newHotOnly) {
      params.set('hot', '1')
    } else {
      params.delete('hot')
    }

    // GLN-006 — Filtre rapide BEGES non conforme Décret 2022-982 (?decret_non_compliant=1).
    if (newDecretNonCompliantOnly) {
      params.set('decret_non_compliant', '1')
    } else {
      params.delete('decret_non_compliant')
    }

    if (newStatuts.length > 0) {
      params.set('statut', newStatuts.join(','))
    } else {
      params.delete('statut')
    }

    if (newSecteur) {
      params.set('secteur', newSecteur)
    } else {
      params.delete('secteur')
    }

    // Range score [min, max] :
    //   - min > 0 → ?score_min=X
    //   - max < 100 → ?score_max=Y
    //   - défaut [0, 100] = aucun param (URL propre).
    if (newScoreMin > SCORE_MIN_BOUND) {
      params.set('score_min', String(newScoreMin))
    } else {
      params.delete('score_min')
    }
    if (newScoreMax < SCORE_MAX_BOUND) {
      params.set('score_max', String(newScoreMax))
    } else {
      params.delete('score_max')
    }

    if (newArchived) {
      params.set('archived', '1')
    } else {
      params.delete('archived')
    }

    if (newContactTypes.length > 0) {
      params.set('contact_type', newContactTypes.join(','))
    } else {
      params.delete('contact_type')
    }

    if (newBegesFilters.length > 0) {
      params.set('beges', newBegesFilters.join(','))
    } else {
      params.delete('beges')
    }

    // Tri : on omet le param quand il vaut le défaut pour garder l'URL propre.
    if (newSort !== DEFAULT_SORT) {
      params.set('sort', newSort)
    } else {
      params.delete('sort')
    }
    // Format pré-pivot : ?sort=score_priorite&order=desc — supprimé pour
    // éviter la collision avec le nouveau ?sort=score_desc.
    params.delete('order')

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  function toggleStatut(value: string) {
    const next = statuts.includes(value)
      ? statuts.filter((s) => s !== value)
      : [...statuts, value]
    setStatuts(next)
    applyFilters(next, secteur, scoreMin, scoreMax, archived, contactTypes, begesFilters, sort)
  }

  function toggleContactType(value: ContactFilterType) {
    const next = contactTypes.includes(value)
      ? contactTypes.filter((t) => t !== value)
      : [...contactTypes, value]
    setContactTypes(next)
    applyFilters(statuts, secteur, scoreMin, scoreMax, archived, next, begesFilters, sort)
  }

  function toggleBegesValue(value: BegesFilterValue) {
    const next: BegesFilterValue[] = begesFilters.includes(value)
      ? begesFilters.filter((b) => b !== value)
      : [...begesFilters, value]
    setBegesFilters(next)
    applyFilters(statuts, secteur, scoreMin, scoreMax, archived, contactTypes, next, sort)
  }

  function handleSecteurChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSecteur(e.target.value)
  }

  function handleSecteurKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      applyFilters(statuts, secteur, scoreMin, scoreMax, archived, contactTypes, begesFilters, sort)
    }
  }

  // Range double-thumb : clamp min ≤ max (les thumbs ne peuvent jamais se croiser).
  // On force au moins 1 cran d'écart (SCORE_STEP) pour rester saisissable visuellement.
  function handleScoreMinChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = parseInt(e.target.value, 10)
    const clamped = Math.min(raw, scoreMax - SCORE_STEP)
    const val = Math.max(SCORE_MIN_BOUND, clamped)
    setScoreMin(val)
    applyFilters(statuts, secteur, val, scoreMax, archived, contactTypes, begesFilters, sort)
  }

  function handleScoreMaxChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = parseInt(e.target.value, 10)
    const clamped = Math.max(raw, scoreMin + SCORE_STEP)
    const val = Math.min(SCORE_MAX_BOUND, clamped)
    setScoreMax(val)
    applyFilters(statuts, secteur, scoreMin, val, archived, contactTypes, begesFilters, sort)
  }

  function toggleArchived() {
    const next = !archived
    setArchived(next)
    applyFilters(statuts, secteur, scoreMin, scoreMax, next, contactTypes, begesFilters, sort)
  }

  function toggleHotOnly() {
    const next = !hotOnly
    setHotOnly(next)
    applyFilters(
      statuts,
      secteur,
      scoreMin,
      scoreMax,
      archived,
      contactTypes,
      begesFilters,
      sort,
      next,
    )
  }

  function toggleDecretNonCompliantOnly() {
    const next = !decretNonCompliantOnly
    setDecretNonCompliantOnly(next)
    applyFilters(
      statuts,
      secteur,
      scoreMin,
      scoreMax,
      archived,
      contactTypes,
      begesFilters,
      sort,
      hotOnly,
      next,
    )
  }

  function selectSort(value: SortValue) {
    if (value === sort) return
    setSort(value)
    applyFilters(statuts, secteur, scoreMin, scoreMax, archived, contactTypes, begesFilters, value)
  }

  function handleReset() {
    setStatuts([])
    setSecteur('')
    setScoreMin(SCORE_MIN_BOUND)
    setScoreMax(SCORE_MAX_BOUND)
    setArchived(false)
    setContactTypes([])
    setBegesFilters([])
    setSort(DEFAULT_SORT)
    setHotOnly(false)
    setDecretNonCompliantOnly(false)
    setSearchQuery('')
    startTransition(() => {
      // On preserve l'etat `?filters=collapsed` si actif — un user qui a replie
      // ne veut pas voir le panneau s'ouvrir au reset.
      const preservedParams = new URLSearchParams()
      if (collapsed) preservedParams.set('filters', 'collapsed')
      const qs = preservedParams.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  const hasScoreFilter = scoreMin > SCORE_MIN_BOUND || scoreMax < SCORE_MAX_BOUND
  const hasFilters =
    statuts.length > 0 ||
    secteur ||
    hasScoreFilter ||
    archived ||
    contactTypes.length > 0 ||
    begesFilters.length > 0 ||
    hotOnly ||
    decretNonCompliantOnly ||
    Boolean(currentSearchQuery)

  // Sprint 3 retour client #1 — Comptage des filtres actifs pour le badge
  // affiche dans le bouton "Filtres (N)" en mode replie. Statut/contact/beges
  // multi-select comptent comme 1 chacun (le user pense en "categorie").
  const activeFilterCount =
    (statuts.length > 0 ? 1 : 0) +
    (secteur ? 1 : 0) +
    (hasScoreFilter ? 1 : 0) +
    (archived ? 1 : 0) +
    (contactTypes.length > 0 ? 1 : 0) +
    (begesFilters.length > 0 ? 1 : 0) +
    (hotOnly ? 1 : 0) +
    (decretNonCompliantOnly ? 1 : 0) +
    (currentSearchQuery ? 1 : 0)

  // Pourcentages pour la track active du range (entre les 2 thumbs).
  const scoreLeftPct = (scoreMin / SCORE_MAX_BOUND) * 100
  const scoreRightPct = (scoreMax / SCORE_MAX_BOUND) * 100

  // Classes utilitaires partagées entre pills (statut, contact, tri).
  // Padding élargi (py-1.5 px-3) vs version compactée précédente (py-1 px-2.5).
  const pillBase =
    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-[oklch(11%_0.022_250)]'
  const pillInactive =
    'border-white/10 bg-white/[0.04] backdrop-blur-md text-gray-300 hover:border-white/20 hover:bg-white/[0.08]'
  const pillActive =
    'border-green-500/40 bg-green-500/15 text-green-300 ring-1 ring-green-500/25'

  // Sprint 3 retour client #1 — Mode replie : barre compacte qui prend ~50px
  // de hauteur au lieu de 250-300px en mode complet. L'utilisateur regagne
  // de la place pour voir plus de lignes du tableau sans perdre l'acces aux
  // filtres (resume + bouton "Filtres (N)" reste visible et cliquable).
  if (collapsed) {
    return (
      <div
        className={`flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 backdrop-blur-md shadow-sm transition-opacity sm:px-4 ${isPending ? 'opacity-60' : ''}`}
        aria-label="Filtres des prospects (replies)"
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={false}
          aria-controls="prospects-filters-panel"
          className="inline-flex flex-shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:border-green-500/30 hover:bg-green-500/10 hover:text-green-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
        >
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
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="7" y1="12" x2="17" y2="12" />
            <line x1="10" y1="18" x2="14" y2="18" />
          </svg>
          Filtres
          {activeFilterCount > 0 && (
            <span
              className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-green-500/25 px-1.5 font-mono text-[10px] font-bold tabular-nums text-green-200 ring-1 ring-green-500/40"
              aria-label={`${activeFilterCount} filtre${activeFilterCount > 1 ? 's' : ''} actif${activeFilterCount > 1 ? 's' : ''}`}
            >
              {activeFilterCount}
            </span>
          )}
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
            className="ml-0.5"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* Sprint 3 retour client #2 — Recherche libre disponible meme en mode
            replie : c'est l'usage le plus frequent, le user ne veut pas
            re-deplier juste pour rechercher. */}
        <div className="relative min-w-[200px] flex-1">
          <label htmlFor="filter-search-collapsed" className="sr-only">
            Rechercher un prospect
          </label>
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
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            id="filter-search-collapsed"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onBlur={(e) => commitSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitSearchQuery(searchQuery)
              }
            }}
            placeholder="Rechercher (raison sociale, SIREN, email, dirigeant)"
            maxLength={200}
            className="w-full rounded-full border border-white/[0.08] bg-white/[0.04] backdrop-blur-md py-1.5 pl-9 pr-3 text-xs text-white placeholder-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
          />
        </div>

        {hasFilters && (
          <div className="flex w-full items-center gap-2 overflow-hidden sm:w-auto sm:flex-1">
            <p className="flex-1 truncate text-[11px] text-gray-400">
              {[
                currentSearchQuery && `recherche "${currentSearchQuery}"`,
                hotOnly && 'Hot leads',
                decretNonCompliantOnly && 'Décret 2022 non conforme',
                statuts.length > 0 && `${statuts.length} statut${statuts.length > 1 ? 's' : ''}`,
                secteur && `secteur "${secteur}"`,
                hasScoreFilter && `score ${scoreMin}–${scoreMax}`,
                archived && 'archivés',
                begesFilters.includes('obligation') && 'Obligation BEGES',
                begesFilters.includes('missing') && 'BEGES manquant',
                contactTypes.length > 0 &&
                  `contact : ${contactTypes
                    .map((t) => ALL_CONTACT_TYPES.find((c) => c.value === t)?.label ?? t)
                    .join(' / ')}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <button
              type="button"
              onClick={handleReset}
              aria-label="Réinitialiser tous les filtres"
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="11"
                height="11"
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
              Réinitialiser
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      id="prospects-filters-panel"
      className={`rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-sm transition-opacity ${isPending ? 'opacity-60' : ''}`}
      aria-label="Filtres des prospects"
    >
      {/* Sprint 3 retour client #2 — Barre de recherche libre (raison sociale,
          SIREN, email, dirigeant). Submit Enter ou blur → push ?q=...
          Sprint 3 retour client #1 — Bouton repli aligne en haut-droite du
          panneau deplie pour discoverabilite (chevron vers le haut). */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2 sm:px-4">
        <div className="relative flex-1">
          <label htmlFor="filter-search" className="sr-only">
            Rechercher un prospect
          </label>
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
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            id="filter-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onBlur={(e) => commitSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitSearchQuery(searchQuery)
              }
            }}
            placeholder="Rechercher (raison sociale, SIREN, email, dirigeant)"
            maxLength={200}
            className="w-full rounded-full border border-white/[0.08] bg-white/[0.04] backdrop-blur-md py-2 pl-9 pr-9 text-xs text-white placeholder-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('')
                commitSearchQuery('')
              }}
              aria-label="Effacer la recherche"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="11"
                height="11"
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
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={true}
          aria-controls="prospects-filters-panel"
          aria-label="Replier la zone de filtres"
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
        >
          Replier
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
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
      </div>

      {/* ── Bloc statuts — placé AU-DESSUS du ribbon pour visibilité maximale.
          Flex-wrap : toutes les étiquettes restent visibles et cliquables
          sans scroll horizontal (vs. ancienne version qui tronquait à droite). */}
      <fieldset className="border-b border-white/[0.06] p-3 sm:p-4">
        <legend className="mb-2 block font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
          Statut
        </legend>
        <div className="flex flex-wrap items-center gap-1.5">
          {ALL_STATUTS.map(({ value, label, dot }) => {
            const isActive = statuts.includes(value)
            return (
              <button
                key={value}
                type="button"
                onClick={() => toggleStatut(value)}
                aria-pressed={isActive}
                className={`${pillBase} ${isActive ? pillActive : pillInactive}`}
              >
                <span
                  className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dot}`}
                  aria-hidden="true"
                />
                {label}
              </button>
            )
          })}
        </div>
      </fieldset>

      {/* ── Ribbon horizontal — secteur, score, tri, toggles ────────────────
          Mobile : empile en colonnes (flex-col).
          Desktop ≥ sm : 1 ligne via flex-wrap, gap-4 confortable.
      */}
      <div className="flex flex-col gap-3 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 sm:p-4">
        {/* Secteur — input compact */}
        <div className="relative w-full sm:w-48">
          <label htmlFor="filter-secteur" className="sr-only">
            Secteur
          </label>
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
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            id="filter-secteur"
            type="text"
            value={secteur}
            onChange={handleSecteurChange}
            onKeyDown={handleSecteurKeyDown}
            onBlur={() =>
              applyFilters(
                statuts,
                secteur,
                scoreMin,
                scoreMax,
                archived,
                contactTypes,
                begesFilters,
                sort,
              )
            }
            placeholder="Secteur..."
            className="w-full rounded-full border border-white/[0.08] bg-white/[0.04] backdrop-blur-md py-2 pl-8 pr-3 text-xs text-white placeholder-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
          />
        </div>

        {/* Filtre score — range DOUBLE-THUMB [min, max].
            2 inputs range superposés en absolute, track unique en background.
            Affichage en clair "25 — 80" en font-mono. */}
        <div className="flex w-full items-center gap-2 sm:w-64">
          <span className="font-mono text-[10px] uppercase tracking-wider text-gray-400">
            Score
          </span>
          <div className="relative h-5 flex-1">
            {/* Track de fond (0 → 100) */}
            <div
              className="pointer-events-none absolute left-0 top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-white/[0.05]"
              aria-hidden="true"
            />
            {/* Track active (entre min et max) */}
            <div
              className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-green-500 transition-all"
              style={{
                left: `${scoreLeftPct}%`,
                width: `${Math.max(0, scoreRightPct - scoreLeftPct)}%`,
              }}
              aria-hidden="true"
            />
            {/* Double-thumb range : 2 inputs range superposés.
                Pattern critique pour rendre les 2 thumbs cliquables alors
                qu'ils occupent la même zone géométrique :
                  - input lui-même : pointer-events: none (laisse passer les clics)
                  - thumb uniquement : pointer-events: auto (capture le clic)
                Sans ça, l'input supérieur (z-20) bloque l'accès au thumb du
                second input. */}
            <input
              id="filter-score-min"
              type="range"
              min={SCORE_MIN_BOUND}
              max={SCORE_MAX_BOUND}
              step={SCORE_STEP}
              value={scoreMin}
              onChange={handleScoreMinChange}
              aria-label={`Score minimum : ${scoreMin}`}
              className="pointer-events-none absolute inset-0 z-20 h-5 w-full appearance-none bg-transparent opacity-0 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-transparent"
            />
            <input
              id="filter-score-max"
              type="range"
              min={SCORE_MIN_BOUND}
              max={SCORE_MAX_BOUND}
              step={SCORE_STEP}
              value={scoreMax}
              onChange={handleScoreMaxChange}
              aria-label={`Score maximum : ${scoreMax}`}
              className="pointer-events-none absolute inset-0 z-20 h-5 w-full appearance-none bg-transparent opacity-0 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-transparent"
            />
            {/* Bullets visuelles aux positions des thumbs (purement décoratifs). */}
            <span
              className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-green-300 bg-green-500 shadow-sm"
              style={{ left: `${scoreLeftPct}%` }}
              aria-hidden="true"
            />
            <span
              className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-green-300 bg-green-500 shadow-sm"
              style={{ left: `${scoreRightPct}%` }}
              aria-hidden="true"
            />
          </div>
          <span
            className="min-w-[5ch] rounded-md bg-green-500/15 px-2 py-0.5 text-center font-mono text-[11px] font-bold tabular-nums text-green-300 ring-1 ring-green-500/25"
            aria-label={`Plage de score sélectionnée : ${scoreMin} à ${scoreMax}`}
          >
            {scoreMin} — {scoreMax}
          </span>
        </div>

        {/* Tri — pills inline */}
        <fieldset aria-label="Trier les prospects">
          <legend className="sr-only">Trier les prospects</legend>
          <div className="flex items-center gap-1.5">
            {ALL_SORTS.map(({ value, label }) => {
              const isActive = sort === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => selectSort(value)}
                  aria-pressed={isActive}
                  className={`${pillBase} ${isActive ? pillActive : pillInactive}`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </fieldset>

        {/* Toggles compacts (icônes) — Hot / Obligation / Manquant / Archivés */}
        <div className="flex items-center gap-1.5" role="group" aria-label="Filtres rapides BEGES">
          {/* GLN-081 — Filtre rapide Hot leads (obligation + BEGES défaillant
              + email + effectif >= 250). Premier toggle pour visibilité. */}
          <ToggleIconButton
            active={hotOnly}
            onClick={toggleHotOnly}
            label="Hot leads uniquement"
            tone="red"
          >
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
              <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
            </svg>
          </ToggleIconButton>

          {/* GLN-006 — Filtre rapide BEGES non conforme Décret 2022-982.
              Cible commerciale : BEGES publié post-2023 sans scope 3 ou
              sans plan d'action → renouvellement quasi-obligatoire. */}
          <ToggleIconButton
            active={decretNonCompliantOnly}
            onClick={toggleDecretNonCompliantOnly}
            label="BEGES non conforme Décret 2022"
            tone="amber"
          >
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
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </ToggleIconButton>

          <ToggleIconButton
            active={begesFilters.includes('obligation')}
            onClick={() => toggleBegesValue('obligation')}
            label="Obligation BEGES"
            tone="amber"
          >
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
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </ToggleIconButton>

          <ToggleIconButton
            active={begesFilters.includes('missing')}
            onClick={() => toggleBegesValue('missing')}
            label="BEGES manquant"
            tone="red"
          >
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
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </ToggleIconButton>

          <ToggleIconButton
            active={archived}
            onClick={toggleArchived}
            label="Voir les archivés"
            tone="orange"
          >
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
              <polyline points="21 8 21 21 3 21 3 8" />
              <rect x="1" y="3" width="22" height="5" />
              <line x1="10" y1="12" x2="14" y2="12" />
            </svg>
          </ToggleIconButton>

          {/* Bouton "..." — drawer pour filtres rares (canal de contact) */}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-controls="filters-more-panel"
            aria-label="Plus de filtres"
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 ${
              moreOpen || contactTypes.length > 0
                ? 'border-green-500/40 bg-green-500/15 text-green-300 ring-1 ring-green-500/25'
                : 'border-white/10 bg-white/[0.04] text-gray-300 hover:border-white/20 hover:bg-white/[0.08]'
            }`}
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
              <circle cx="5" cy="12" r="1" />
              <circle cx="12" cy="12" r="1" />
              <circle cx="19" cy="12" r="1" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Drawer "Plus de filtres" — collapsible ──────────────────────── */}
      {moreOpen && (
        <div
          id="filters-more-panel"
          className="border-t border-white/[0.06] px-4 py-3"
        >
          <fieldset aria-label="Filtrer par canal de contact disponible">
            <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Contact disponible
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {ALL_CONTACT_TYPES.map(({ value, label }) => {
                const isActive = contactTypes.includes(value)
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleContactType(value)}
                    aria-pressed={isActive}
                    className={`${pillBase} ${isActive ? pillActive : pillInactive}`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </fieldset>
        </div>
      )}

      {/* ── Pied — résumé filtres actifs + Réinitialiser ─────────────────── */}
      {hasFilters && (
        <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2.5">
          <p className="truncate text-[11px] text-gray-400">
            {[
              hotOnly && 'Hot leads',
              decretNonCompliantOnly && 'Décret 2022 non conforme',
              statuts.length > 0 && `${statuts.length} statut${statuts.length > 1 ? 's' : ''}`,
              secteur && `secteur "${secteur}"`,
              hasScoreFilter && `score ${scoreMin}–${scoreMax}`,
              archived && 'archivés',
              begesFilters.includes('obligation') && 'Obligation BEGES',
              begesFilters.includes('missing') && 'BEGES manquant',
              contactTypes.length > 0 &&
                `contact : ${contactTypes
                  .map((t) => ALL_CONTACT_TYPES.find((c) => c.value === t)?.label ?? t)
                  .join(' / ')}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <button
            type="button"
            onClick={handleReset}
            aria-label="Réinitialiser tous les filtres"
            className="ml-2 inline-flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="11"
              height="11"
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
            Réinitialiser
          </button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ToggleIconButton — bouton icône carré 32px avec aria-label.
// On garde le label texte uniquement pour l'a11y (tooltip natif via title +
// aria-label) ; visuellement l'icône suffit pour gagner de la place.
// ─────────────────────────────────────────────────────────────────────────────

interface ToggleIconButtonProps {
  active: boolean
  onClick: () => void
  label: string
  tone: 'amber' | 'red' | 'orange'
  children: React.ReactNode
}

function ToggleIconButton({ active, onClick, label, tone, children }: ToggleIconButtonProps) {
  const toneActive: Record<ToggleIconButtonProps['tone'], string> = {
    amber: 'border-amber-400/40 bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/25',
    red: 'border-red-400/40 bg-red-500/15 text-red-200 ring-1 ring-red-500/25',
    orange: 'border-orange-400/40 bg-orange-500/15 text-orange-200 ring-1 ring-orange-500/25',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 ${
        active
          ? toneActive[tone]
          : 'border-white/10 bg-white/[0.04] text-gray-300 hover:border-white/20 hover:bg-white/[0.08]'
      }`}
    >
      {children}
    </button>
  )
}
