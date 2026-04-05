'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { ProspectStatus } from '@/lib/types'

interface ProspectsFiltersProps {
  currentStatuts: string[]
  currentSecteur: string
  currentScoreMin: number
}

const ALL_STATUTS: { value: ProspectStatus; label: string }[] = [
  { value: 'sourced', label: 'Sourcé' },
  { value: 'qualified', label: 'Qualifié' },
  { value: 'contacted', label: 'Contacté' },
  { value: 'interested', label: 'Intéressé' },
  { value: 'rdv', label: 'RDV' },
  { value: 'converted', label: 'Converti' },
  { value: 'rejected', label: 'Rejeté' },
  { value: 'on_hold', label: 'En pause' },
]

export function ProspectsFilters({
  currentStatuts,
  currentSecteur,
  currentScoreMin,
}: ProspectsFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [statuts, setStatuts] = useState<string[]>(currentStatuts)
  const [secteur, setSecteur] = useState(currentSecteur)
  const [scoreMin, setScoreMin] = useState(currentScoreMin)

  function applyFilters(
    newStatuts: string[],
    newSecteur: string,
    newScoreMin: number
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

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  function toggleStatut(value: string) {
    const next = statuts.includes(value)
      ? statuts.filter((s) => s !== value)
      : [...statuts, value]
    setStatuts(next)
    applyFilters(next, secteur, scoreMin)
  }

  function handleSecteurChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSecteur(e.target.value)
  }

  function handleSecteurKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      applyFilters(statuts, secteur, scoreMin)
    }
  }

  function handleScoreChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseInt(e.target.value, 10)
    setScoreMin(val)
    applyFilters(statuts, secteur, val)
  }

  function handleReset() {
    setStatuts([])
    setSecteur('')
    setScoreMin(0)
    startTransition(() => {
      router.push(pathname)
    })
  }

  const hasFilters = statuts.length > 0 || secteur || scoreMin > 0

  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 ${isPending ? 'opacity-60' : ''}`}
      aria-label="Filtres des prospects"
    >
      <div className="flex flex-wrap gap-6">
        {/* Statuts */}
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Statut
          </legend>
          <div className="flex flex-wrap gap-2">
            {ALL_STATUTS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => toggleStatut(value)}
                aria-pressed={statuts.includes(value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  statuts.includes(value)
                    ? 'bg-green-600 text-white dark:bg-green-700'
                    : 'border border-gray-200 text-gray-600 hover:border-green-400 hover:text-green-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-green-600 dark:hover:text-green-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Secteur */}
        <div className="min-w-[180px]">
          <label
            htmlFor="filter-secteur"
            className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
          >
            Secteur
          </label>
          <input
            id="filter-secteur"
            type="text"
            value={secteur}
            onChange={handleSecteurChange}
            onKeyDown={handleSecteurKeyDown}
            onBlur={() => applyFilters(statuts, secteur, scoreMin)}
            placeholder="ex: Transport..."
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-600"
          />
        </div>

        {/* Score minimum */}
        <div className="min-w-[160px]">
          <label
            htmlFor="filter-score"
            className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
          >
            Score minimum : <span className="font-bold text-green-600">{scoreMin}</span>
          </label>
          <input
            id="filter-score"
            type="range"
            min={0}
            max={100}
            step={5}
            value={scoreMin}
            onChange={handleScoreChange}
            className="w-full accent-green-600"
            aria-label={`Score minimum : ${scoreMin}`}
          />
          <div className="flex justify-between text-xs text-gray-400 dark:text-gray-600">
            <span>0</span>
            <span>100</span>
          </div>
        </div>

        {/* Bouton reset */}
        {hasFilters && (
          <div className="flex items-end">
            <button
              type="button"
              onClick={handleReset}
              aria-label="Réinitialiser tous les filtres"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Réinitialiser
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
