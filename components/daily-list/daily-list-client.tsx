'use client'

import { useState } from 'react'
import type { DailyListItem, Prospect } from '@/lib/types'
import { ProspectCard } from './prospect-card'

interface DailyListClientProps {
  initialItems: (DailyListItem & { prospect: Prospect })[]
}

export function DailyListClient({ initialItems }: DailyListClientProps) {
  const [items, setItems] = useState(initialItems)

  function handleFeedbackSubmit(
    itemId: string,
    result: Partial<Pick<DailyListItem, 'call_result' | 'callback_date' | 'call_notes' | 'called_at'>>
  ) {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, ...result } : item
      )
    )
  }

  // Statistiques en temps réel
  const totalItems = items.length
  const calledItems = items.filter((item) => Boolean(item.called_at))
  const calledCount = calledItems.length
  const remainingCount = totalItems - calledCount
  const progressPercent = totalItems > 0 ? Math.round((calledCount / totalItems) * 100) : 0

  const interestedCount = calledItems.filter((i) => i.call_result === 'interested').length
  const callbackCount = calledItems.filter((i) => i.call_result === 'callback').length

  // Séparation appels effectués / à faire
  const pendingItems = items.filter((item) => !item.called_at)
  const doneItems = items.filter((item) => Boolean(item.called_at))

  if (totalItems === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 px-8 py-16 text-center dark:border-gray-800">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-gray-400 dark:text-gray-600"
            aria-hidden="true"
          >
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </div>
        <h3 className="mt-4 text-base font-semibold text-gray-900 dark:text-white">
          Aucun appel pour aujourd&apos;hui
        </h3>
        <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
          Votre liste d&apos;appels sera générée par l&apos;agent IA.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6" aria-label="Liste des appels du jour">
      {/* Stats du jour */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Progression du jour
            </h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {calledCount} appel{calledCount > 1 ? 's' : ''} effectué{calledCount > 1 ? 's' : ''} sur {totalItems}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-sm font-bold tabular-nums ${
              progressPercent === 100
                ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400'
                : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            {progressPercent}%
          </span>
        </div>

        {/* Barre de progression */}
        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <div
            className="h-2 rounded-full bg-green-500 transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
            aria-label={`${progressPercent}% des appels effectués`}
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>

        {/* Indicateurs rapides */}
        <div className="flex flex-wrap gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
            <span className="text-gray-500 dark:text-gray-400">
              <span className="font-semibold text-gray-700 dark:text-gray-200">{remainingCount}</span> restant{remainingCount > 1 ? 's' : ''}
            </span>
          </div>
          {interestedCount > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
              <span className="text-gray-500 dark:text-gray-400">
                <span className="font-semibold text-green-600 dark:text-green-400">{interestedCount}</span> intéressé{interestedCount > 1 ? 's' : ''}
              </span>
            </div>
          )}
          {callbackCount > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-blue-500" aria-hidden="true" />
              <span className="text-gray-500 dark:text-gray-400">
                <span className="font-semibold text-blue-600 dark:text-blue-400">{callbackCount}</span> rappel{callbackCount > 1 ? 's' : ''} prévu{callbackCount > 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Appels à faire */}
      {pendingItems.length > 0 && (
        <section aria-label="Appels à effectuer">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              À appeler ({pendingItems.length})
            </h3>
          </div>
          <div className="space-y-4">
            {pendingItems.map((item) => (
              <ProspectCard
                key={item.id}
                item={item}
                onFeedbackSubmit={(result) => handleFeedbackSubmit(item.id, result)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Séparateur si les deux sections sont présentes */}
      {pendingItems.length > 0 && doneItems.length > 0 && (
        <div className="relative flex items-center gap-3 py-2">
          <div className="h-px flex-1 bg-gray-100 dark:bg-gray-800" aria-hidden="true" />
          <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500">
            Appels effectués
          </span>
          <div className="h-px flex-1 bg-gray-100 dark:bg-gray-800" aria-hidden="true" />
        </div>
      )}

      {/* Appels effectués */}
      {doneItems.length > 0 && (
        <section aria-label="Appels effectués">
          {pendingItems.length === 0 && (
            <div className="mb-3 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-gray-400" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                Effectués ({doneItems.length})
              </h3>
            </div>
          )}
          <div className="space-y-4">
            {doneItems.map((item) => (
              <ProspectCard
                key={item.id}
                item={item}
                onFeedbackSubmit={(result) => handleFeedbackSubmit(item.id, result)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Message de félicitations si tout est fait */}
      {progressPercent === 100 && (
        <div className="flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 px-5 py-4 dark:border-green-800/50 dark:bg-green-950/30">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/50">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-green-600 dark:text-green-400"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-green-800 dark:text-green-300">
              Tous les appels sont effectués !
            </p>
            <p className="text-xs text-green-600 dark:text-green-500">
              Excellent travail. {interestedCount > 0 ? `${interestedCount} prospect${interestedCount > 1 ? 's' : ''} intéressé${interestedCount > 1 ? 's' : ''}` : 'Continuez demain.'
              }
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
