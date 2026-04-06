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

const CALL_RESULTS: { value: CallResult; label: string; icon: string }[] = [
  { value: 'interested', label: 'Intéressé — RDV à fixer', icon: 'M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
  { value: 'callback', label: 'Rappeler plus tard', icon: 'M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
  { value: 'not_interested', label: 'Pas intéressé', icon: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
  { value: 'wrong_contact', label: 'Mauvais contact', icon: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 14a7 7 0 0 0-7 7h14a7 7 0 0 0-7-7z' },
  { value: 'no_answer', label: 'Pas de réponse', icon: 'M20.354 15.354A9 9 0 0 1 8.646 3.646 9.003 9.003 0 0 0 12 21a9.003 9.003 0 0 0 8.354-5.646z' },
  { value: 'voicemail', label: 'Messagerie vocale', icon: 'M19 11a7 7 0 0 1-7 7m0 0a7 7 0 0 1-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 0 1-3-3V5a3 3 0 0 1 6 0v6a3 3 0 0 1-3 3z' },
]

const CALL_RESULT_BADGE: Record<CallResult, { label: string; className: string; dot: string }> = {
  interested: {
    label: 'Intéressé',
    className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-400 dark:border-green-800',
    dot: 'bg-green-500',
  },
  callback: {
    label: 'Rappel prévu',
    className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-800',
    dot: 'bg-blue-500',
  },
  not_interested: {
    label: 'Pas intéressé',
    className: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
    dot: 'bg-gray-400',
  },
  wrong_contact: {
    label: 'Mauvais contact',
    className: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-400 dark:border-orange-800',
    dot: 'bg-orange-500',
  },
  no_answer: {
    label: 'Pas de réponse',
    className: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/50 dark:text-yellow-400 dark:border-yellow-800',
    dot: 'bg-yellow-500',
  },
  voicemail: {
    label: 'Messagerie',
    className: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/50 dark:text-yellow-400 dark:border-yellow-800',
    dot: 'bg-yellow-400',
  },
}

const PRIORITY_CONFIG: Record<string, { borderColor: string; badgeClass: string; label: string }> = {
  haute: {
    borderColor: 'border-l-red-500',
    badgeClass: 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800',
    label: 'Haute',
  },
  normale: {
    borderColor: 'border-l-yellow-500',
    badgeClass: 'bg-yellow-50 text-yellow-700 border border-yellow-200 dark:bg-yellow-950/50 dark:text-yellow-400 dark:border-yellow-800',
    label: 'Normale',
  },
  basse: {
    borderColor: 'border-l-gray-300',
    badgeClass: 'bg-gray-100 text-gray-500 border border-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:border-gray-700',
    label: 'Basse',
  },
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
    <div className="overflow-hidden rounded-xl border border-gray-100 dark:border-gray-800">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/40"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <span aria-hidden="true">{icon}</span>
          {title}
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
          className={`flex-shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isOpen && (
        <div className="border-t border-gray-100 px-4 py-3.5 dark:border-gray-800">
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
  const priorityConfig = PRIORITY_CONFIG[item.priorite] ?? PRIORITY_CONFIG.normale

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
        throw new Error(data.error ?? "Erreur lors de l'enregistrement")
      }

      onFeedbackSubmit(payload)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erreur inconnue')
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

  const resultBadge = isDone && item.call_result ? CALL_RESULT_BADGE[item.call_result] : null

  return (
    <article
      className={`overflow-hidden rounded-2xl border border-l-4 border-gray-200 bg-white shadow-sm transition-all dark:border-gray-800 dark:bg-gray-900 ${priorityConfig.borderColor} ${isDone ? 'opacity-65' : ''}`}
      aria-label={`Appel #${item.ordre} — ${prospect.raison_sociale}`}
    >
      {/* ── En-tête ── */}
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div className="min-w-0 flex-1">
          {/* Numéro + priorité */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center justify-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              #{item.ordre}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${priorityConfig.badgeClass}`}
            >
              {item.priorite === 'haute' && (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
                </svg>
              )}
              Priorité {priorityConfig.label}
            </span>
          </div>

          {/* Nom entreprise */}
          <h2 className="mt-2 text-lg font-bold leading-tight text-gray-900 dark:text-white">
            {prospect.raison_sociale}
          </h2>

          {/* Tags */}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {prospect.secteur_libelle && (
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                {prospect.secteur_libelle}
              </span>
            )}
            {effectif && (
              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  prospect.obligation_beges
                    ? 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-400'
                    : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'
                }`}
                title={prospect.obligation_beges ? "Soumis à l'obligation BEGES" : undefined}
              >
                {effectif}
                {prospect.obligation_beges ? ' · BEGES' : ''}
              </span>
            )}
            {prospect.ville && (
              <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                  <circle cx="12" cy="9" r="2.5" />
                </svg>
                {prospect.ville}
              </span>
            )}
          </div>
        </div>

        {/* Badge résultat appel effectué */}
        {resultBadge && (
          <span
            className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${resultBadge.className}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${resultBadge.dot}`} aria-hidden="true" />
            {resultBadge.label}
          </span>
        )}
      </div>

      {/* ── Infos contact ── */}
      {(prospect.contact_nom || prospect.contact_prenom || prospect.contact_telephone || prospect.contact_email || item.meilleur_creneau) && (
        <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-4 dark:border-gray-800 dark:bg-gray-800/20">
          <div className="flex flex-wrap gap-5">
            {(prospect.contact_nom || prospect.contact_prenom) && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  Contact
                </p>
                <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
                  {[prospect.contact_prenom, prospect.contact_nom].filter(Boolean).join(' ')}
                  {prospect.contact_poste ? (
                    <span className="ml-1 text-gray-500 dark:text-gray-400">
                      — {prospect.contact_poste}
                    </span>
                  ) : null}
                </p>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Téléphone
              </p>
              {prospect.contact_telephone ? (
                <a
                  href={`tel:${prospect.contact_telephone.replace(/\s/g, '')}`}
                  className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-green-600 transition-colors hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                  aria-label={`Appeler le ${prospect.contact_telephone}`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.5 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 5.27 5.27l1.17-1.17a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.28 15l.64 1.92z" />
                  </svg>
                  {prospect.contact_telephone}
                </a>
              ) : (
                <p className="mt-1 text-sm text-gray-400 dark:text-gray-600">Non renseigné</p>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Email
              </p>
              {prospect.contact_email ? (
                <a
                  href={`mailto:${prospect.contact_email}`}
                  className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-green-600 transition-colors hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                  aria-label={`Envoyer un email à ${prospect.contact_email}`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                  {prospect.contact_email}
                </a>
              ) : (
                <p className="mt-1 text-sm text-gray-400 dark:text-gray-600">Non renseigné</p>
              )}
            </div>

            {item.meilleur_creneau && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  Meilleur créneau
                </p>
                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                  {item.meilleur_creneau}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Statut BEGES ── */}
      <div className="border-t border-gray-100 bg-gray-50/40 px-5 py-3.5 dark:border-gray-800 dark:bg-gray-800/10">
        <div className="flex flex-wrap items-center gap-2">
          {/* Badge état BEGES */}
          {prospect.beges_publie && prospect.beges_valide ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700 dark:border-green-800 dark:bg-green-950/50 dark:text-green-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              BEGES publié
            </span>
          ) : prospect.beges_publie && !prospect.beges_valide ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-700 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              BEGES expiré
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              BEGES absent
            </span>
          )}

          {/* Badge obligation BEGES */}
          {prospect.obligation_beges && (
            <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-400">
              Obligation BEGES
            </span>
          )}

          {/* Date de dernière publication */}
          {prospect.beges_derniere_publication && (
            <span className="text-xs text-gray-400 dark:text-gray-600">
              Dernière publication : {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' }).format(new Date(prospect.beges_derniere_publication))}
            </span>
          )}

          {/* Lien vers le BEGES */}
          {prospect.beges_url && (
            <a
              href={prospect.beges_url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Voir le BEGES sur bilans-ges.ademe.fr (ouvre dans un nouvel onglet)"
              className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-green-600 transition-colors hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
            >
              Voir le BEGES
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          )}
        </div>
      </div>

      {/* ── Sections expandables ── */}
      <div className="space-y-2 px-5 py-4">
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
          <ExpandableSection icon="⚡" title={`Signaux détectés (${item.signaux_detectes.length})`}>
            <ul className="space-y-2.5" aria-label="Signaux d'intention détectés">
              {item.signaux_detectes.map((signal, idx) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-500"
                    aria-hidden="true"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {signal.description}
                    {signal.date && (
                      <span className="ml-1.5 text-xs text-gray-400">({signal.date})</span>
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
                <div key={idx} className="overflow-hidden rounded-lg border border-gray-100 dark:border-gray-800">
                  <div className="border-b border-gray-100 bg-red-50/60 px-3 py-2.5 dark:border-gray-800 dark:bg-red-950/20">
                    <p className="mb-0.5 text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">
                      Objection
                    </p>
                    <p className="text-sm text-gray-700 dark:text-gray-300">{or.objection}</p>
                  </div>
                  <div className="bg-green-50/60 px-3 py-2.5 dark:bg-green-950/10">
                    <p className="mb-0.5 text-xs font-semibold uppercase tracking-wider text-green-600 dark:text-green-400">
                      Réponse
                    </p>
                    <p className="text-sm text-gray-700 dark:text-gray-300">{or.reponse}</p>
                  </div>
                </div>
              ))}
            </div>
          </ExpandableSection>
        )}
      </div>

      {/* ── Formulaire de résultat ── */}
      {!isDone && (
        <div className="border-t border-gray-100 px-5 py-5 dark:border-gray-800">
          <p className="mb-3.5 text-sm font-semibold text-gray-700 dark:text-gray-300">
            Résultat de l&apos;appel
          </p>
          <form onSubmit={handleSubmit} noValidate>
            <fieldset>
              <legend className="sr-only">Sélectionnez le résultat de l&apos;appel</legend>

              {/* Toggle buttons modernes */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {CALL_RESULTS.map(({ value, label, icon }) => {
                  const isSelected = selectedResult === value
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setSelectedResult(value)}
                      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition-all duration-150 ${
                        isSelected
                          ? 'border-green-500 bg-green-50 text-green-700 shadow-sm dark:border-green-600 dark:bg-green-950/50 dark:text-green-300'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800/50'
                      }`}
                    >
                      {/* Indicateur sélection */}
                      <span
                        className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                          isSelected
                            ? 'border-green-500 bg-green-500'
                            : 'border-gray-300 dark:border-gray-600'
                        }`}
                        aria-hidden="true"
                      >
                        {isSelected && (
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        )}
                      </span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`flex-shrink-0 ${isSelected ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}
                        aria-hidden="true"
                      >
                        <path d={icon} />
                      </svg>
                      <span className="leading-tight">{label}</span>
                    </button>
                  )
                })}
              </div>
            </fieldset>

            {/* Date de rappel si callback sélectionné */}
            {selectedResult === 'callback' && (
              <div className="mt-4">
                <label
                  htmlFor={`callback_date_${item.id}`}
                  className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400"
                >
                  Date de rappel
                </label>
                <input
                  id={`callback_date_${item.id}`}
                  type="date"
                  value={callbackDate}
                  onChange={(e) => setCallbackDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
            )}

            {/* Notes */}
            <div className="mt-4">
              <label
                htmlFor={`notes_${item.id}`}
                className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400"
              >
                Notes <span className="font-normal text-gray-400">(optionnel)</span>
              </label>
              <textarea
                id={`notes_${item.id}`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes sur l'appel..."
                rows={2}
                className="w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-600"
              />
            </div>

            {submitError && (
              <p className="mt-2.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-400" role="alert">
                {submitError}
              </p>
            )}

            <button
              type="submit"
              disabled={!selectedResult || isSubmitting}
              aria-label="Valider le résultat de l'appel"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-gray-900"
            >
              {isSubmitting ? (
                <>
                  <svg
                    className="animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Enregistrement...
                </>
              ) : (
                <>
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
                    aria-hidden="true"
                  >
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
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Notes
          </p>
          <p className="mt-1.5 text-sm text-gray-700 dark:text-gray-300">{item.call_notes}</p>
        </div>
      )}
    </article>
  )
}
