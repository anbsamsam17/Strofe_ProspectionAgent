'use client'

// ============================================================
// SEND EMAIL BUTTON — CTA fiche prospect qui ouvre EmailComposer (GLN-020)
// ============================================================

import { useState } from 'react'
import { EmailComposer, type ComposerContact } from './email-composer'
import type { EmailPersona } from '@/lib/email/detect-persona'

interface SendEmailButtonProps {
  prospectId: string
  prospectRaisonSociale: string
  firstContact: boolean
  contacts: ComposerContact[]
  templates: Record<EmailPersona, { subject: string; body: string }>
}

export function SendEmailButton({
  prospectId,
  prospectRaisonSociale,
  firstContact,
  contacts,
  templates,
}: SendEmailButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-green-700"
      >
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
        >
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
        Envoyer un email
      </button>

      <EmailComposer
        prospectId={prospectId}
        prospectRaisonSociale={prospectRaisonSociale}
        firstContact={firstContact}
        contacts={contacts}
        templates={templates}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
