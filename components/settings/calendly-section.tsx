'use client'

// ============================================================
// CALENDLY SECTION — settings (GLN-120)
//
// Configuration de l'URL de prise de rendez-vous (Calendly ou Cal.com)
// injectée comme variable {{calendly_url}} dans les templates email.
// ============================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface CalendlySectionProps {
  initialUrl: string
}

const CALENDLY_REGEX = /^https:\/\/(calendly\.com|cal\.com)\//

function isValidCalendlyUrl(url: string): boolean {
  if (!url) return true // chaîne vide = pas configuré (valide)
  return CALENDLY_REGEX.test(url.trim())
}

export function CalendlySection({ initialUrl }: CalendlySectionProps) {
  const router = useRouter()
  const [url, setUrl] = useState<string>(initialUrl)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const trimmed = url.trim()
  const isValid = isValidCalendlyUrl(trimmed)

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('idle')
    setErrorMsg(null)

    if (!isValid) {
      setStatus('error')
      setErrorMsg(
        "L'URL doit commencer par https://calendly.com/ ou https://cal.com/",
      )
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/profile/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendly_url: trimmed || undefined }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string | { message?: string }
        }
        const msg =
          typeof data.error === 'string'
            ? data.error
            : data.error?.message ?? 'Erreur lors de la sauvegarde'
        throw new Error(msg)
      }
      setStatus('success')
      router.refresh()
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      aria-labelledby="calendly-title"
      className="rounded-xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-md shadow-sm"
    >
      <div className="border-b border-white/[0.06] px-6 py-4">
        <h2
          id="calendly-title"
          className="text-xs font-semibold uppercase tracking-widest text-gray-400"
        >
          Lien de prise de RDV
        </h2>
      </div>

      <form onSubmit={handleSave} className="space-y-3 px-6 py-5">
        <p className="text-sm text-gray-300">
          URL Calendly ou Cal.com — injectée dans les templates email
          (variable <code className="text-green-400">{'{{calendly_url}}'}</code>).
        </p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://calendly.com/ton-nom/30min"
            maxLength={300}
            aria-invalid={!isValid}
            aria-describedby={!isValid ? 'calendly-error' : undefined}
            className={`flex-1 rounded-lg border bg-white/[0.04] backdrop-blur-md px-3 py-2.5 text-sm text-white placeholder:text-gray-400 transition focus:outline-none focus:ring-2 ${
              isValid
                ? 'border-white/[0.08] focus:border-green-500 focus:ring-green-500/20'
                : 'border-red-500/40 focus:border-red-500 focus:ring-red-500/20'
            }`}
          />

          {trimmed && isValid && (
            <a
              href={trimmed}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-sm font-medium text-gray-200 transition-colors hover:bg-white/[0.06]"
            >
              Tester
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
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

          <button
            type="submit"
            disabled={saving || !isValid}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>

        {!isValid && trimmed && (
          <p
            id="calendly-error"
            role="alert"
            className="text-sm text-red-300"
          >
            L&rsquo;URL doit commencer par <code>https://calendly.com/</code> ou{' '}
            <code>https://cal.com/</code>.
          </p>
        )}

        {status === 'success' && (
          <p role="status" className="text-sm text-green-300">
            Lien sauvegardé.
          </p>
        )}

        {status === 'error' && errorMsg && (
          <p role="alert" className="text-sm text-red-300">
            {errorMsg}
          </p>
        )}
      </form>
    </section>
  )
}
