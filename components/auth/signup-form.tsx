'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'

// ---------------------------------------------------------------
// Schéma de validation Zod
// ---------------------------------------------------------------
const SignupSchema = z
  .object({
    full_name: z
      .string()
      .min(2, 'Le nom complet doit contenir au moins 2 caractères.')
      .max(100, 'Le nom complet est trop long.'),
    email: z
      .string()
      .email("Format d'email invalide.")
      .max(255, "L'email est trop long."),
    password: z
      .string()
      .min(8, 'Le mot de passe doit contenir au moins 8 caractères.')
      .max(72, 'Le mot de passe est trop long.')
      .regex(/[A-Z]/, 'Le mot de passe doit contenir au moins une majuscule.')
      .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre.'),
    confirm_password: z.string(),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: 'Les mots de passe ne correspondent pas.',
    path: ['confirm_password'],
  })

type SignupFields = z.infer<typeof SignupSchema>
type FieldErrors = Partial<Record<keyof SignupFields, string>>

// ---------------------------------------------------------------
// Traductions erreurs Supabase Auth
// ---------------------------------------------------------------
function translateAuthError(message: string): string {
  const errorMap: Record<string, string> = {
    'User already registered': 'Un compte existe déjà avec cette adresse email.',
    'Email rate limit exceeded': 'Trop de tentatives. Attendez quelques minutes.',
    'Signup is disabled': 'Les inscriptions sont temporairement désactivées.',
    'Password should be at least 6 characters': 'Le mot de passe doit contenir au moins 6 caractères.',
    'Unable to validate email address: invalid format': "Format d'email invalide.",
    'over_email_send_rate_limit': "Trop d'emails envoyés. Attendez une minute.",
  }

  for (const [key, translation] of Object.entries(errorMap)) {
    if (message.includes(key)) return translation
  }

  return "Une erreur est survenue lors de l'inscription. Veuillez réessayer."
}

// ---------------------------------------------------------------
// Icônes SVG inline
// ---------------------------------------------------------------
function SpinnerIcon() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg
      className="h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
      />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg
      className="h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg
      className="h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
      />
    </svg>
  )
}

function CheckCircleIcon() {
  return (
    <svg
      className="h-12 w-12 text-green-400"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

// ---------------------------------------------------------------
// Indicateur de force du mot de passe
// ---------------------------------------------------------------
function PasswordStrength({ password }: { password: string }) {
  if (!password) return null

  const checks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  }

  const score = Object.values(checks).filter(Boolean).length
  const labels = ['Très faible', 'Faible', 'Moyen', 'Fort', 'Très fort']
  const barColors = [
    'bg-red-500',
    'bg-orange-500',
    'bg-yellow-500',
    'bg-green-400',
    'bg-green-500',
  ]

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < score ? barColors[score - 1] : 'bg-white/10'
            }`}
          />
        ))}
      </div>
      <p className="text-[11px] text-gray-500">
        Force :{' '}
        <span className="font-medium text-gray-400">{labels[score]}</span>
      </p>
    </div>
  )
}

// ---------------------------------------------------------------
// Composant de champ avec gestion d'erreur
// ---------------------------------------------------------------
interface InputFieldProps {
  id: string
  name: string
  type: string
  label: string
  placeholder: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  error?: string
  disabled: boolean
  autoComplete?: string
  icon: React.ReactNode
  hint?: React.ReactNode
}

function InputField({
  id,
  name,
  type,
  label,
  placeholder,
  value,
  onChange,
  error,
  disabled,
  autoComplete,
  icon,
  hint,
}: InputFieldProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.15em] text-cyan-300/80"
      >
        {label}
      </label>
      <div className="relative">
        <div
          className={`pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 ${
            error ? 'text-red-400' : 'text-gray-500'
          }`}
        >
          {icon}
        </div>
        <input
          id={id}
          name={name}
          type={type}
          autoComplete={autoComplete}
          required
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`block w-full rounded-lg border py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-gray-500 bg-white/[0.04] focus:outline-none focus:ring-1 disabled:opacity-50 transition-colors ${
            error
              ? 'border-red-500/40 focus:border-red-500/60 focus:ring-red-500/20'
              : 'border-white/10 focus:border-cyan-400/40 focus:ring-cyan-400/30'
          }`}
        />
      </div>
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-1.5 flex items-center gap-1 text-xs text-red-400"
        >
          <svg
            className="h-3.5 w-3.5 shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          {error}
        </p>
      )}
      {hint}
    </div>
  )
}

// ---------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------
export function SignupForm() {
  const [form, setForm] = useState<SignupFields>({
    full_name: '',
    email: '',
    password: '',
    confirm_password: '',
  })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmationSent, setConfirmationSent] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))

    // Nettoie l'erreur du champ modifié
    if (fieldErrors[name as keyof SignupFields]) {
      setFieldErrors((prev) => ({ ...prev, [name]: undefined }))
    }
    setGlobalError(null)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFieldErrors({})
    setGlobalError(null)

    // Validation Zod côté client
    const result = SignupSchema.safeParse(form)
    if (!result.success) {
      const errors: FieldErrors = {}
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof SignupFields
        if (!errors[field]) {
          errors[field] = issue.message
        }
      }
      setFieldErrors(errors)
      return
    }

    setLoading(true)
    try {
      const { error: authError } = await supabase.auth.signUp({
        email: form.email.trim().toLowerCase(),
        password: form.password,
        options: {
          data: {
            full_name: form.full_name.trim(),
          },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (authError) {
        setGlobalError(translateAuthError(authError.message))
        return
      }

      setConfirmationSent(true)
    } finally {
      setLoading(false)
    }
  }

  // Écran de confirmation
  if (confirmationSent) {
    return (
      <div className="space-y-5 text-center">
        <div className="flex justify-center">
          <div className="rounded-full border border-green-400/20 bg-green-400/10 p-4">
            <CheckCircleIcon />
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-white">Vérifiez votre email</h2>
          <p className="text-sm text-gray-400">
            Un email de confirmation a été envoyé à{' '}
            <span className="font-medium text-gray-200">{form.email}</span>.
          </p>
          <p className="text-sm text-gray-500">
            Cliquez sur le lien dans l&apos;email pour activer votre compte.
            <br />
            Pensez à vérifier vos spams si vous ne le recevez pas.
          </p>
        </div>
        <div className="pt-1">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-5 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            Retour à la connexion
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {/* Erreur globale */}
      {globalError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          <svg
            className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
          <span>{globalError}</span>
        </div>
      )}

      <InputField
        id="full_name"
        name="full_name"
        type="text"
        label="Nom complet"
        placeholder="Marie Dupont"
        value={form.full_name}
        onChange={handleChange}
        error={fieldErrors.full_name}
        disabled={loading}
        autoComplete="name"
        icon={<UserIcon />}
      />

      <InputField
        id="email"
        name="email"
        type="email"
        label="Adresse email"
        placeholder="vous@entreprise.fr"
        value={form.email}
        onChange={handleChange}
        error={fieldErrors.email}
        disabled={loading}
        autoComplete="email"
        icon={<MailIcon />}
      />

      <InputField
        id="password"
        name="password"
        type="password"
        label="Mot de passe"
        placeholder="••••••••"
        value={form.password}
        onChange={handleChange}
        error={fieldErrors.password}
        disabled={loading}
        autoComplete="new-password"
        icon={<LockIcon />}
        hint={<PasswordStrength password={form.password} />}
      />

      <InputField
        id="confirm_password"
        name="confirm_password"
        type="password"
        label="Confirmer le mot de passe"
        placeholder="••••••••"
        value={form.confirm_password}
        onChange={handleChange}
        error={fieldErrors.confirm_password}
        disabled={loading}
        autoComplete="new-password"
        icon={<LockIcon />}
      />

      <div className="pt-1">
        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_20px_-4px_oklch(70%_0.19_152_/_0.5)] transition-all hover:shadow-[0_0_28px_-2px_oklch(70%_0.19_152_/_0.7)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
        >
          {loading && <SpinnerIcon />}
          {loading ? 'Création en cours…' : 'Créer mon compte'}
        </button>
      </div>

      <p className="text-center text-sm text-gray-500">
        Déjà un compte ?{' '}
        <Link href="/login" className="font-medium text-cyan-400 transition-colors hover:text-cyan-300">
          Se connecter
        </Link>
      </p>
    </form>
  )
}
