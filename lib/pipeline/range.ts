// ============================================================
// Pipeline range — helpers purs (Server + Client safe)
// ============================================================
//
// Module *sans* `'use client'` : exportables depuis Server Components.
//
// Anciennement co-localisé avec `<PeriodToggle>` dans `components/pipeline/
// period-toggle.tsx`, ce qui causait un crash SSR Next.js 15 : on ne peut pas
// appeler une fonction définie dans un module `'use client'` depuis un Server
// Component (cf. digest 4022785150 — "Attempted to call parseRange() from
// the server but parseRange is on the client").
//
// Solution : extraire les helpers purs ici. `<PeriodToggle>` reste dans son
// fichier `'use client'` et importe désormais ces helpers depuis ce module.

export type PipelineRange = '7d' | '30d' | '90d' | 'all'

export const PIPELINE_RANGES: readonly PipelineRange[] = ['7d', '30d', '90d', 'all'] as const
export const DEFAULT_RANGE: PipelineRange = '30d'

/**
 * Parse un search param brut vers un `PipelineRange`. Retourne le défaut si la
 * valeur est absente ou hors enum.
 */
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
