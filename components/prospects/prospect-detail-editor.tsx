'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Prospect, ProspectStatus } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type SectionKey = 'identity' | 'contact' | 'beges' | 'statut'

interface ProspectDetailEditorProps {
  prospect: Prospect
  section: SectionKey
  children: React.ReactNode
}

// Champs éditables par section — drives le rendu du formulaire inline.
const EDITABLE_FIELDS: Record<SectionKey, ReadonlyArray<keyof Prospect>> = {
  identity: ['raison_sociale', 'secteur_libelle', 'ville', 'code_postal', 'adresse'],
  contact: [
    'contact_prenom',
    'contact_nom',
    'contact_poste',
    'contact_telephone',
    'contact_email',
    'contact_linkedin',
  ],
  beges: ['beges_publie', 'beges_valide', 'beges_derniere_publication', 'obligation_beges'],
  statut: ['statut'],
}

const SECTION_TITLES: Record<SectionKey, string> = {
  identity: "Modifier l'identité",
  contact: 'Modifier le contact',
  beges: 'Modifier le BEGES',
  statut: 'Modifier le statut',
}

const STATUS_OPTIONS: ReadonlyArray<{ value: ProspectStatus; label: string }> = [
  { value: 'sourced', label: 'Sourcé' },
  { value: 'qualified', label: 'Qualifié' },
  { value: 'contacted', label: 'Contacté' },
  { value: 'interested', label: 'Intéressé' },
  { value: 'rdv', label: 'RDV' },
  { value: 'converted', label: 'Converti' },
  { value: 'rejected', label: 'Rejeté' },
  { value: 'on_hold', label: 'En pause' },
]

// Valeurs typées : on n'envoie au PATCH que des string / boolean / null.
type FieldValue = string | boolean | null
type FormState = Partial<Record<keyof Prospect, FieldValue>>

// ── Helpers ───────────────────────────────────────────────────────────────────

function initialFormState(prospect: Prospect, fields: ReadonlyArray<keyof Prospect>): FormState {
  const state: FormState = {}
  for (const key of fields) {
    const v = prospect[key]
    if (typeof v === 'string' || typeof v === 'boolean' || v === null) {
      state[key] = v
    } else if (v === undefined) {
      state[key] = ''
    }
  }
  return state
}

// Calcule le diff entre la valeur de départ et la valeur saisie pour n'envoyer
// que les champs modifiés au PATCH.
function buildDiff(
  prospect: Prospect,
  state: FormState,
  fields: ReadonlyArray<keyof Prospect>,
): Record<string, FieldValue> {
  const diff: Record<string, FieldValue> = {}
  for (const key of fields) {
    const initial = prospect[key]
    const next = state[key]
    const initialNorm = initial === undefined || initial === null ? '' : initial
    const nextNorm = next === undefined || next === null ? '' : next
    if (initialNorm !== nextNorm) {
      diff[key as string] = next ?? null
    }
  }
  return diff
}

// ── Composant principal ───────────────────────────────────────────────────────

export function ProspectDetailEditor({
  prospect,
  section,
  children,
}: ProspectDetailEditorProps) {
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)
  const [form, setForm] = useState<FormState>(() =>
    initialFormState(prospect, EDITABLE_FIELDS[section]),
  )
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [, startTransition] = useTransition()

  function handleCancel() {
    setForm(initialFormState(prospect, EDITABLE_FIELDS[section]))
    setError(null)
    setIsEditing(false)
  }

  async function handleSave() {
    setError(null)
    const diff = buildDiff(prospect, form, EDITABLE_FIELDS[section])
    if (Object.keys(diff).length === 0) {
      setIsEditing(false)
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch(`/api/prospects/${prospect.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(diff),
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string; details?: Record<string, string[]> }
          | null
        const detailMsgs = data?.details
          ? Object.values(data.details).flat().join(' · ')
          : null
        throw new Error(detailMsgs || data?.error || 'Erreur lors de la mise à jour')
      }

      setIsEditing(false)
      // Re-fetch côté serveur pour rafraîchir la fiche (la page est `force-dynamic`).
      startTransition(() => router.refresh())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setIsSaving(false)
    }
  }

  function updateField(key: keyof Prospect, value: FieldValue) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  if (!isEditing) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="absolute right-0 top-0 inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-2.5 py-1 text-xs font-medium text-gray-300 transition-colors hover:border-green-500/30 hover:bg-green-500/10 hover:text-green-300"
          aria-label={SECTION_TITLES[section]}
        >
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
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Modifier
        </button>
        {children}
      </div>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void handleSave()
      }}
      className="space-y-4"
      aria-label={SECTION_TITLES[section]}
    >
      {section === 'identity' && <IdentityFields form={form} onChange={updateField} />}
      {section === 'contact' && <ContactFields form={form} onChange={updateField} />}
      {section === 'beges' && <BegesFields form={form} onChange={updateField} />}
      {section === 'statut' && <StatutField form={form} onChange={updateField} />}

      {error && (
        <p
          className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-200 ring-1 ring-red-500/25"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] pt-4">
        <button
          type="button"
          onClick={handleCancel}
          disabled={isSaving}
          className="inline-flex items-center rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3.5 py-1.5 text-sm font-medium text-gray-200 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  )
}

// ── Sous-composants champs ────────────────────────────────────────────────────

function TextInput({
  label,
  name,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string
  name: string
  value: FieldValue
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}) {
  const strVal = typeof value === 'string' ? value : value === null ? '' : ''
  return (
    <div>
      <label
        htmlFor={`field-${name}`}
        className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80"
      >
        {label}
      </label>
      <input
        id={`field-${name}`}
        name={name}
        type={type}
        value={strVal}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2 text-sm text-white placeholder:text-gray-500 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
      />
    </div>
  )
}

function CheckboxInput({
  label,
  name,
  value,
  onChange,
}: {
  label: string
  name: string
  value: FieldValue
  onChange: (v: boolean) => void
}) {
  const checked = value === true
  return (
    <label htmlFor={`field-${name}`} className="flex items-center gap-2 text-sm text-gray-200">
      <input
        id={`field-${name}`}
        name={name}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-white/20 bg-white/[0.06] text-green-500 focus:ring-green-500"
      />
      {label}
    </label>
  )
}

function IdentityFields({
  form,
  onChange,
}: {
  form: FormState
  onChange: (key: keyof Prospect, value: FieldValue) => void
}) {
  return (
    <div className="space-y-3">
      <TextInput
        label="Raison sociale"
        name="raison_sociale"
        value={form.raison_sociale ?? ''}
        onChange={(v) => onChange('raison_sociale', v)}
      />
      <TextInput
        label="Libellé secteur"
        name="secteur_libelle"
        value={form.secteur_libelle ?? ''}
        onChange={(v) => onChange('secteur_libelle', v)}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextInput
          label="Ville"
          name="ville"
          value={form.ville ?? ''}
          onChange={(v) => onChange('ville', v)}
        />
        <TextInput
          label="Code postal"
          name="code_postal"
          value={form.code_postal ?? ''}
          onChange={(v) => onChange('code_postal', v)}
        />
      </div>
      <TextInput
        label="Adresse"
        name="adresse"
        value={form.adresse ?? ''}
        onChange={(v) => onChange('adresse', v)}
      />
    </div>
  )
}

function ContactFields({
  form,
  onChange,
}: {
  form: FormState
  onChange: (key: keyof Prospect, value: FieldValue) => void
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextInput
          label="Prénom"
          name="contact_prenom"
          value={form.contact_prenom ?? ''}
          onChange={(v) => onChange('contact_prenom', v)}
        />
        <TextInput
          label="Nom"
          name="contact_nom"
          value={form.contact_nom ?? ''}
          onChange={(v) => onChange('contact_nom', v)}
        />
      </div>
      <TextInput
        label="Poste"
        name="contact_poste"
        value={form.contact_poste ?? ''}
        onChange={(v) => onChange('contact_poste', v)}
      />
      <TextInput
        label="Téléphone"
        name="contact_telephone"
        type="tel"
        placeholder="01 23 45 67 89"
        value={form.contact_telephone ?? ''}
        onChange={(v) => onChange('contact_telephone', v)}
      />
      <TextInput
        label="Email"
        name="contact_email"
        type="email"
        placeholder="exemple@entreprise.fr"
        value={form.contact_email ?? ''}
        onChange={(v) => onChange('contact_email', v)}
      />
      <TextInput
        label="LinkedIn"
        name="contact_linkedin"
        type="url"
        placeholder="https://linkedin.com/in/..."
        value={form.contact_linkedin ?? ''}
        onChange={(v) => onChange('contact_linkedin', v)}
      />
    </div>
  )
}

function BegesFields({
  form,
  onChange,
}: {
  form: FormState
  onChange: (key: keyof Prospect, value: FieldValue) => void
}) {
  return (
    <div className="space-y-3">
      <CheckboxInput
        label="BEGES publié"
        name="beges_publie"
        value={form.beges_publie ?? false}
        onChange={(v) => onChange('beges_publie', v)}
      />
      <CheckboxInput
        label="BEGES encore valide (< 4 ans)"
        name="beges_valide"
        value={form.beges_valide ?? false}
        onChange={(v) => onChange('beges_valide', v)}
      />
      <CheckboxInput
        label="Soumis à l'obligation BEGES"
        name="obligation_beges"
        value={form.obligation_beges ?? false}
        onChange={(v) => onChange('obligation_beges', v)}
      />
      <TextInput
        label="Date de dernière publication"
        name="beges_derniere_publication"
        type="date"
        value={
          typeof form.beges_derniere_publication === 'string'
            ? form.beges_derniere_publication.substring(0, 10)
            : ''
        }
        onChange={(v) => onChange('beges_derniere_publication', v)}
      />
    </div>
  )
}

function StatutField({
  form,
  onChange,
}: {
  form: FormState
  onChange: (key: keyof Prospect, value: FieldValue) => void
}) {
  const current = typeof form.statut === 'string' ? form.statut : 'sourced'
  return (
    <div>
      <label
        htmlFor="field-statut"
        className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80"
      >
        Statut CRM
      </label>
      <select
        id="field-statut"
        value={current}
        onChange={(e) => onChange('statut', e.target.value)}
        className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2 text-sm text-white transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
