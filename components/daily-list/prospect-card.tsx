'use client'

import { useState } from 'react'
import type { CallResult, DailyListItem, Prospect } from '@/lib/types'

// ── Types internes ────────────────────────────────────────────────────────────

interface FeedbackPayload {
  call_result: CallResult
  callback_date?: string
  call_notes?: string
  called_at: string
}

interface ProspectCardProps {
  item: DailyListItem & { prospect: Prospect }
  onFeedbackSubmit: (result: FeedbackPayload) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CALL_RESULTS: { value: CallResult; label: string }[] = [
  { value: 'interested', label: 'Intéressé — RDV à fixer' },
  { value: 'callback', label: 'Rappeler plus tard' },
  { value: 'not_interested', label: 'Pas intéressé' },
  { value: 'wrong_contact', label: 'Mauvais contact' },
  { value: 'no_answer', label: 'Pas de réponse' },
  { value: 'voicemail', label: 'Messagerie vocale' },
]

const CALL_RESULT_BADGE: Record<
  CallResult,
  { label: string; className: string }
> = {
  interested: {
    label: 'Intéressé',
    className: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  },
  callback: {
    label: 'Rappel prévu',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  },
  not_interested: {
    label: 'Pas intéressé',
    className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  },
  wrong_contact: {
    label: 'Mauvais contact',
    className: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400',
  },
  no_answer: {
    label: 'Pas de réponse',
    className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400',
  },
  voicemail: {
    label: 'Messagerie',
    className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400',
  },
}

const PRIORITY_STYLES: Record<string, string> = {
  haute: 'border-l-red-500',
  normale: 'border-l-yellow-500',
  basse: 'border-l-gray-400',
}

const PRIORITY_LABELS: Record<string, string> = {
  haute: 'PRIORITÉ HAUTE',
  normale: 'PRIORITÉ NORMALE',
  basse: 'PRIORITÉ BASSE',
}

// ── Sous-composants ───────────────────────────────────────────────────────────

function ExpandableSection({
  icon,
  title,
  children,
  defaultOpen = false,
}: {
  icon: string
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="rounded-lg border border-gray-100 dark:border-gray-800">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/50"
      >
        <span>
          {icon} {title}
        </span>
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
          className={`flex-shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isOpen && (
        <div className="border-t border-gray-100 px-4 py-3 dark:border-gray-800">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────

export function ProspectCard({ item, onFeedbackSubmit }: ProspectCardProps) {
  const { prospect } = item
  const [selectedResult, setSelectedResult] = useState<CallResult | null>(null)
  const [callbackDate, setCallbackDate] = useState('')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const isDone = Boolean(item.called_at)
  const borderColor = PRIORITY_STYLES[item.priorite] ?? PRIORITY_STYLES.normale

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedResult) return

    setIsSubmitting(true)
    setSubmitError(null)

    const payload: FeedbackPayload = {
      call_result: selectedResult,
      callback_date: callbackDate || undefined,
      call_notes: notes || undefined,
      called_at: new Date().toISOString(),
    }

    try {
      const response = await fetch(`/api/daily-list/${item.id}/feedback`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const data = await response.json() as { error?: string }
        throw new Error(data.error ?? 'Erreur lors de l\'enregistrement')
      }

      onFeedbackSubmit(payload)
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Erreur inconnue'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  // Effectif
  const effectif =
    prospect.effectif_min && prospect.effectif_max
      ? `${prospect.effectif_min}–${prospect.effectif_max} sal.`
      : prospect.effectif_min
        ? `+${prospect.effectif_min} sal.`
        : null

  return (
    <article
      className={`rounded-xl border-l-4 border border-gray-200 bg-white shadow-sm transition-opacity dark:border-gray-800 dark:bg-gray-900 ${borderColor} ${isDone ? 'opacity-60' : ''}`}
      aria-label={`Appel #${item.ordre} — ${prospect.raison_sociale}`}
    >
      {/* ── En-tête ── */}
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Appel #{item.ordre}
            </span>
            <span
              className={`text-xs font-semibold uppercase tracking-wider ${
                item.priorite === 'haute'
                  ? 'text-red-600 dark:text-red-400'
                  : item.priorite === 'normale'
                    ? 'text-yellow-600 dark:text-yellow-400'
                    : 'text-gray-500 dark:text-gray-500'
              }`}
            >
              — {PRIORITY_LABELS[item.priorite]}
            </span>
          </div>

          <h2 className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
            {prospect.raison_sociale}
          </h2>

          <div className="mt-2 flex flex-wrap gap-2">
            {prospect.secteur_libelle && (
              <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                {prospect.secteur_libelle}
              </span>
            )}
            {effectif && (
              <span
                className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                  prospect.obligation_beges
                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                }`}
                title={prospect.obligation_beges ? 'Soumis à l\'obligation BEGES' : undefined}
              >
                {effectif}
                {prospect.obligation_beges ? ' · Obligation BEGES' : ''}
              </span>
            )}
            {prospect.ville && (
              <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                {prospect.ville}
              </span>
            )}
          </div>
        </div>

        {/* Badge résultat si appel effectué */}
        {isDone && item.call_result && (
          <span
            className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium ${CALL_RESULT_BADGE[item.call_result].className}`}
          >
            {CALL_RESULT_BADGE[item.call_result].label}
          </span>
        )}
      </div>

      {/* ── Infos contact ── */}
      <div className="border-t border-gray-100 px-5 py-4 dark:border-gray-800">
        <div className="flex flex-wrap gap-4">
          {(prospect.contact_nom || prospect.contact_prenom) && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Contact
              </p>
              <p className="mt-0.5 text-sm font-medium text-gray-900 dark:text-white">
                {[prospect.contact_prenom, prospect.contact_nom].filter(Boolean).join(' ')}
                {prospect.contact_poste ? ` — ${prospect.contact_poste}` : ''}
              </p>
            </div>
          )}

          {prospect.contact_telephone && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Téléphone
              </p>
              <a
                href={`tel:${prospect.contact_telephone.replace(/\s/g, '')}`}
                className="mt-0.5 inline-flex items-center gap-1 text-sm font-semibold text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                aria-label={`Appeler ${prospect.contact_telephone}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.5 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 5.27 5.27l1.17-1.17a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.28 15l.64 1.92z" />
                </svg>
                {prospect.contact_telephone}
              </a>
            </div>
          )}

          {item.meilleur_creneau && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Meilleur créneau
              </p>
              <p className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">
                {item.meilleur_creneau}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Sections expandables ── */}
      <div className="space-y-2 px-5 pb-4">
        {/* Accroche */}
        {item.accroche && (
          <ExpandableSection icon="🎯" title="Accroche" defaultOpen={!isDone}>
            <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              {item.accroche}
            </p>
          </ExpandableSection>
        )}

        {/* Pitch */}
        {item.pitch && (
          <ExpandableSection icon="💬" title="Pitch">
            <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              {item.pitch}
            </p>
          </ExpandableSection>
        )}

        {/* Signaux */}
        {item.signaux_detectes.length > 0 && (
          <ExpandableSection icon="⚡" title="Signaux détectés">
            <ul className="space-y-2" aria-label="Signaux d'intention détectés">
              {item.signaux_detectes.map((signal, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="mt-0.5 flex-shrink-0 text-green-500" aria-hidden="true">•</span>
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {signal.description}
                    {signal.date && (
                      <span className="ml-1 text-xs text-gray-400">({signal.date})</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </ExpandableSection>
        )}

        {/* Objections */}
        {item.objections_reponses.length > 0 && (
          <ExpandableSection icon="🛡️" title="Objections & réponses">
            <div className="space-y-3">
              {item.objections_reponses.map((or, idx) => (
                <div key={idx} className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                  <p className="text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">
                    Objection
                  </p>
                  <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                    {or.objection}
                  </p>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-green-600 dark:text-green-400">
                    Réponse
                  </p>
                  <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                    {or.reponse}
                  </p>
                </div>
              ))}
            </div>
          </ExpandableSection>
        )}
      </div>

      {/* ── Formulaire de résultat ── */}
      {!isDone && (
        <div className="border-t border-gray-100 px-5 py-5 dark:border-gray-800">
          <p className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
            📋 Résultat de l&apos;appel
          </p>
          <form onSubmit={handleSubmit} noValidate>
            <fieldset>
              <legend className="sr-only">Sélectionnez le résultat de l&apos;appel</legend>
              <div className="space-y-2">
                {CALL_RESULTS.map(({ value, label }) => (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors ${
                      selectedResult === value
                        ? 'border-green-500 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950/40 dark:text-green-400'
                        : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`call_result_${item.id}`}
                      value={value}
                      checked={selectedResult === value}
                      onChange={() => setSelectedResult(value)}
                      className="h-4 w-4 accent-green-600"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Date de rappel si callback sélectionné */}
            {selectedResult === 'callback' && (
              <div className="mt-3">
                <label
                  htmlFor={`callback_date_${item.id}`}
                  className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
                >
                  Date de rappel
                </label>
                <input
                  id={`callback_date_${item.id}`}
                  type="date"
                  value={callbackDate}
                  onChange={(e) => setCallbackDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
            )}

            {/* Notes */}
            <div className="mt-3">
              <label
                htmlFor={`notes_${item.id}`}
                className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
              >
                Notes (optionnel)
              </label>
              <textarea
                id={`notes_${item.id}`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes sur l'appel..."
                rows={2}
                className="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-600"
              />
            </div>

            {submitError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
                {submitError}
              </p>
            )}

            <button
              type="submit"
              disabled={!selectedResult || isSubmitting}
              aria-label="Valider le résultat de l'appel"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-gray-900"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Enregistrement...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Valider le résultat
                </>
              )}
            </button>
          </form>
        </div>
      )}

      {/* Notes enregistrées si appel effectué */}
      {isDone && item.call_notes && (
        <div className="border-t border-gray-100 px-5 py-4 dark:border-gray-800">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Notes
          </p>
          <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
            {item.call_notes}
          </p>
        </div>
      )}
    </article>
  )
}
