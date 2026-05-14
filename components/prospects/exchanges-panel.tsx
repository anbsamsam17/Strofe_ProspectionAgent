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

const TYPE_LABELS: Record<ExchangeType, { label: string; className: string }> = {
  appel: {
    label: 'Appel',
    className: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400',
  },
  email: {
    label: 'Email',
    className: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  },
  linkedin: {
    label: 'LinkedIn',
    className: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400',
  },
  rdv: {
    label: 'RDV',
    className: 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400',
  },
  autre: {
    label: 'Autre',
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
}

const CALL_RESULT_LABELS: Record<CallResult, { label: string; className: string }> = {
  interested: {
    label: 'Intéressé',
    className: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400',
  },
  callback: {
    label: 'Rappel demandé',
    className: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  },
  not_interested: {
    label: 'Pas intéressé',
    className: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
  },
  wrong_contact: {
    label: 'Mauvais contact',
    className: 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400',
  },
  no_answer: {
    label: 'Pas de réponse',
    className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  },
  voicemail: {
    label: 'Répondeur',
    className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  },
  email_sent: {
    label: 'Email envoyé',
    className: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  },
  no_contact_point: {
    label: 'Pas de point de contact',
    className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
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
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
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
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-6 py-4 dark:border-gray-800">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Historique des échanges{timeline.length > 0 ? ` (${timeline.length})` : ''}
        </h2>
        <NewExchangeDialog prospectId={prospectId} />
      </div>
      <div className="px-6 py-5">
        {timeline.length > 0 ? (
          <ul
            className="divide-y divide-gray-100 dark:divide-gray-800"
            aria-label="Historique des échanges avec ce prospect"
          >
            {timeline.map((item) => {
              const typeMeta = TYPE_LABELS[item.type] ?? TYPE_LABELS.autre
              const resultMeta = resultLabel(item)
              return (
                <li key={item.key} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
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
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
                        Rappel le {formatShortDate(item.callback_date)}
                      </span>
                    )}
                  </div>
                  {item.notes && (
                    <p className="mt-2 whitespace-pre-line text-sm text-gray-700 dark:text-gray-300">
                      {item.notes}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-600">
            Aucun échange enregistré pour ce prospect.
          </p>
        )}
      </div>
    </div>
  )
}
