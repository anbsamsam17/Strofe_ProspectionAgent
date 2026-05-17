'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'

// ── Props ─────────────────────────────────────────────────────────────────────

interface AddContactDialogProps {
  prospectId: string
}

interface ContactFormState {
  prenom: string
  nom: string
  poste: string
  telephone: string
  email: string
  linkedin: string
  is_primary: boolean
}

const EMPTY_FORM: ContactFormState = {
  prenom: '',
  nom: '',
  poste: '',
  telephone: '',
  email: '',
  linkedin: '',
  is_primary: false,
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function AddContactDialog({ prospectId }: AddContactDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<ContactFormState>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const firstFieldRef = useRef<HTMLInputElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  // Portal mount : sur le serveur on ne rend rien. On flip à true au 1er render
  // côté client pour éviter mismatch SSR/CSR.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // Focus le 1er champ à l'ouverture + gérer ESC + body scroll lock.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => firstFieldRef.current?.focus(), 30)
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeDialog()
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  function closeDialog() {
    setOpen(false)
    setError(null)
    setForm(EMPTY_FORM)
    triggerRef.current?.focus()
  }

  function update<K extends keyof ContactFormState>(key: K, value: ContactFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    // Validation client : au moins un champ identifiant rempli.
    const hasAny =
      form.prenom.trim() ||
      form.nom.trim() ||
      form.poste.trim() ||
      form.telephone.trim() ||
      form.email.trim() ||
      form.linkedin.trim()
    if (!hasAny) {
      setError('Renseignez au moins un champ (nom, prénom, poste, téléphone, email ou LinkedIn).')
      return
    }

    setPending(true)
    try {
      const res = await fetch(`/api/prospects/${prospectId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prenom: form.prenom.trim() || undefined,
          nom: form.nom.trim() || undefined,
          poste: form.poste.trim() || undefined,
          telephone: form.telephone.trim() || undefined,
          email: form.email.trim() || undefined,
          linkedin: form.linkedin.trim() || undefined,
          is_primary: form.is_primary,
          source: 'manual',
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string | { message?: string } }
        const msg =
          typeof data.error === 'string'
            ? data.error
            : data.error?.message ?? "Erreur lors de l'ajout du contact"
        throw new Error(msg)
      }
      closeDialog()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
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
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Ajouter un contact
      </button>

      {open && mounted && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-contact-title"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
          onClick={(e) => {
            // Clic sur le backdrop (pas sur le panel) → fermer.
            if (e.target === e.currentTarget) closeDialog()
          }}
        >
          <div className="w-[calc(100vw-2rem)] max-w-lg rounded-2xl border border-white/[0.08] bg-[oklch(14%_0.02_240)]/95 backdrop-blur-md p-6 shadow-2xl ring-1 ring-black/30">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h3 id="add-contact-title" className="text-lg font-semibold text-white">
                  Ajouter un contact
                </h3>
                <p className="mt-0.5 text-sm text-gray-400">
                  Renseignez au moins un champ d&apos;identification.
                </p>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                aria-label="Fermer la fenêtre"
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

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FieldText
                  label="Prénom"
                  id="contact-prenom"
                  value={form.prenom}
                  onChange={(v) => update('prenom', v)}
                  inputRef={firstFieldRef}
                />
                <FieldText
                  label="Nom"
                  id="contact-nom"
                  value={form.nom}
                  onChange={(v) => update('nom', v)}
                />
              </div>
              <FieldText
                label="Poste"
                id="contact-poste"
                value={form.poste}
                onChange={(v) => update('poste', v)}
                placeholder="ex. DAF, Responsable RSE"
              />
              <FieldText
                label="Téléphone"
                id="contact-telephone"
                type="tel"
                value={form.telephone}
                onChange={(v) => update('telephone', v)}
                placeholder="01 23 45 67 89"
              />
              <FieldText
                label="Email"
                id="contact-email"
                type="email"
                value={form.email}
                onChange={(v) => update('email', v)}
                placeholder="exemple@entreprise.fr"
              />
              <FieldText
                label="LinkedIn"
                id="contact-linkedin"
                type="url"
                value={form.linkedin}
                onChange={(v) => update('linkedin', v)}
                placeholder="https://linkedin.com/in/..."
              />

              <label className="flex items-center gap-3 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={form.is_primary}
                  onChange={(e) => update('is_primary', e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-white/[0.06] text-green-500 accent-green-500 focus:ring-2 focus:ring-green-500/40"
                />
                Définir comme contact principal
              </label>

              {error && (
                <p
                  role="alert"
                  className="mt-1.5 rounded-lg bg-red-500/15 px-3 py-2.5 text-sm text-red-200 ring-1 ring-red-500/25"
                >
                  {error}
                </p>
              )}

              <div className="flex items-center justify-end gap-3 border-t border-white/[0.06] pt-5">
                <button
                  type="button"
                  onClick={closeDialog}
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
                  {pending ? 'Ajout en cours…' : 'Ajouter le contact'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

// ── Field ─────────────────────────────────────────────────────────────────────

function FieldText({
  label,
  id,
  value,
  onChange,
  type = 'text',
  placeholder,
  inputRef,
}: {
  label: string
  id: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80"
      >
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2.5 text-sm text-white placeholder:text-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
      />
    </div>
  )
}
