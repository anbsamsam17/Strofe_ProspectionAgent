'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { ProspectStatus } from '@/lib/types'

export type ContactFilterType = 'phone' | 'email' | 'linkedin'

interface ProspectsFiltersProps {
  currentStatuts: string[]
  currentSecteur: string
  currentScoreMin: number
  currentArchived: boolean
  currentContactTypes?: ContactFilterType[]
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
]

const ALL_CONTACT_TYPES: { value: ContactFilterType; label: string }[] = [
  { value: 'phone', label: 'Téléphone' },
  { value: 'email', label: 'Email' },
  { value: 'linkedin', label: 'LinkedIn' },
]

export function ProspectsFilters({
  currentStatuts,
  currentSecteur,
  currentScoreMin,
  currentArchived,
  currentContactTypes = [],
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

  function applyFilters(
    newStatuts: string[],
    newSecteur: string,
    newScoreMin: number,
    newArchived: boolean,
    newContactTypes: ContactFilterType[],
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

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  function toggleStatut(value: string) {
    const next = statuts.includes(value)
      ? statuts.filter((s) => s !== value)
      : [...statuts, value]
    setStatuts(next)
    applyFilters(next, secteur, scoreMin, archived, contactTypes)
  }

  function toggleContactType(value: ContactFilterType) {
    const next = contactTypes.includes(value)
      ? contactTypes.filter((t) => t !== value)
      : [...contactTypes, value]
    setContactTypes(next)
    applyFilters(statuts, secteur, scoreMin, archived, next)
  }

  function handleSecteurChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSecteur(e.target.value)
  }

  function handleSecteurKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      applyFilters(statuts, secteur, scoreMin, archived, contactTypes)
    }
  }

  function handleScoreChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseInt(e.target.value, 10)
    setScoreMin(val)
    applyFilters(statuts, secteur, val, archived, contactTypes)
  }

  function toggleArchived() {
    const next = !archived
    setArchived(next)
    applyFilters(statuts, secteur, scoreMin, next, contactTypes)
  }

  function handleReset() {
    setStatuts([])
    setSecteur('')
    setScoreMin(0)
    setArchived(false)
    setContactTypes([])
    startTransition(() => {
      router.push(pathname)
    })
  }

  const hasFilters =
    statuts.length > 0 ||
    secteur ||
    scoreMin > 0 ||
    archived ||
    contactTypes.length > 0
  const scorePercent = scoreMin

  return (
    <div
      className={`rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 transition-opacity ${isPending ? 'opacity-60' : ''}`}
      aria-label="Filtres des prospects"
    >
      {/* Barre de filtres principale */}
      <div className="flex flex-wrap items-start gap-4 p-4 sm:p-5">
        {/* Statuts — pills */}
        <div className="min-w-0 flex-1">
          <fieldset>
            <legend className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Statut
            </legend>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrer par statut">
              {ALL_STATUTS.map(({ value, label, dot }) => {
                const isActive = statuts.includes(value)
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleStatut(value)}
                    aria-pressed={isActive}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all duration-150 ${
                      isActive
                        ? 'border-green-500 bg-green-50 text-green-700 shadow-sm dark:border-green-600 dark:bg-green-950/50 dark:text-green-400'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800/50'
                    }`}
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
        </div>

        {/* Séparateur vertical — masqué sur mobile */}
        <div className="hidden h-auto w-px self-stretch bg-gray-100 dark:bg-gray-800 sm:block" aria-hidden="true" />

        {/* Colonne droite : recherche + score + filtres complémentaires */}
        <div className="flex flex-col gap-3 sm:w-64">
          {/* Recherche secteur */}
          <div>
            <label
              htmlFor="filter-secteur"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500"
            >
              Secteur
            </label>
            <div className="relative">
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
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500"
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
                onBlur={() => applyFilters(statuts, secteur, scoreMin, archived, contactTypes)}
                placeholder="ex : Transport..."
                className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-600"
              />
              {isPending && (
                <svg
                  className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-green-500"
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
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              )}
            </div>
          </div>

          {/* Score minimum */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="filter-score"
                className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500"
              >
                Score min.
              </label>
              <span className="rounded-md bg-green-50 px-2 py-0.5 text-xs font-bold text-green-700 dark:bg-green-950 dark:text-green-400">
                {scoreMin}
              </span>
            </div>
            {/* Track visuel du slider */}
            <div className="relative h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800">
              <div
                className="absolute left-0 top-0 h-2 rounded-full bg-green-500 transition-all"
                style={{ width: `${scorePercent}%` }}
                aria-hidden="true"
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
              className="mt-1 w-full accent-green-600"
              aria-label={`Score minimum : ${scoreMin}`}
            />
            <div className="flex justify-between text-xs text-gray-400 dark:text-gray-600">
              <span>0</span>
              <span>100</span>
            </div>
          </div>

          {/* Type de contact disponible */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Contact dispo
            </legend>
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label="Filtrer par canal de contact disponible"
            >
              {ALL_CONTACT_TYPES.map(({ value, label }) => {
                const isActive = contactTypes.includes(value)
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleContactType(value)}
                    aria-pressed={isActive}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all duration-150 ${
                      isActive
                        ? 'border-green-500 bg-green-50 text-green-700 shadow-sm dark:border-green-600 dark:bg-green-950/50 dark:text-green-400'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800/50'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </fieldset>

          {/* Toggle archivés — masqués par défaut, accessibles via filtre */}
          <div>
            <button
              type="button"
              onClick={toggleArchived}
              aria-pressed={archived}
              className={`inline-flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                archived
                  ? 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-400'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800/50'
              }`}
            >
              <span className="inline-flex items-center gap-2">
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
                Voir les archivés
              </span>
              <span
                className={`relative inline-block h-4 w-7 rounded-full transition-colors ${
                  archived ? 'bg-orange-500' : 'bg-gray-300 dark:bg-gray-700'
                }`}
                aria-hidden="true"
              >
                <span
                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                    archived ? 'translate-x-3.5' : 'translate-x-0.5'
                  }`}
                />
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Pied de barre — actions */}
      {hasFilters && (
        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2.5 dark:border-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {[
              statuts.length > 0 && `${statuts.length} statut${statuts.length > 1 ? 's' : ''}`,
              secteur && `secteur "${secteur}"`,
              scoreMin > 0 && `score ≥ ${scoreMin}`,
              archived && 'archivés',
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
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
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
            Réinitialiser
          </button>
        </div>
      )}
    </div>
  )
}
