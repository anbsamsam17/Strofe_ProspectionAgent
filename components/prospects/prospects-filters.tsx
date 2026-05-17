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
  currentArchived: boolean
  currentContactTypes?: ContactFilterType[]
  currentBegesFilters?: BegesFilterValue[]
  currentSort?: SortValue
}

// TODO(Agent A): `offer_sent` à ajouter à `ProspectStatus` (`lib/types.ts`).
// En attendant la migration, on l'expose ici en union locale pour rester
// compatible avec les futurs prospects sans casser le typage de `lib/types.ts`.
type StatusFilterValue = ProspectStatus | 'offer_sent'

// Labels alignés sur la colonne Statut du tableau (`app/(dashboard)/prospects/page.tsx`).
// `rdv` est legacy — fusionné visuellement avec « Intéressé ». On garde la valeur
// dans le pipeline tant que des lignes existantes en base ne sont pas migrées.
const ALL_STATUTS: { value: StatusFilterValue; label: string; dot: string }[] = [
  { value: 'sourced', label: 'Pas de contact identifié', dot: 'bg-gray-400' },
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

const ALL_SORTS: { value: SortValue; label: string }[] = [
  { value: 'score_desc', label: 'Score ↓' },
  { value: 'score_asc', label: 'Score ↑' },
  { value: 'created_desc', label: 'Récent' },
  { value: 'created_asc', label: 'Ancien' },
]

const DEFAULT_SORT: SortValue = 'score_desc'

export function ProspectsFilters({
  currentStatuts,
  currentSecteur,
  currentScoreMin,
  currentArchived,
  currentContactTypes = [],
  currentBegesFilters = [],
  currentSort = DEFAULT_SORT,
}: ProspectsFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [statuts, setStatuts] = useState<string[]>(currentStatuts)
  const [secteur, setSecteur] = useState(currentSecteur)
  const [scoreMin, setScoreMin] = useState(currentScoreMin)
  const [archived, setArchived] = useState<boolean>(currentArchived)
  const [contactTypes, setContactTypes] = useState<ContactFilterType[]>(currentContactTypes)
  const [begesFilters, setBegesFilters] = useState<BegesFilterValue[]>(currentBegesFilters)
  const [sort, setSort] = useState<SortValue>(currentSort)
  const [moreOpen, setMoreOpen] = useState<boolean>(false)

  function applyFilters(
    newStatuts: string[],
    newSecteur: string,
    newScoreMin: number,
    newArchived: boolean,
    newContactTypes: ContactFilterType[],
    newBegesFilters: BegesFilterValue[],
    newSort: SortValue,
  ) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', '1')

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

    if (newScoreMin > 0) {
      params.set('score_min', String(newScoreMin))
    } else {
      params.delete('score_min')
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
    applyFilters(next, secteur, scoreMin, archived, contactTypes, begesFilters, sort)
  }

  function toggleContactType(value: ContactFilterType) {
    const next = contactTypes.includes(value)
      ? contactTypes.filter((t) => t !== value)
      : [...contactTypes, value]
    setContactTypes(next)
    applyFilters(statuts, secteur, scoreMin, archived, next, begesFilters, sort)
  }

  function toggleBegesValue(value: BegesFilterValue) {
    const next: BegesFilterValue[] = begesFilters.includes(value)
      ? begesFilters.filter((b) => b !== value)
      : [...begesFilters, value]
    setBegesFilters(next)
    applyFilters(statuts, secteur, scoreMin, archived, contactTypes, next, sort)
  }

  function handleSecteurChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSecteur(e.target.value)
  }

  function handleSecteurKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      applyFilters(statuts, secteur, scoreMin, archived, contactTypes, begesFilters, sort)
    }
  }

  function handleScoreChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseInt(e.target.value, 10)
    setScoreMin(val)
    applyFilters(statuts, secteur, val, archived, contactTypes, begesFilters, sort)
  }

  function toggleArchived() {
    const next = !archived
    setArchived(next)
    applyFilters(statuts, secteur, scoreMin, next, contactTypes, begesFilters, sort)
  }

  function selectSort(value: SortValue) {
    if (value === sort) return
    setSort(value)
    applyFilters(statuts, secteur, scoreMin, archived, contactTypes, begesFilters, value)
  }

  function handleReset() {
    setStatuts([])
    setSecteur('')
    setScoreMin(0)
    setArchived(false)
    setContactTypes([])
    setBegesFilters([])
    setSort(DEFAULT_SORT)
    startTransition(() => {
      router.push(pathname)
    })
  }

  const hasFilters =
    statuts.length > 0 ||
    secteur ||
    scoreMin > 0 ||
    archived ||
    contactTypes.length > 0 ||
    begesFilters.length > 0
  const scorePercent = scoreMin

  // Classes utilitaires partagées entre pills (statut, contact, tri).
  const pillBase =
    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-[oklch(11%_0.022_250)]'
  const pillInactive =
    'border-white/10 bg-white/[0.04] backdrop-blur-md text-gray-300 hover:border-white/20 hover:bg-white/[0.08]'
  const pillActive =
    'border-green-500/40 bg-green-500/15 text-green-300 ring-1 ring-green-500/25'

  return (
    <div
      className={`rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-sm transition-opacity ${isPending ? 'opacity-60' : ''}`}
      aria-label="Filtres des prospects"
    >
      {/* ── Ribbon horizontal compact ───────────────────────────────────────
          Mobile : empile en colonnes (flex-col).
          Desktop ≥ sm : tout sur une seule ligne grâce à flex-wrap.
      */}
      <div className="flex flex-col gap-2 p-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:p-3">
        {/* Pills statut — scroll horizontal si dépassement.
            Le fieldset+legend porte déjà la sémantique group ; on évite le
            double role="group" sur le div interne (sinon Testing Library
            trouve 2 éléments matching le même nom). */}
        <fieldset className="min-w-0 flex-1">
          <legend className="sr-only">Filtrer par statut</legend>
          <div className="-mx-0.5 flex items-center gap-1.5 overflow-x-auto px-0.5 [scrollbar-width:thin]">
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

        {/* Secteur — input compact */}
        <div className="relative w-full sm:w-48">
          <label htmlFor="filter-secteur" className="sr-only">
            Secteur
          </label>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="13"
            height="13"
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
              applyFilters(statuts, secteur, scoreMin, archived, contactTypes, begesFilters, sort)
            }
            placeholder="Secteur..."
            className="w-full rounded-full border border-white/[0.08] bg-white/[0.04] backdrop-blur-md py-1.5 pl-7 pr-2.5 text-xs text-white placeholder-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
          />
        </div>

        {/* Score minimum — slider + badge value */}
        <div className="flex w-full items-center gap-2 sm:w-48">
          <label
            htmlFor="filter-score"
            className="font-mono text-[10px] uppercase tracking-wider text-gray-400"
          >
            Score
          </label>
          <div className="relative flex-1">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]"
              aria-hidden="true"
            >
              <div
                className="h-1.5 rounded-full bg-green-500 transition-all"
                style={{ width: `${scorePercent}%` }}
              />
            </div>
            <input
              id="filter-score"
              type="range"
              min={0}
              max={100}
              step={5}
              value={scoreMin}
              onChange={handleScoreChange}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
              aria-label={`Score minimum : ${scoreMin}`}
            />
          </div>
          <span className="min-w-[2ch] rounded-md bg-green-500/15 px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums text-green-300 ring-1 ring-green-500/25">
            {scoreMin}
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

        {/* Toggles compacts (icônes) — Obligation / Manquant / Archivés */}
        <div className="flex items-center gap-1.5" role="group" aria-label="Filtres rapides BEGES">
          <ToggleIconButton
            active={begesFilters.includes('obligation')}
            onClick={() => toggleBegesValue('obligation')}
            label="Obligation BEGES"
            tone="amber"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
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
              width="13"
              height="13"
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
              width="13"
              height="13"
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
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 ${
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
          className="border-t border-white/[0.06] px-3 py-2.5"
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
        <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-2">
          <p className="truncate text-[11px] text-gray-400">
            {[
              statuts.length > 0 && `${statuts.length} statut${statuts.length > 1 ? 's' : ''}`,
              secteur && `secteur "${secteur}"`,
              scoreMin > 0 && `score ≥ ${scoreMin}`,
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
// ToggleIconButton — bouton icône carré 28px avec aria-label.
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
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 ${
        active
          ? toneActive[tone]
          : 'border-white/10 bg-white/[0.04] text-gray-300 hover:border-white/20 hover:bg-white/[0.08]'
      }`}
    >
      {children}
    </button>
  )
}
