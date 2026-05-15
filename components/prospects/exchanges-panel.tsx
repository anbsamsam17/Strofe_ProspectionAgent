import type { CallResult } from '@/lib/types'
import { NewExchangeDialog } from './new-exchange-dialog'

// ── Types locaux ──────────────────────────────────────────────────────────────

/**
 * Type d'échange manuel (table prospect_exchanges, migration 012).
 * TODO(coord-A): déplacer dans lib/types.ts une fois Agent A à jour.
 */
export type ExchangeType = 'appel' | 'email' | 'linkedin' | 'rdv' | 'autre'

export interface ProspectExchange {
  id: string
  user_id: string
  prospect_id: string
  occurred_at: string
  type: ExchangeType
  result: string | null
  notes: string | null
  callback_date: string | null
  created_at: string
  updated_at: string
}

// Item daily_list_items réduit pour fusion chronologique.
interface CallHistoryItem {
  id: string
  called_at: string
  call_result: CallResult | null
  call_notes: string | null
  callback_date: string | null
}

// Item normalisé pour l'affichage unifié (exchange OU appel).
interface TimelineItem {
  key: string
  occurred_at: string
  type: ExchangeType
  result: string | null
  notes: string | null
  callback_date: string | null
  // Origin pour info légère (l'UI ne distingue pas, mais utile pour débug).
  source: 'exchange' | 'call'
}

// ── Constantes ────────────────────────────────────────────────────────────────

// Icônes par type d'échange — utilisées dans l'avatar rond à gauche de chaque
// entrée timeline. Tailwind sur le SVG (size + couleur héritée du parent).
function TypeIcon({ type }: { type: ExchangeType }) {
  switch (type) {
    case 'appel':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.5 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 5.27 5.27l1.17-1.17a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.28 15l.64 1.92z" />
        </svg>
      )
    case 'email':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      )
    case 'linkedin':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
      )
    case 'rdv':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      )
    case 'autre':
    default:
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      )
  }
}

// Dark-forced theme : variantes translucides (glass) — pas de bg-{c}-50/100.
const TYPE_LABELS: Record<ExchangeType, { label: string; className: string }> = {
  appel: {
    label: 'Appel',
    className: 'bg-green-500/15 text-green-200 ring-1 ring-green-500/25',
  },
  email: {
    label: 'Email',
    className: 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/25',
  },
  linkedin: {
    label: 'LinkedIn',
    className: 'bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/25',
  },
  rdv: {
    label: 'RDV',
    className: 'bg-purple-500/15 text-purple-200 ring-1 ring-purple-500/25',
  },
  autre: {
    label: 'Autre',
    className: 'bg-white/[0.06] text-gray-200 ring-1 ring-white/[0.08]',
  },
}

const CALL_RESULT_LABELS: Record<CallResult, { label: string; className: string }> = {
  interested: {
    label: 'Intéressé',
    className: 'bg-green-500/15 text-green-200 ring-1 ring-green-500/25',
  },
  callback: {
    label: 'Rappel demandé',
    className: 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/25',
  },
  not_interested: {
    label: 'Pas intéressé',
    className: 'bg-red-500/15 text-red-200 ring-1 ring-red-500/25',
  },
  wrong_contact: {
    label: 'Mauvais contact',
    className: 'bg-orange-500/15 text-orange-200 ring-1 ring-orange-500/25',
  },
  no_answer: {
    label: 'Pas de réponse',
    className: 'bg-white/[0.06] text-gray-300 ring-1 ring-white/[0.08]',
  },
  voicemail: {
    label: 'Répondeur',
    className: 'bg-white/[0.06] text-gray-300 ring-1 ring-white/[0.08]',
  },
  email_sent: {
    label: 'Email envoyé',
    className: 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/25',
  },
  no_contact_point: {
    label: 'Pas de point de contact',
    className: 'bg-white/[0.06] text-gray-300 ring-1 ring-white/[0.08]',
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(new Date(dateStr))
  } catch {
    return dateStr
  }
}

function formatShortDate(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(dateStr))
  } catch {
    return dateStr
  }
}

function resultLabel(item: TimelineItem): { label: string; className: string } | null {
  if (!item.result) return null
  // Si le `result` matche un CallResult connu, on utilise les couleurs canoniques.
  const known = (CALL_RESULT_LABELS as Record<string, { label: string; className: string }>)[item.result]
  if (known) return known
  return {
    label: item.result,
    className: 'bg-white/[0.06] text-gray-200 ring-1 ring-white/[0.08]',
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface ExchangesPanelProps {
  prospectId: string
  exchanges: ProspectExchange[]
  calls: CallHistoryItem[]
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function ExchangesPanel({ prospectId, exchanges, calls }: ExchangesPanelProps) {
  // Fusion + tri DESC par occurrence.
  const timeline: TimelineItem[] = [
    ...exchanges.map<TimelineItem>((ex) => ({
      key: `ex-${ex.id}`,
      occurred_at: ex.occurred_at,
      type: ex.type,
      result: ex.result,
      notes: ex.notes,
      callback_date: ex.callback_date,
      source: 'exchange',
    })),
    ...calls.map<TimelineItem>((c) => ({
      key: `call-${c.id}`,
      occurred_at: c.called_at,
      type: 'appel',
      result: c.call_result,
      notes: c.call_notes,
      callback_date: c.callback_date,
      source: 'call',
    })),
  ].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-6 py-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-400/80">
          Historique des échanges{timeline.length > 0 ? ` (${timeline.length})` : ''}
        </h2>
        <NewExchangeDialog prospectId={prospectId} />
      </div>
      <div className="px-6 py-5">
        {timeline.length > 0 ? (
          <ul
            className="divide-y divide-white/[0.06]"
            aria-label="Historique des échanges avec ce prospect"
          >
            {timeline.map((item) => {
              const typeMeta = TYPE_LABELS[item.type] ?? TYPE_LABELS.autre
              const resultMeta = resultLabel(item)
              return (
                <li key={item.key} className="flex gap-3 py-4 first:pt-0 last:pb-0">
                  {/* Avatar rond — icône type de l'échange. flex-shrink-0
                      pour ne pas se faire écraser si la ligne de meta wrap. */}
                  <div
                    className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${typeMeta.className}`}
                    aria-hidden="true"
                  >
                    <TypeIcon type={item.type} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="text-sm font-semibold text-white">
                        {formatDate(item.occurred_at)}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${typeMeta.className}`}
                      >
                        {typeMeta.label}
                      </span>
                      {resultMeta && (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${resultMeta.className}`}
                        >
                          {resultMeta.label}
                        </span>
                      )}
                      {item.callback_date && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-medium text-blue-200 ring-1 ring-blue-500/25">
                          Rappel le {formatShortDate(item.callback_date)}
                        </span>
                      )}
                    </div>
                    {item.notes && (
                      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-200">
                        {item.notes}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-400">
            Aucun échange enregistré pour ce prospect.
          </p>
        )}
      </div>
    </div>
  )
}
