'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

// ---------------------------------------------------------------
// Traductions des codes d'erreur Supabase Auth
// ---------------------------------------------------------------
function translateAuthError(message: string): string {
  const errorMap: Record<string, string> = {
    'Invalid login credentials': 'Email ou mot de passe incorrect.',
    'Email not confirmed': "Votre email n'est pas encore confirmé. Vérifiez votre boîte mail.",
    'User already registered': 'Un compte existe déjà avec cet email.',
    'Password should be at least 6 characters': 'Le mot de passe doit contenir au moins 6 caractères.',
    'Unable to validate email address: invalid format': "Format d'email invalide.",
    'Signup is disabled': 'Les inscriptions sont temporairement désactivées.',
    'Email rate limit exceeded': 'Trop de tentatives. Patientez quelques minutes avant de réessayer.',
    'over_email_send_rate_limit': "Trop d'emails envoyés. Attendez une minute avant de réessayer.",
    'For security purposes, you can only request this after':
      'Pour des raisons de sécurité, veuillez patienter avant de renvoyer un email.',
  }

  for (const [key, translation] of Object.entries(errorMap)) {
    if (message.includes(key)) return translation
  }

  return 'Une erreur est survenue. Veuillez réessayer.'
}

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------
type AuthMode = 'password' | 'magic-link'

interface FormState {
  email: string
  password: string
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
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
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
      className="h-10 w-10 text-green-400"
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
// Composant principal
// ---------------------------------------------------------------
export function LoginForm() {
  const router = useRouter()
  const [mode, setMode] = useState<AuthMode>('password')
  const [form, setForm] = useState<FormState>({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [magicLinkSent, setMagicLinkSent] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  // Connexion email + mot de passe
  async function handlePasswordLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (!form.email || !form.password) {
      setError('Veuillez remplir tous les champs.')
      return
    }

    setLoading(true)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: form.email.trim().toLowerCase(),
        password: form.password,
      })

      if (authError) {
        setError(translateAuthError(authError.message))
        return
      }

      router.push('/prospects')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  // Connexion par Magic Link
  async function handleMagicLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (!form.email) {
      setError('Veuillez saisir votre adresse email.')
      return
    }

    setLoading(true)
    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: form.email.trim().toLowerCase(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
        },
      })

      if (authError) {
        setError(translateAuthError(authError.message))
        return
      }

      setMagicLinkSent(true)
    } finally {
      setLoading(false)
    }
  }

  // Confirmation envoi magic link
  if (magicLinkSent) {
    return (
      <div className="space-y-5 text-center">
        <div className="flex justify-center">
          <div className="rounded-full border border-green-400/20 bg-green-400/10 p-4">
            <CheckCircleIcon />
          </div>
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold text-white">Lien envoyé !</h2>
          <p className="text-sm text-gray-400">
            Un lien de connexion a été envoyé à{' '}
            <span className="font-medium text-gray-200">{form.email}</span>.
            <br />
            Vérifiez votre boîte mail (et vos spams).
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setMagicLinkSent(false)
            setForm({ email: '', password: '' })
          }}
          className="text-sm text-cyan-400 hover:text-cyan-300 font-medium underline-offset-2 hover:underline transition-colors"
        >
          Utiliser un autre email
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Sélecteur de mode — tabs tech */}
      <div
        className="flex rounded-lg border border-white/[0.08] bg-white/[0.04] p-1 gap-1"
        role="tablist"
        aria-label="Mode de connexion"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'password'}
          onClick={() => { setMode('password'); setError(null) }}
          className={`flex-1 rounded-md py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-all ${
            mode === 'password'
              ? 'bg-white/[0.08] text-white shadow-sm'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Mot de passe
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'magic-link'}
          onClick={() => { setMode('magic-link'); setError(null) }}
          className={`flex-1 rounded-md py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-all ${
            mode === 'magic-link'
              ? 'bg-white/[0.08] text-white shadow-sm'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Magic Link
        </button>
      </div>

      {/* Message d'erreur global */}
      {error && (
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
          <span>{error}</span>
        </div>
      )}

      {/* Formulaire mot de passe */}
      {mode === 'password' && (
        <form onSubmit={handlePasswordLogin} noValidate className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.15em] text-cyan-300/80"
            >
              Adresse email
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                <MailIcon />
              </div>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={form.email}
                onChange={handleChange}
                placeholder="vous@entreprise.fr"
                disabled={loading}
                aria-describedby={error ? 'login-error' : undefined}
                className="block w-full rounded-lg border border-white/10 bg-white/[0.04] py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-gray-400 focus:border-cyan-400/40 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 disabled:opacity-50 transition-colors"
              />
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="password"
                className="block font-mono text-[10px] uppercase tracking-[0.15em] text-cyan-300/80"
              >
                Mot de passe
              </label>
              <Link
                href="/auth/forgot-password"
                className="font-mono text-[10px] text-cyan-400 transition-colors hover:text-cyan-300"
              >
                Mot de passe oublié ?
              </Link>
            </div>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                <LockIcon />
              </div>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={form.password}
                onChange={handleChange}
                placeholder="••••••••"
                disabled={loading}
                className="block w-full rounded-lg border border-white/10 bg-white/[0.04] py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-gray-400 focus:border-cyan-400/40 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 disabled:opacity-50 transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_20px_-4px_oklch(70%_0.19_152_/_0.5)] transition-all hover:shadow-[0_0_28px_-2px_oklch(70%_0.19_152_/_0.7)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
          >
            {loading && <SpinnerIcon />}
            {loading ? 'Connexion en cours…' : 'Se connecter'}
          </button>
        </form>
      )}

      {/* Formulaire magic link */}
      {mode === 'magic-link' && (
        <form onSubmit={handleMagicLink} noValidate className="space-y-4">
          <p className="text-sm text-gray-400">
            Recevez un lien de connexion instantané par email — sans mot de passe.
          </p>

          <div>
            <label
              htmlFor="email-magic"
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.15em] text-cyan-300/80"
            >
              Adresse email
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                <MailIcon />
              </div>
              <input
                id="email-magic"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={form.email}
                onChange={handleChange}
                placeholder="vous@entreprise.fr"
                disabled={loading}
                className="block w-full rounded-lg border border-white/10 bg-white/[0.04] py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-gray-400 focus:border-cyan-400/40 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 disabled:opacity-50 transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_20px_-4px_oklch(70%_0.19_152_/_0.5)] transition-all hover:shadow-[0_0_28px_-2px_oklch(70%_0.19_152_/_0.7)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
          >
            {loading && <SpinnerIcon />}
            {loading ? 'Envoi en cours…' : 'Envoyer le lien de connexion'}
          </button>
        </form>
      )}

      {/* Lien vers inscription */}
      <p className="text-center text-sm text-gray-400">
        Pas encore de compte ?{' '}
        <Link href="/signup" className="font-medium text-cyan-400 transition-colors hover:text-cyan-300">
          Créer un compte
        </Link>
      </p>
    </div>
  )
}
