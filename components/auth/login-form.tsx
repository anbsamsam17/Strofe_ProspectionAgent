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
    'Email not confirmed': 'Votre email n\'est pas encore confirmé. Vérifiez votre boîte mail.',
    'User already registered': 'Un compte existe déjà avec cet email.',
    'Password should be at least 6 characters': 'Le mot de passe doit contenir au moins 6 caractères.',
    'Unable to validate email address: invalid format': 'Format d\'email invalide.',
    'Signup is disabled': 'Les inscriptions sont temporairement désactivées.',
    'Email rate limit exceeded': 'Trop de tentatives. Patientez quelques minutes avant de réessayer.',
    'over_email_send_rate_limit': 'Trop d\'emails envoyés. Attendez une minute avant de réessayer.',
    'For security purposes, you can only request this after': 'Pour des raisons de sécurité, veuillez patienter avant de renvoyer un email.',
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
// Icônes SVG inline — pas de dépendance externe
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
    <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  )
}

function CheckCircleIcon() {
  return (
    <svg className="h-5 w-5 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
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

      router.push('/dashboard')
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
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="rounded-full bg-green-50 p-3">
            <CheckCircleIcon />
          </div>
        </div>
        <h2 className="text-lg font-semibold text-gray-900">Lien envoyé !</h2>
        <p className="text-sm text-gray-600">
          Un lien de connexion a été envoyé à{' '}
          <span className="font-medium text-gray-900">{form.email}</span>.
          <br />
          Vérifiez votre boîte mail (et vos spams).
        </p>
        <button
          type="button"
          onClick={() => {
            setMagicLinkSent(false)
            setForm({ email: '', password: '' })
          }}
          className="text-sm text-green-600 hover:text-green-700 font-medium underline-offset-2 hover:underline transition-colors"
        >
          Utiliser un autre email
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Sélecteur de mode */}
      <div className="flex rounded-lg bg-gray-100 p-1 gap-1" role="tablist" aria-label="Mode de connexion">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'password'}
          onClick={() => { setMode('password'); setError(null) }}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-all ${
            mode === 'password'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Mot de passe
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'magic-link'}
          onClick={() => { setMode('magic-link'); setError(null) }}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-all ${
            mode === 'magic-link'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Magic Link
        </button>
      </div>

      {/* Message d'erreur global */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
        >
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Formulaire mot de passe */}
      {mode === 'password' && (
        <form onSubmit={handlePasswordLogin} noValidate className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
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
                className="block w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 disabled:opacity-50 transition-colors"
                disabled={loading}
                aria-describedby={error ? 'login-error' : undefined}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Mot de passe
              </label>
              <Link
                href="/auth/forgot-password"
                className="text-xs text-green-600 hover:text-green-700 font-medium transition-colors"
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
                className="block w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 disabled:opacity-50 transition-colors"
                disabled={loading}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {loading && <SpinnerIcon />}
            {loading ? 'Connexion en cours…' : 'Se connecter'}
          </button>
        </form>
      )}

      {/* Formulaire magic link */}
      {mode === 'magic-link' && (
        <form onSubmit={handleMagicLink} noValidate className="space-y-4">
          <p className="text-sm text-gray-600">
            Recevez un lien de connexion instantané par email — sans mot de passe.
          </p>

          <div>
            <label htmlFor="email-magic" className="block text-sm font-medium text-gray-700 mb-1.5">
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
                className="block w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 disabled:opacity-50 transition-colors"
                disabled={loading}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {loading && <SpinnerIcon />}
            {loading ? 'Envoi en cours…' : 'Envoyer le lien de connexion'}
          </button>
        </form>
      )}

      {/* Lien vers inscription */}
      <p className="text-center text-sm text-gray-600">
        Pas encore de compte ?{' '}
        <Link
          href="/signup"
          className="font-medium text-green-600 hover:text-green-700 transition-colors"
        >
          Créer un compte
        </Link>
      </p>
    </div>
  )
}
