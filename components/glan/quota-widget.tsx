'use client'

// ============================================================
// QuotaWidget — état des quotas API d'enrichissement (mois courant)
//
// Client Component (état d'animation au hover sur les rows, pas de fetch
// interne — les quotas sont fournis par le parent SC qui les lit depuis
// `/api/glan/quotas` ou directement depuis la DB).
//
// Affiche 4 providers (Pappers, Hunter, INPI, Google CSE) sous forme de
// rows avec barre de progression. Alerte visuelle si :
//   - used / limit > 0.8 → ring jaune + warning
//   - exhausted          → ring rouge + dot pulsant + texte "Épuisé"
// ============================================================

import type { JSX } from 'react'

export type QuotaProvider = 'pappers' | 'hunter' | 'inpi' | 'google_cse'

export interface QuotaState {
  provider: QuotaProvider
  used: number
  remaining: number
  limit: number
  exhausted: boolean
}

interface QuotaWidgetProps {
  quotas: QuotaState[]
  className?: string
}

interface ProviderMeta {
  label: string
  /** Classe Tailwind du fill de la barre. */
  fillClass: string
  /** Limite considérée comme illimitée (affiche "illim." côté reste). */
  unlimitedHint?: boolean
}

const PROVIDER_META: Record<QuotaProvider, ProviderMeta> = {
  pappers: { label: 'Pappers', fillClass: 'bg-amber-400' },
  hunter: { label: 'Hunter', fillClass: 'bg-violet-400' },
  // INPI : pas de quota officiel (illimité en pratique sous fair-use).
  inpi: { label: 'INPI', fillClass: 'bg-cyan-400', unlimitedHint: true },
  google_cse: { label: 'Google CSE', fillClass: 'bg-blue-400' },
}

const WARNING_THRESHOLD = 0.8

function clampRatio(used: number, limit: number): number {
  if (limit <= 0) return 0
  const r = used / limit
  if (r < 0) return 0
  if (r > 1) return 1
  return r
}

function formatRemaining(q: QuotaState, isUnlimited: boolean): string {
  if (q.exhausted) return 'Épuisé'
  if (isUnlimited) return 'illim.'
  return `${q.remaining} rest.`
}

interface RowProps {
  quota: QuotaState
  meta: ProviderMeta
}

function QuotaRow({ quota, meta }: RowProps): JSX.Element {
  const ratio = clampRatio(quota.used, quota.limit)
  const isUnlimited = meta.unlimitedHint === true
  const isWarning = !quota.exhausted && !isUnlimited && ratio > WARNING_THRESHOLD
  const isExhausted = quota.exhausted

  // Anneau d'alerte porté par le row entier (visible discrètement, plus marqué
  // en cas d'alerte). Compose toujours après le ring de base translucide.
  const ringClass = isExhausted
    ? 'ring-red-500/60'
    : isWarning
      ? 'ring-yellow-500/60'
      : 'ring-white/[0.06]'

  const remainingClass = isExhausted
    ? 'text-red-300'
    : isWarning
      ? 'text-yellow-300'
      : 'text-gray-400'

  return (
    <li
      data-provider={quota.provider}
      data-state={isExhausted ? 'exhausted' : isWarning ? 'warning' : 'ok'}
      className={`group flex items-center gap-3 rounded-lg px-3 py-2 ring-1 transition-colors hover:bg-white/[0.04] ${ringClass}`}
    >
      {/* Label + état */}
      <div className="flex w-28 flex-shrink-0 items-center gap-1.5">
        <span className="truncate text-sm font-medium text-white">
          {meta.label}
        </span>
        {isExhausted && (
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.8)]"
          />
        )}
        {isWarning && (
          <span aria-hidden="true" className="text-xs leading-none">
            ⚠️
          </span>
        )}
      </div>

      {/* Barre de progression */}
      <div className="flex-1 min-w-0">
        <div
          role="progressbar"
          aria-valuenow={quota.used}
          aria-valuemin={0}
          aria-valuemax={quota.limit}
          aria-label={`Quota ${meta.label} : ${quota.used} sur ${quota.limit} utilisés, ${quota.remaining} restant${quota.remaining > 1 ? 's' : ''}${isExhausted ? ' — épuisé' : ''}`}
          className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ease-out ${meta.fillClass}`}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      </div>

      {/* Compteur used/limit */}
      <div className="flex w-28 flex-shrink-0 items-baseline justify-end gap-2 font-mono text-[11px] tabular-nums">
        <span className="text-gray-200">
          {quota.used}/{quota.limit}
        </span>
        <span className={`min-w-[3.5rem] text-right ${remainingClass}`}>
          {formatRemaining(quota, isUnlimited)}
        </span>
      </div>
    </li>
  )
}

export function QuotaWidget({
  quotas,
  className = '',
}: QuotaWidgetProps): JSX.Element {
  return (
    <section
      aria-label="Quotas API d'enrichissement — mois en cours"
      className={`relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 backdrop-blur-md ${className}`.trim()}
    >
      {/* Accent border-top gradient brand */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-green-400/60 to-transparent"
      />

      {/* Header mono cyan */}
      <header className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
        <span aria-hidden="true">{'//'}</span>
        <span>Quotas API · mois en cours</span>
      </header>

      <ul className="flex flex-col gap-1.5">
        {quotas.map((q) => {
          const meta = PROVIDER_META[q.provider]
          return <QuotaRow key={q.provider} quota={q} meta={meta} />
        })}
      </ul>

      <footer className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/60">
        Reset le 1er du mois
      </footer>
    </section>
  )
}
