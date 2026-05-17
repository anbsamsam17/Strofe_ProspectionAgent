'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Bouton de déconnexion intégré à la section "Mon compte" de /settings.
 * Comportement aligné sur le bouton de la sidebar : signOut() puis redirect /login.
 *
 * Garde un `isLoading` local pour éviter le double-click (anti-doublon).
 */
export function LogoutButton() {
  const router = useRouter()
  const supabase = createClient()
  const [isLoading, setIsLoading] = useState(false)

  async function handleLogout() {
    if (isLoading) return
    setIsLoading(true)
    try {
      await supabase.auth.signOut()
      router.push('/login')
      router.refresh()
    } finally {
      // Garde le bouton désactivé jusqu'à la redirection effective.
      // Si la redirection échoue, on relâche pour permettre un retry.
      setIsLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isLoading}
      aria-label="Se déconnecter"
      className="inline-flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3.5 py-2 text-sm font-medium text-red-300 transition hover:border-red-500/40 hover:bg-red-500/[0.12] hover:text-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      {isLoading ? 'Déconnexion…' : 'Se déconnecter'}
    </button>
  )
}
