'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  NAF_CODES_SEARCH,
  NAF_GROUPS_SUGGESTED,
  SUGGESTED_NAF_CODES,
  normalizeSearchString,
  type NafCodeSearchEntry,
} from '@/lib/constants/naf-codes'

// Tableau partagé pour la valeur par défaut de `availableCodes` :
// référence stable entre rendus pour éviter les `useMemo` invalidés à chaque
// render quand le caller ne passe pas la prop.
const EMPTY_RESTRICT: readonly string[] = []

// ── Constantes ────────────────────────────────────────────────────────────────

/**
 * Plafond d'items affichés simultanément dans la liste virtualisée naïve.
 * En dessous de cette borne, la perf React est largement suffisante pour
 * ~700 entrées triées + filtrées sans recourir à une lib externe.
 */
const MAX_VISIBLE_ITEMS = 50

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NafCodeMultiSelectProps {
  /** Codes NAF actuellement sélectionnés (format `XX.XXX`). */
  selectedCodes: string[]
  /** Callback appelé avec la liste mise à jour. */
  onChange: (codes: string[]) => void
  /** Désactive entièrement le composant (run en cours, etc.). */
  disabled?: boolean
  /** Affiche ou non la section "Suggérés (prospection B2B BEGES)". */
  showSuggestedGroups?: boolean
  /** Id du label décrivant le champ (a11y). */
  labelledBy?: string
  /**
   * Sous-ensemble de codes NAF utilisable comme univers de recherche.
   * Si fourni (non vide), la listbox + la recherche + le compteur ne
   * portent QUE sur ces codes (les autres restent invisibles mais peuvent
   * exister dans `selectedCodes` et seront affichés en chips).
   * Utilisé par la modal de sourcing pour restreindre aux ~110 codes
   * BEGES prioritaires (sections A/C/D/E/F/H).
   */
  availableCodes?: readonly string[]
  /** Placeholder de la barre de recherche (par défaut : exemple générique). */
  searchPlaceholder?: string
}

// ── Composant ─────────────────────────────────────────────────────────────────

/**
 * Multi-select de codes NAF avec :
 *   - groupes pré-définis "Suggérés (prospection B2B BEGES)" cochables en un clic.
 *   - barre de recherche normalisée (casse + accents ignorés).
 *   - liste virtualisée naïve (filter + slice MAX_VISIBLE_ITEMS).
 *   - chips compactes pour les codes sélectionnés (avec retrait individuel).
 *   - navigation clavier ↑↓ Enter Esc.
 *
 * Aucune dépendance externe (Tailwind brut + headless behavior).
 */
export function NafCodeMultiSelect({
  selectedCodes,
  onChange,
  disabled = false,
  showSuggestedGroups = true,
  labelledBy,
  availableCodes = EMPTY_RESTRICT,
  searchPlaceholder = 'Rechercher par code (ex. 01.21) ou libellé (ex. viticulture)...',
}: NafCodeMultiSelectProps) {
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState<number>(-1)
  const listboxId = useId()
  const listboxRef = useRef<HTMLUListElement>(null)

  const selectedSet = useMemo(() => new Set(selectedCodes), [selectedCodes])

  // Univers de codes consultables : NAF_CODES_SEARCH par défaut, restreint
  // sinon. On garde l'ordre canonique de NAF_CODES_SEARCH pour avoir des
  // résultats triés et stables.
  const universe = useMemo<readonly NafCodeSearchEntry[]>(() => {
    if (availableCodes.length === 0) return NAF_CODES_SEARCH
    const allow = new Set(availableCodes)
    return NAF_CODES_SEARCH.filter((e) => allow.has(e.code))
  }, [availableCodes])

  // ── Filtre + limite ────────────────────────────────────────────────────────
  const filtered = useMemo<readonly NafCodeSearchEntry[]>(() => {
    const trimmed = search.trim()
    if (!trimmed) return universe.slice(0, MAX_VISIBLE_ITEMS)

    const needle = normalizeSearchString(trimmed)
    const out: NafCodeSearchEntry[] = []
    for (const entry of universe) {
      if (entry._haystack.includes(needle)) {
        out.push(entry)
        if (out.length >= MAX_VISIBLE_ITEMS) break
      }
    }
    return out
  }, [search, universe])

  const totalMatching = useMemo(() => {
    const trimmed = search.trim()
    if (!trimmed) return universe.length
    const needle = normalizeSearchString(trimmed)
    let n = 0
    for (const entry of universe) {
      if (entry._haystack.includes(needle)) n++
    }
    return n
  }, [search, universe])

  // Reset de l'index actif quand le filtre change pour éviter d'être
  // hors-bornes après une recherche qui rétrécit la liste.
  useEffect(() => {
    setActiveIndex(filtered.length > 0 ? 0 : -1)
  }, [filtered.length])

  // ── Helpers de mutation ────────────────────────────────────────────────────
  const toggleCode = useCallback(
    (code: string) => {
      if (disabled) return
      if (selectedSet.has(code)) {
        onChange(selectedCodes.filter((c) => c !== code))
      } else {
        onChange([...selectedCodes, code])
      }
    },
    [disabled, selectedSet, selectedCodes, onChange],
  )

  const removeCode = useCallback(
    (code: string) => {
      if (disabled) return
      onChange(selectedCodes.filter((c) => c !== code))
    },
    [disabled, selectedCodes, onChange],
  )

  const selectAllSuggested = useCallback(() => {
    if (disabled) return
    const next = new Set(selectedCodes)
    for (const c of SUGGESTED_NAF_CODES) next.add(c)
    onChange(Array.from(next))
  }, [disabled, selectedCodes, onChange])

  const deselectAllSuggested = useCallback(() => {
    if (disabled) return
    onChange(selectedCodes.filter((c) => !SUGGESTED_NAF_CODES.has(c)))
  }, [disabled, selectedCodes, onChange])

  const toggleGroup = useCallback(
    (groupCodes: readonly string[]) => {
      if (disabled) return
      const allSelected = groupCodes.every((c) => selectedSet.has(c))
      if (allSelected) {
        const groupSet = new Set(groupCodes)
        onChange(selectedCodes.filter((c) => !groupSet.has(c)))
      } else {
        const next = new Set(selectedCodes)
        for (const c of groupCodes) next.add(c)
        onChange(Array.from(next))
      }
    },
    [disabled, selectedSet, selectedCodes, onChange],
  )

  // ── Clavier ────────────────────────────────────────────────────────────────
  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled || filtered.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => (i + 1) % filtered.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const target = filtered[activeIndex]
        if (target) toggleCode(target.code)
      } else if (e.key === 'Escape') {
        if (search.length > 0) {
          e.preventDefault()
          setSearch('')
        }
      }
    },
    [disabled, filtered, activeIndex, search, toggleCode],
  )

  // Scroll synchronisé pour garder l'élément actif visible.
  useEffect(() => {
    if (activeIndex < 0 || !listboxRef.current) return
    const node = listboxRef.current.querySelector<HTMLLIElement>(
      `[data-index="${activeIndex}"]`,
    )
    node?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const selectedCount = selectedCodes.length
  const hasOverflow = filtered.length < totalMatching

  // ── Rendu ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4" aria-labelledby={labelledBy}>
      {/* ── Groupes suggérés ────────────────────────────────────────── */}
      {showSuggestedGroups && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-300">
              Suggérés (prospection B2B BEGES)
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectAllSuggested}
                disabled={disabled}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-2.5 py-1 text-xs font-medium text-gray-200 transition-colors duration-150 hover:border-green-400/40 hover:bg-green-500/10 hover:text-green-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Tout sélectionner
              </button>
              <button
                type="button"
                onClick={deselectAllSuggested}
                disabled={disabled}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-2.5 py-1 text-xs font-medium text-gray-200 transition-colors duration-150 hover:border-white/20 hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-green-500/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Désélectionner tout
              </button>
            </div>
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {NAF_GROUPS_SUGGESTED.map((group) => {
              const allSelected = group.codes.every((c) => selectedSet.has(c))
              const someSelected =
                !allSelected && group.codes.some((c) => selectedSet.has(c))
              return (
                <li key={group.label}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.codes)}
                    disabled={disabled}
                    aria-pressed={allSelected}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-green-500/30 disabled:cursor-not-allowed disabled:opacity-50 ${
                      allSelected
                        ? 'border-green-500/40 bg-green-500/[0.18] text-green-300 ring-1 ring-green-500/30 hover:bg-green-500/[0.25]'
                        : someSelected
                          ? 'border-green-500/30 bg-green-500/[0.08] text-green-300 hover:bg-green-500/[0.14]'
                          : 'border-white/10 bg-white/[0.04] backdrop-blur-md text-gray-200 hover:border-white/20 hover:bg-white/[0.06]'
                    }`}
                  >
                    {allSelected && (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    {group.label}
                    <span className="tabular-nums text-[10px] opacity-70">
                      ({group.codes.length})
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* ── Barre de recherche ─────────────────────────────────────── */}
      <div>
        <label htmlFor={`${listboxId}-search`} className="sr-only">
          Rechercher un code ou un libellé NAF
        </label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-gray-400"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            id={`${listboxId}-search`}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKeyDown}
            disabled={disabled}
            placeholder={searchPlaceholder}
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined
            }
            className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md py-2.5 pl-11 pr-10 text-sm text-white placeholder-gray-400 transition-colors duration-150 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          />
          {search.length > 0 && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Effacer la recherche"
              className="absolute inset-y-0 right-2 flex items-center rounded-md p-1 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-green-500/30"
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
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          {totalMatching === 0
            ? 'Aucun code ne correspond à votre recherche.'
            : hasOverflow
              ? `${filtered.length} affichés sur ${totalMatching.toLocaleString('fr-FR')} — affinez la recherche pour voir les autres.`
              : `${totalMatching.toLocaleString('fr-FR')} code${totalMatching > 1 ? 's' : ''} disponible${totalMatching > 1 ? 's' : ''}.`}
        </p>
      </div>

      {/* ── Listbox ─────────────────────────────────────────────────── */}
      <ul
        ref={listboxRef}
        id={listboxId}
        role="listbox"
        aria-multiselectable="true"
        aria-label="Codes NAF disponibles"
        className="max-h-72 overflow-y-auto rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md dark:border-gray-700 dark:bg-gray-900"
      >
        {filtered.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-gray-400">
            Aucun résultat.
          </li>
        )}
        {filtered.map((entry, index) => {
          const isSelected = selectedSet.has(entry.code)
          const isActive = index === activeIndex
          return (
            <li
              key={entry.code}
              id={`${listboxId}-opt-${index}`}
              data-index={index}
              role="option"
              aria-selected={isSelected}
              onClick={() => toggleCode(entry.code)}
              onMouseEnter={() => setActiveIndex(index)}
              className={`flex cursor-pointer items-start gap-3 border-b border-white/[0.06] px-3 py-2 text-sm transition-colors duration-150 last:border-b-0 ${
                isActive
                  ? 'bg-green-500/[0.14]'
                  : isSelected
                    ? 'bg-green-500/[0.08]'
                    : 'hover:bg-white/[0.06]'
              }`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-2 transition-colors duration-150 ${
                  isSelected
                    ? 'border-green-600 bg-green-600'
                    : 'border-white/20 bg-white/[0.04] backdrop-blur-md'
                }`}
                aria-hidden="true"
              >
                {isSelected && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium leading-snug text-white">
                  <span className="font-mono tabular-nums text-gray-200">
                    {entry.code}
                  </span>
                  <span className="mx-1.5 text-gray-400">—</span>
                  {entry.libelle}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {entry.section} · {entry.section_libelle}
                </p>
              </div>
            </li>
          )
        })}
      </ul>

      {/* ── Chips sélectionnés ──────────────────────────────────────── */}
      {selectedCount > 0 && (
        <div>
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-300">
              Sélectionnés ({selectedCount})
            </p>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={disabled}
              className="text-xs font-medium text-gray-400 underline-offset-2 transition-colors hover:text-red-400 hover:underline focus:outline-none focus:ring-2 focus:ring-red-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Vider la sélection
            </button>
          </div>
          <ul className="flex flex-wrap gap-2" aria-label="Codes NAF sélectionnés">
            {selectedCodes.map((code) => (
              <li key={code}>
                <span className="inline-flex items-center gap-1 rounded-full bg-green-500/[0.15] px-2.5 py-1 text-xs font-medium text-green-300 ring-1 ring-green-500/30">
                  <span className="font-mono tabular-nums">{code}</span>
                  <button
                    type="button"
                    onClick={() => removeCode(code)}
                    disabled={disabled}
                    aria-label={`Retirer le code ${code}`}
                    className="rounded-full p-0.5 text-green-400 transition-colors hover:bg-green-500/[0.25] hover:text-green-200 focus:outline-none focus:ring-2 focus:ring-green-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
