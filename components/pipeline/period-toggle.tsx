'use client'

import { useCallback } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

export type PipelineRange = '7d' | '30d' | '90d' | 'all'

export const PIPELINE_RANGES: readonly PipelineRange[] = ['7d', '30d', '90d', 'all'] as const
export const DEFAULT_RANGE: PipelineRange = '30d'

const RANGE_LABELS: Record<PipelineRange, string> = {
  '7d': '7 jours',
  '30d': '30 jours',
  '90d': '90 jours',
  all: 'Tout',
}

// ── Helpers exportés (réutilisés par page.tsx + tests) ────────────────────────

export function parseRange(raw: string | string[] | undefined): PipelineRange {
  if (typeof raw !== 'string') return DEFAULT_RANGE
  const found = PIPELINE_RANGES.find((r) => r === raw)
  return found ?? DEFAULT_RANGE
}

/** Date ISO du début de fenêtre, ou null si `all`. */
export function rangeStartISO(range: PipelineRange, now: Date = new Date()): string | null {
  if (range === 'all') return null
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return d.toISOString()
}

// ── Composant ─────────────────────────────────────────────────────────────────

interface PeriodToggleProps {
  current: PipelineRange
}

export function PeriodToggle({ current }: PeriodToggleProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const handleSelect = useCallback(
    (range: PipelineRange) => {
      if (range === current) return
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      if (range === DEFAULT_RANGE) {
        params.delete('range')
      } else {
        params.set('range', range)
      }
      const qs = params.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname)
    },
    [current, pathname, router, searchParams],
  )

  return (
    <div
      role="group"
      aria-label="Filtrer la période d'analyse"
      className="inline-flex items-center rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm dark:border-gray-700 dark:bg-gray-900"
    >
      {PIPELINE_RANGES.map((range) => {
        const active = range === current
        return (
          <button
            key={range}
            type="button"
            onClick={() => handleSelect(range)}
            aria-pressed={active}
            className={
              active
                ? 'rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900'
                : 'rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white dark:focus-visible:ring-offset-gray-900'
            }
          >
            {RANGE_LABELS[range]}
          </button>
        )
      })}
    </div>
  )
}
