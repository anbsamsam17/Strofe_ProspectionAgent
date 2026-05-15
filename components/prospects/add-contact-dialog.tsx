'use client'

import { useEffect, useRef, useState } from 'react'
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

  // Focus le 1er champ à l'ouverture + gérer ESC.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => firstFieldRef.current?.focus(), 30)
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeDialog()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-contact-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
          onClick={(e) => {
            // Clic sur le backdrop (pas sur le panel) → fermer.
            if (e.target === e.currentTarget) closeDialog()
          }}
        >
          <div className="w-[calc(100vw-2rem)] max-w-lg rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md p-6 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h3 id="add-contact-title" className="text-lg font-semibold text-gray-900 dark:text-white">
                  Ajouter un contact
                </h3>
                <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                  Renseignez au moins un champ d&apos;identification.
                </p>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                aria-label="Fermer la fenêtre"
                className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
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

              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={form.is_primary}
                  onChange={(e) => update('is_primary', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                />
                Définir comme contact principal
              </label>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-400"
                >
                  {error}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] pt-4 dark:border-gray-800">
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={pending}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pending ? 'Ajout en cours…' : 'Ajouter le contact'}
                </button>
              </div>
            </form>
          </div>
        </div>
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
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
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
        className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
      />
    </div>
  )
}
