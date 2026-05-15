// ============================================================
// Timeline — composant vertical générique
//
// Sert d'ossature pour les pages "détail prospect" (échanges) ou tout
// historique chronologique. Reprend la structure d'GlanTimeline mais
// avec des items génériques (titre + description + date + tone).
// ============================================================

import type { ReactNode } from 'react'

export type TimelineTone = 'default' | 'success' | 'warning' | 'danger' | 'info'

export interface TimelineItem {
  id: string
  title: string
  description?: string
  date: string
  tone?: TimelineTone
  icon?: ReactNode
  meta?: ReactNode
}

interface TimelineProps {
  items: TimelineItem[]
  className?: string
}

const TONE_DOT: Record<TimelineTone, string> = {
  default: 'bg-gray-400 ring-white/10',
  success: 'bg-green-500 ring-green-500/30',
  warning: 'bg-amber-500 ring-amber-500/30',
  danger: 'bg-red-500 ring-red-500/30',
  info: 'bg-blue-500 ring-blue-500/30',
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

export function Timeline({ items, className = '' }: TimelineProps) {
  if (items.length === 0) {
    return (
      <p className="text-sm italic text-gray-400 dark:text-gray-400">
        Aucun échange enregistré.
      </p>
    )
  }

  return (
    <ol className={`relative space-y-5 ${className}`}>
      <span
        aria-hidden="true"
        className="absolute left-[7px] top-2 bottom-2 w-px bg-white/[0.08] dark:bg-gray-800"
      />
      {items.map((item) => {
        const tone = item.tone ?? 'default'
        return (
          <li key={item.id} className="relative flex gap-3 pl-1">
            <span
              aria-hidden="true"
              className={`mt-1 inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full ring-4 ${TONE_DOT[tone]}`}
            >
              {item.icon}
            </span>
            <div className="flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {item.title}
                </p>
                <span className="font-mono text-[11px] text-gray-400 tabular-nums dark:text-gray-400">
                  {formatDate(item.date)}
                </span>
              </div>
              {item.description && (
                <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  {item.description}
                </p>
              )}
              {item.meta && <div className="mt-1.5 text-xs">{item.meta}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
