'use client'

// ============================================================
// CopyEmailButton — petit bouton "copier l'email dans le presse-papier"
// Retour client Sprint 3 #4. Feedback inline ephémère (icône check + "Copié")
// pendant 3s — pas de toast global pour éviter de monter un ToastProvider
// juste pour ça (cf. pattern enrich-contact-button.tsx).
// ============================================================

import { useEffect, useRef, useState } from 'react'

interface CopyEmailButtonProps {
  email: string
}

export function CopyEmailButton({ email }: CopyEmailButtonProps) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  async function handleCopy() {
    // Reset previous state.
    setFailed(false)
    setCopied(false)

    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(email)
        setCopied(true)
      } else {
        // Fallback rudimentaire : <textarea> + execCommand (vieux navigateurs,
        // contextes non sécurisés). Best-effort uniquement.
        const ta = document.createElement('textarea')
        ta.value = email
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (ok) setCopied(true)
        else setFailed(true)
      }
    } catch {
      setFailed(true)
    }

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setCopied(false)
      setFailed(false)
    }, 3000)
  }

  const ariaLabel = copied
    ? `Email copié : ${email}`
    : failed
      ? `Échec de la copie de l'email ${email}`
      : `Copier l'email ${email}`

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={ariaLabel}
      title={copied ? 'Email copié' : failed ? 'Copie impossible' : "Copier l'email"}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 ${
        copied
          ? 'bg-green-500/15 text-green-200 ring-1 ring-green-500/25'
          : failed
            ? 'bg-red-500/15 text-red-200 ring-1 ring-red-500/25'
            : 'bg-white/[0.04] text-gray-300 ring-1 ring-white/[0.08] hover:bg-white/[0.08] hover:text-white'
      }`}
    >
      {copied ? (
        <>
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
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>Copié</span>
        </>
      ) : (
        <>
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
          <span className="sr-only">Copier</span>
        </>
      )}
    </button>
  )
}
