'use client'

// ============================================================
// Kanban Side Panel — drawer latéral droit pour les détails
// d'un prospect cliqué dans le Kanban /pipeline.
//
// Contenu :
//   - Header : raison sociale + statut + bouton fermer
//   - Dropdowns Statut + Priorité (édition rapide)
//   - Score : barre + valeur + décomposition compact
//   - Identité : SIREN (mono-fonte, copie au clic), secteur, ville, effectif
//   - Contact : nom, poste, téléphone (tel:), email (mailto:), LinkedIn
//   - BEGES : badge publié/expiré/absent + date + lien deep ADEME
//   - Notes : <ProspectNotes> (auto-save 800ms debounce)
//   - Footer : CTA "Voir le détail complet →"
//
// Ouverture/fermeture :
//   - Slide-in via translate-x (Tailwind utility, durée 300ms)
//   - Overlay bg-black/40 cliquable
//   - Touche Escape ferme
// ============================================================

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type {
  Priority,
  Prospect,
  ProspectStatus,
  ScoreDetails,
} from '@/lib/types'
import { buildBegesUrl } from '@/lib/utils/beges-url'
import { ProspectNotes } from '@/components/prospects/prospect-notes'

// ── Types ─────────────────────────────────────────────────────────────────────

interface KanbanSidePanelProps {
  prospect: Prospect
  open: boolean
  onClose: () => void
  onStatusChange: (id: string, newStatus: ProspectStatus) => void
}

// ── Constantes ────────────────────────────────────────────────────────────────

// Labels alignés sur les colonnes du Kanban (spec utilisateur).
const STATUS_LABELS: Record<ProspectStatus, { label: string; badge: string; dot: string }> = {
  sourced: {
    label: 'Pas de contact identifié',
    badge: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    dot: 'bg-gray-400',
  },
  qualified: {
    label: 'Qualifié',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  contacted: {
    label: 'Contacté',
    badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400',
    dot: 'bg-yellow-500',
  },
  interested: {
    label: 'Intéressé',
    badge: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
    dot: 'bg-green-500',
  },
  // `rdv` (legacy) reste géré ici pour ne pas casser les prospects existants.
  rdv: {
    label: 'RDV',
    badge: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400',
    dot: 'bg-purple-500',
  },
  offer_sent: {
    label: 'Offre envoyée',
    badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400',
    dot: 'bg-indigo-500',
  },
  converted: {
    label: 'Affaire conclue',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  rejected: {
    label: 'Sans suite',
    badge: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
    dot: 'bg-red-500',
  },
  on_hold: {
    label: 'En stand-by',
    badge: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400',
    dot: 'bg-orange-500',
  },
}

// Statuts proposés dans le dropdown (ordre = ordre des colonnes Kanban).
// TODO(coord-A): inclure `offer_sent` une fois ajouté à `ProspectStatus`.
const STATUS_OPTIONS: ProspectStatus[] = [
  'sourced',
  'qualified',
  'contacted',
  'interested',
  'converted',
  'rejected',
  'on_hold',
]

const PRIORITY_LABELS: Record<Priority, { label: string; badge: string }> = {
  haute: {
    label: 'Haute',
    badge: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  },
  moyenne: {
    label: 'Moyenne',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  },
  basse: {
    label: 'Basse',
    badge: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
  },
}

const PRIORITY_OPTIONS: Priority[] = ['haute', 'moyenne', 'basse']

// ── Helpers ───────────────────────────────────────────────────────────────────

// 3 piliers scoring + pénalités (refonte 2026-05-14). Les anciens champs
// (obligation_beges, secteur_prioritaire, …) restent dans ScoreDetails marqués
// `@deprecated optional` côté lib/types.ts pour rétrocompat — on ne les affiche
// plus. `weights` est un objet de pondérations, exclu aussi.
type ScoreDetailKey = 'taille' | 'beges' | 'contact' | 'deja_contacte_penalty' | 'rejete_penalty'

const SCORE_DETAIL_LABELS: Record<ScoreDetailKey, string> = {
  taille: 'Taille',
  beges: 'BEGES',
  contact: 'Contact',
  deja_contacte_penalty: 'Déjà contacté',
  rejete_penalty: 'Rejeté',
}

const SCORE_DETAIL_KEYS = new Set<string>(Object.keys(SCORE_DETAIL_LABELS))

function formatScoreDetailLabel(key: ScoreDetailKey): string {
  return SCORE_DETAIL_LABELS[key]
}

function formatDate(iso: string | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

// Prospect.priorite n'existe pas encore (Agent A). On dérive une priorité par
// défaut depuis `score_priorite` pour piloter l'UI tant que la colonne DB n'est
// pas créée. Seuils alignés sur ceux des badges score : ≥75 haute, ≥50 normale.
// TODO(coord-A): lire prospect.priorite quand la colonne sera disponible.
function derivePriority(prospect: Prospect): Priority {
  if (prospect.score_priorite >= 75) return 'haute'
  if (prospect.score_priorite >= 50) return 'moyenne'
  return 'basse'
}

// ── Sous-composants ───────────────────────────────────────────────────────────

function CopySirenButton({ siren }: { siren: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(siren)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // L'utilisateur peut sélectionner manuellement le SIREN — on ne bloque pas.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'SIREN copié' : `Copier le SIREN ${siren}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-xs text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:bg-gray-700"
    >
      {siren}
      {copied ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="text-green-600 dark:text-green-400"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {title}
      </h3>
      {children}
    </section>
  )
}

// Dropdown maison — Tailwind brut, pas de Radix. Ferme au clic extérieur + Escape.
// TODO(coord-D): remplacer par <StatusDropdown> partagé une fois mergé.
function StatusInlineDropdown({
  prospectId,
  currentStatut,
  onChange,
  disabled,
}: {
  prospectId: string
  currentStatut: ProspectStatus
  onChange: (id: string, newStatus: ProspectStatus) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<ProspectStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClickAway(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickAway)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickAway)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function select(newStatus: ProspectStatus) {
    if (newStatus === currentStatut) {
      setOpen(false)
      return
    }
    setPending(newStatus)
    setError(null)
    try {
      const res = await fetch(`/api/prospects/${prospectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statut: newStatus }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? 'Erreur lors du changement de statut')
      }
      onChange(prospectId, newStatus)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setPending(null)
    }
  }

  const current = STATUS_LABELS[currentStatut]

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || pending !== null}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Changer le statut (actuel : ${current.label})`}
        className="inline-flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition-colors hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:hover:border-gray-600"
      >
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${current.dot}`} aria-hidden="true" />
          {current.label}
        </span>
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
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Statuts disponibles"
          className="absolute left-0 right-0 top-full z-10 mt-1 max-h-60 overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {STATUS_OPTIONS.map((opt) => {
            const info = STATUS_LABELS[opt]
            const isCurrent = opt === currentStatut
            const isPending = pending === opt
            return (
              <li key={opt}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  disabled={isPending}
                  onClick={() => select(opt)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-800 ${
                    isCurrent
                      ? 'font-semibold text-green-700 dark:text-green-400'
                      : 'text-gray-700 dark:text-gray-200'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${info.dot}`} aria-hidden="true" />
                    {info.label}
                  </span>
                  {isCurrent && (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="13"
                      height="13"
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
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  )
}

// Priorité : dropdown local — la colonne `priorite` n'existe pas encore en DB
// pour la table `prospects` (seul DailyListItem la porte). On le présente en
// read-only avec un indicateur "dérivé du score" pour le moment.
// TODO(coord-A+D): brancher sur PATCH /api/prospects/[id] { priorite } + colonne DB.
function PriorityInlineDropdown({ priorite }: { priorite: Priority }) {
  const current = PRIORITY_LABELS[priorite]
  return (
    <div className="space-y-1">
      <div className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-900 dark:border-gray-700 dark:bg-gray-900/50 dark:text-white">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${current.badge}`}>
          {current.label}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-600">
          dérivée du score
        </span>
      </div>
      {/* Options visuelles non interactives — placeholder UX en attendant la colonne DB. */}
      <div className="hidden">
        {PRIORITY_OPTIONS.map((opt) => (
          <span key={opt}>{opt}</span>
        ))}
      </div>
    </div>
  )
}

function ScoreSection({ prospect }: { prospect: Prospect }) {
  const score = prospect.score_priorite
  const details = prospect.score_details
  // On filtre sur les 3 piliers + 2 pénalités courants (cf. SCORE_DETAIL_KEYS).
  // Les champs legacy de ScoreDetails (@deprecated) et `weights` (objet) sont ignorés.
  const nonZeroDetails: [ScoreDetailKey, number][] = details
    ? (Object.entries(details) as [string, unknown][])
        .filter(
          (entry): entry is [ScoreDetailKey, number] =>
            SCORE_DETAIL_KEYS.has(entry[0]) &&
            typeof entry[1] === 'number' &&
            entry[1] !== 0,
        )
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 5)
    : []

  return (
    <Section title="Score">
      <div className="flex items-center gap-3">
        <span className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
          {score}
        </span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className="h-2 rounded-full bg-green-500"
            style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
            aria-hidden="true"
          />
        </div>
      </div>
      {nonZeroDetails.length > 0 && (
        <ul className="mt-3 space-y-1">
          {nonZeroDetails.map(([key, value]) => (
            <li
              key={key}
              className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400"
            >
              <span>{formatScoreDetailLabel(key)}</span>
              <span
                className={`font-semibold tabular-nums ${
                  value > 0
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {value > 0 ? '+' : ''}
                {value}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function IdentitySection({ prospect }: { prospect: Prospect }) {
  return (
    <Section title="Identité">
      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-gray-500 dark:text-gray-400">SIREN</dt>
          <dd>
            <CopySirenButton siren={prospect.siren} />
          </dd>
        </div>
        {prospect.secteur_libelle && (
          <div className="flex items-start justify-between gap-3">
            <dt className="flex-shrink-0 text-gray-500 dark:text-gray-400">Secteur</dt>
            <dd className="text-right text-gray-900 dark:text-white">
              {prospect.secteur_libelle}
            </dd>
          </div>
        )}
        {prospect.ville && (
          <div className="flex items-center justify-between">
            <dt className="text-gray-500 dark:text-gray-400">Ville</dt>
            <dd className="text-gray-900 dark:text-white">
              {prospect.ville}
              {prospect.code_postal ? ` (${prospect.code_postal})` : ''}
            </dd>
          </div>
        )}
        {(prospect.effectif_min || prospect.effectif_max) && (
          <div className="flex items-center justify-between">
            <dt className="text-gray-500 dark:text-gray-400">Effectif</dt>
            <dd className="text-gray-900 dark:text-white">
              {prospect.effectif_min ?? '?'}–{prospect.effectif_max ?? '?'} sal.
            </dd>
          </div>
        )}
      </dl>
    </Section>
  )
}

function ContactSection({ prospect }: { prospect: Prospect }) {
  const hasContact =
    prospect.contact_nom ||
    prospect.contact_prenom ||
    prospect.contact_telephone ||
    prospect.contact_email ||
    prospect.contact_linkedin

  if (!hasContact) {
    return (
      <Section title="Contact">
        <p className="text-sm italic text-gray-400 dark:text-gray-600">
          Aucun contact identifié
        </p>
      </Section>
    )
  }

  const fullName = [prospect.contact_prenom, prospect.contact_nom]
    .filter(Boolean)
    .join(' ')
    .trim()

  return (
    <Section title="Contact">
      <div className="space-y-2 text-sm">
        {fullName && (
          <p className="font-medium text-gray-900 dark:text-white">
            {fullName}
            {prospect.contact_poste && (
              <span className="ml-1 font-normal text-gray-500 dark:text-gray-400">
                — {prospect.contact_poste}
              </span>
            )}
          </p>
        )}
        {prospect.contact_telephone && (
          <a
            href={`tel:${prospect.contact_telephone.replace(/\s/g, '')}`}
            className="flex items-center gap-2 text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
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
            <span className="font-medium">{prospect.contact_telephone}</span>
          </a>
        )}
        {prospect.contact_email && (
          <a
            href={`mailto:${prospect.contact_email}`}
            className="flex items-center gap-2 break-all text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
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
              className="flex-shrink-0"
            >
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            <span>{prospect.contact_email}</span>
          </a>
        )}
        {prospect.contact_linkedin && (
          <a
            href={prospect.contact_linkedin}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 118.3 6.5a1.78 1.78 0 01-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0013 14.19a.66.66 0 000 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 012.7-1.4c1.55 0 3.36.86 3.36 3.66z" />
            </svg>
            <span className="font-medium">LinkedIn</span>
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
    </Section>
  )
}

function BegesSection({ prospect }: { prospect: Prospect }) {
  const begesUrl = buildBegesUrl(prospect)
  const lastPub = formatDate(prospect.beges_derniere_publication)

  let badge: { label: string; classes: string }
  if (!prospect.beges_publie) {
    badge = {
      label: 'Absent',
      classes: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
    }
  } else if (prospect.beges_valide === false) {
    badge = {
      label: 'Expiré',
      classes: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400',
    }
  } else {
    badge = {
      label: 'Publié',
      classes: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
    }
  }

  return (
    <Section title="BEGES">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badge.classes}`}
        >
          {badge.label}
        </span>
        {lastPub && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Dernière publi : {lastPub}
          </span>
        )}
      </div>
      {begesUrl && (
        <a
          href={begesUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          Voir sur bilans-ges.ademe.fr
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
    </Section>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────

export function KanbanSidePanel({
  prospect,
  open,
  onClose,
  onStatusChange,
}: KanbanSidePanelProps) {
  // Touche Escape pour fermer.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const status = prospect.statut
  const statusInfo = STATUS_LABELS[status]
  const priorite = derivePriority(prospect)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="side-panel-title"
      aria-hidden={!open}
      className="pointer-events-none fixed inset-0 z-40"
    >
      {/* Overlay */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 dark:bg-black/60 ${
          open ? 'pointer-events-auto opacity-100' : 'opacity-0'
        }`}
      />

      {/* Panneau */}
      <aside
        data-testid="kanban-side-panel"
        className={`pointer-events-auto absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl ring-1 ring-black/5 transition-transform duration-300 ease-out dark:bg-gray-950 dark:ring-white/10 sm:w-96 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div className="min-w-0 flex-1">
            <h2
              id="side-panel-title"
              className="truncate text-base font-bold text-gray-900 dark:text-white"
            >
              {prospect.raison_sociale}
            </h2>
            <div className="mt-1.5 flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.badge}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${statusInfo.dot}`}
                  aria-hidden="true"
                />
                {statusInfo.label}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le panneau"
            className="flex-shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        {/* Corps scrollable */}
        <div className="flex-1 overflow-y-auto">
          {/* Dropdowns Statut + Priorité — édition rapide en tête de panneau. */}
          <Section title="Pipeline">
            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-600">
                  Statut
                </p>
                <StatusInlineDropdown
                  prospectId={prospect.id}
                  currentStatut={status}
                  onChange={onStatusChange}
                />
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-600">
                  Priorité
                </p>
                <PriorityInlineDropdown priorite={priorite} />
              </div>
            </div>
          </Section>

          <ScoreSection prospect={prospect} />
          <IdentitySection prospect={prospect} />
          <ContactSection prospect={prospect} />
          <BegesSection prospect={prospect} />

          {/* Notes */}
          <Section title="Notes">
            <ProspectNotes
              prospectId={prospect.id}
              initialNotes={prospect.notes ?? null}
            />
          </Section>
        </div>

        {/* Footer fixe — CTA primaire vers la fiche complète. */}
        <footer className="border-t border-gray-200 bg-gray-50 px-5 py-3 dark:border-gray-800 dark:bg-gray-900/50">
          <Link
            href={`/prospects/${prospect.id}`}
            aria-label={`Voir le détail complet de ${prospect.raison_sociale}`}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700"
          >
            Voir le détail complet
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
              aria-hidden="true"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </footer>
      </aside>
    </div>
  )
}
