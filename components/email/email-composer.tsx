'use client'

// ============================================================
// EMAIL COMPOSER — Modal d'envoi email prospection (GLN-020 + GLN-003 + GLN-120)
//
// Ouvre depuis SendEmailButton. Permet de :
//   - Choisir un contact (parmi prospect_contacts avec email valide)
//   - Choisir un template (DAF/RSE/DG/DRH, pré-sélectionné via poste)
//   - Éditer sujet et corps (avec placeholders {{prenom}}, etc.)
//   - Afficher info-box RGPD art. 14 si firstContact
//   - Envoyer via POST /api/email/send
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'

import { detectPersona, PERSONA_LABELS, type EmailPersona } from '@/lib/email/detect-persona'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ComposerContact {
  id: string
  prenom: string | null
  nom: string | null
  email: string | null
  email_status: string | null
  poste: string | null
}

interface EmailComposerProps {
  prospectId: string
  prospectRaisonSociale: string
  /** Indique si first_contact_at est null côté DB (affichage info-box RGPD). */
  firstContact: boolean
  contacts: ComposerContact[]
  /** Templates par persona — sujet et corps par défaut (placeholders bruts). */
  templates: Record<EmailPersona, { subject: string; body: string }>
  open: boolean
  onClose: () => void
}

const PERSONAS: EmailPersona[] = ['daf', 'rse', 'dg', 'drh']

// ── Composant ─────────────────────────────────────────────────────────────────

export function EmailComposer({
  prospectId,
  prospectRaisonSociale,
  firstContact,
  contacts,
  templates,
  open,
  onClose,
}: EmailComposerProps) {
  const router = useRouter()
  const validContacts = contacts.filter(
    (c) => c.email && c.email_status !== 'invalid',
  )
  const [contactId, setContactId] = useState<string>(validContacts[0]?.id ?? '')
  const initialPersona: EmailPersona = detectPersona(
    validContacts[0]?.poste ?? null,
  )
  const [templateKey, setTemplateKey] = useState<EmailPersona>(initialPersona)
  const [subject, setSubject] = useState<string>(templates[initialPersona].subject)
  const [body, setBody] = useState<string>(templates[initialPersona].body)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const firstFieldRef = useRef<HTMLSelectElement | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Réinitialise quand on rouvre : pré-sélectionne contact + template selon poste.
  useEffect(() => {
    if (!open) return
    const first = validContacts[0]
    const newContactId = first?.id ?? ''
    const newPersona = detectPersona(first?.poste ?? null)
    setContactId(newContactId)
    setTemplateKey(newPersona)
    setSubject(templates[newPersona].subject)
    setBody(templates[newPersona].body)
    setError(null)
    const t = setTimeout(() => firstFieldRef.current?.focus(), 30)
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
    // On ne dépend que de `open` — pas vouloir tout reset quand on tape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function handleContactChange(newContactId: string) {
    setContactId(newContactId)
    const c = validContacts.find((x) => x.id === newContactId)
    if (c) {
      const persona = detectPersona(c.poste)
      setTemplateKey(persona)
      setSubject(templates[persona].subject)
      setBody(templates[persona].body)
    }
  }

  function handleTemplateChange(key: EmailPersona) {
    setTemplateKey(key)
    setSubject(templates[key].subject)
    setBody(templates[key].body)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (!contactId) {
      setError('Sélectionnez un contact avec un email valide.')
      return
    }
    if (!subject.trim()) {
      setError('Le sujet ne peut pas être vide.')
      return
    }
    if (!body.trim()) {
      setError('Le corps ne peut pas être vide.')
      return
    }

    setPending(true)
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospectId,
          contactId,
          subject: subject.trim(),
          body,
          templateKey,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string | { message?: string }
        }
        const msg =
          typeof data.error === 'string'
            ? data.error
            : data.error?.message ?? "Erreur lors de l'envoi"
        throw new Error(msg)
      }
      onClose()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setPending(false)
    }
  }

  if (!open || !mounted) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-composer-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-[calc(100vw-2rem)] max-w-2xl rounded-2xl border border-white/[0.08] bg-[oklch(14%_0.02_240)]/95 backdrop-blur-md p-6 shadow-2xl ring-1 ring-black/30">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h3 id="email-composer-title" className="text-lg font-semibold text-white">
              Envoyer un email
            </h3>
            <p className="mt-0.5 text-sm text-gray-400">
              À {prospectRaisonSociale}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-gray-200"
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
        </div>

        {validContacts.length === 0 ? (
          <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm text-orange-100">
            Aucun contact avec un email valide pour ce prospect. Ajoute un
            contact avec email avant d&rsquo;envoyer.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">

            {firstContact && (
              <div
                role="status"
                className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2.5 text-sm text-blue-100"
              >
                <span aria-hidden="true">ℹ️ </span>
                Premier contact — les mentions RGPD art. 14 seront automatiquement
                ajoutées en footer (obligation CNIL Référentiel prospection 2020).
              </div>
            )}

            {/* Contact destinataire */}
            <div className="space-y-1.5">
              <label
                htmlFor="email-contact"
                className="block font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80"
              >
                Destinataire
              </label>
              <select
                id="email-contact"
                ref={firstFieldRef}
                value={contactId}
                onChange={(e) => handleContactChange(e.target.value)}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2.5 text-sm text-white transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 [color-scheme:dark]"
              >
                {validContacts.map((c) => (
                  <option
                    key={c.id}
                    value={c.id}
                    className="bg-[oklch(14%_0.02_240)] text-white"
                  >
                    {[c.prenom, c.nom].filter(Boolean).join(' ') || 'Contact'} —{' '}
                    {c.email}
                    {c.poste ? ` (${c.poste})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Template persona */}
            <div className="space-y-1.5">
              <label
                htmlFor="email-template"
                className="block font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80"
              >
                Template (persona)
              </label>
              <select
                id="email-template"
                value={templateKey}
                onChange={(e) => handleTemplateChange(e.target.value as EmailPersona)}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2.5 text-sm text-white transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 [color-scheme:dark]"
              >
                {PERSONAS.map((k) => (
                  <option
                    key={k}
                    value={k}
                    className="bg-[oklch(14%_0.02_240)] text-white"
                  >
                    {PERSONA_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>

            {/* Sujet */}
            <div className="space-y-1.5">
              <label
                htmlFor="email-subject"
                className="block font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80"
              >
                Objet
              </label>
              <input
                id="email-subject"
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2.5 text-sm text-white placeholder:text-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
              />
              <p className="text-[10px] text-gray-500">
                Variables : <code>{'{{prenom}}'}</code>{' '}
                <code>{'{{raison_sociale}}'}</code>{' '}
                <code>{'{{secteur_libelle}}'}</code>{' '}
                <code>{'{{beges_expire_le}}'}</code>{' '}
                <code>{'{{calendly_url}}'}</code>
              </p>
            </div>

            {/* Corps */}
            <div className="space-y-1.5">
              <label
                htmlFor="email-body"
                className="block font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80"
              >
                Corps
              </label>
              <textarea
                id="email-body"
                rows={14}
                required
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={10000}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2.5 text-sm leading-relaxed text-white placeholder:text-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
              />
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-red-500/15 px-3 py-2.5 text-sm text-red-200 ring-1 ring-red-500/25"
              >
                {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-white/[0.06] pt-5">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-4 py-2.5 text-sm font-medium text-gray-200 transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? 'Envoi…' : 'Envoyer'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  )
}
