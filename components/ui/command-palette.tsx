'use client'

// ============================================================
// CommandPalette — Spotlight global ⌘K / Ctrl+K
//
// Recherche prospects par raison_sociale (debounce 200ms) +
// actions Alpha (Lancer un run, Voir le statut, Aller au pipeline).
//
// Implémenté avec `cmdk` (headless, sans Radix). Glass overlay + focus trap.
// Auto-ouvre sur ⌘K / Ctrl+K, ferme sur Escape.
// ============================================================

import { Command } from 'cmdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Prospect } from '@/lib/types'

interface CommandPaletteProps {
  /** Si fourni, override l'état contrôlé du palette. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

interface ProspectHit {
  id: string
  raison_sociale: string
  siren: string
  ville?: string
}

const DEBOUNCE_MS = 200

export function CommandPalette({ open: openProp, onOpenChange }: CommandPaletteProps = {}) {
  const router = useRouter()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openProp ?? internalOpen
  const setOpen = (value: boolean) => {
    if (onOpenChange) onOpenChange(value)
    else setInternalOpen(value)
  }

  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ProspectHit[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Raccourci clavier global ⌘K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Recherche debounce sur l'API existante /api/prospects?q=
  useEffect(() => {
    if (!open || search.trim().length < 2) {
      setResults([])
      return
    }
    setIsLoading(true)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/prospects?q=${encodeURIComponent(search)}&limit=8`,
          { signal: controller.signal, credentials: 'same-origin' },
        )
        if (!res.ok) throw new Error('search failed')
        const json = (await res.json()) as { data?: Prospect[] }
        const hits = (json.data ?? []).map((p) => ({
          id: p.id,
          raison_sociale: p.raison_sociale,
          siren: p.siren,
          ville: p.ville,
        }))
        setResults(hits)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setResults([])
        }
      } finally {
        setIsLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(handle)
  }, [search, open])

  const actions = useMemo(
    () => [
      {
        id: 'pipeline',
        label: 'Voir le pipeline',
        shortcut: 'P',
        run: () => router.push('/pipeline'),
      },
      {
        id: 'prospects',
        label: 'Voir tous les prospects',
        shortcut: 'L',
        run: () => router.push('/prospects'),
      },
      {
        id: 'alpha',
        label: 'Statut d\'Alpha',
        shortcut: 'A',
        run: () => router.push('/alpha'),
      },
      {
        id: 'settings',
        label: 'Paramètres',
        shortcut: ',',
        run: () => router.push('/settings'),
      },
    ],
    [router],
  )

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Recherche globale"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[15vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900"
      >
        <Command label="Recherche" shouldFilter={false}>
          <div className="flex items-center gap-2 border-b border-gray-100 px-4 dark:border-gray-800">
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
              className="text-gray-400"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <Command.Input
              autoFocus
              value={search}
              onValueChange={setSearch}
              placeholder="Rechercher un prospect ou une action…"
              className="flex-1 bg-transparent py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-white"
            />
            <kbd className="hidden rounded border border-gray-200 px-1.5 py-0.5 font-mono text-[10px] text-gray-400 dark:border-gray-700 dark:text-gray-500 sm:inline">
              Esc
            </kbd>
          </div>

          <Command.List className="max-h-[60vh] overflow-y-auto py-2">
            {isLoading && (
              <div className="px-4 py-3 text-xs text-gray-400">
                Recherche…
              </div>
            )}

            <Command.Empty className="px-4 py-3 text-xs text-gray-400">
              Aucun résultat. Tapez au moins 2 caractères.
            </Command.Empty>

            {results.length > 0 && (
              <Command.Group heading="Prospects">
                {results.map((hit) => (
                  <Command.Item
                    key={hit.id}
                    value={`${hit.raison_sociale} ${hit.siren}`}
                    onSelect={() => {
                      router.push(`/prospects/${hit.id}`)
                      setOpen(false)
                    }}
                    className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm aria-selected:bg-green-50 aria-selected:text-green-700 dark:aria-selected:bg-green-950/40 dark:aria-selected:text-green-400"
                  >
                    <span className="flex-1">
                      <span className="font-medium text-gray-900 dark:text-white">
                        {hit.raison_sociale}
                      </span>
                      <span className="ml-2 font-mono text-[11px] text-gray-400">
                        {hit.siren}
                      </span>
                      {hit.ville && (
                        <span className="ml-2 text-[11px] text-gray-400">
                          · {hit.ville}
                        </span>
                      )}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group heading="Actions" className="mt-2">
              {actions.map((a) => (
                <Command.Item
                  key={a.id}
                  value={a.label}
                  onSelect={() => {
                    a.run()
                    setOpen(false)
                  }}
                  className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2 text-sm aria-selected:bg-green-50 aria-selected:text-green-700 dark:aria-selected:bg-green-950/40 dark:aria-selected:text-green-400"
                >
                  <span>{a.label}</span>
                  <kbd className="rounded border border-gray-200 px-1.5 py-0.5 font-mono text-[10px] text-gray-400 dark:border-gray-700">
                    {a.shortcut}
                  </kbd>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  )
}
