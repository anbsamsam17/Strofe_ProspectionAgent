'use client'

import { useCallback } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

// Helpers purs déplacés dans `@/lib/pipeline/range` pour pouvoir être appelés
// depuis Server Components (crash Next.js 15 si une fonction d'un module
// 'use client' est appelée côté serveur — digest 4022785150).
// Re-export pour rétrocompat des callers historiques (tests, autres composants
// qui importaient depuis ce fichier).
export {
  parseRange,
  rangeStartISO,
  PIPELINE_RANGES,
  DEFAULT_RANGE,
  type PipelineRange,
} from '@/lib/pipeline/range'
import type { PipelineRange } from '@/lib/pipeline/range'
import { PIPELINE_RANGES, DEFAULT_RANGE } from '@/lib/pipeline/range'

const RANGE_LABELS: Record<PipelineRange, string> = {
  '7d': '7 jours',
  '30d': '30 jours',
  '90d': '90 jours',
  all: 'Tout',
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
      className="inline-flex items-center rounded-lg border border-white/[0.08] bg-white/[0.03] backdrop-blur-md p-0.5 shadow-sm dark:border-gray-700 dark:bg-gray-900"
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
                : 'rounded-md px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2'
            }
          >
            {RANGE_LABELS[range]}
          </button>
        )
      })}
    </div>
  )
}
