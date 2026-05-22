'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState } from 'react'

/**
 * Sprint 3 retour client #8 — Conserver les filtres au retour vers /prospects.
 *
 * Probleme : un simple <Link href="/prospects"> dans le header de la fiche
 * perdait tous les ?statut=...&secteur=...&q=... que l'utilisateur avait
 * appliques avant de cliquer sur un prospect.
 *
 * Solution : un Client Component qui utilise `router.back()` si l'historique
 * contient une entree precedente (cas standard : user a clique sur la fiche
 * depuis la liste). Cela restaure exactement l'URL d'origine cote browser,
 * y compris tous les SearchParams, et conserve aussi le scroll position.
 *
 * Fallback `<Link>` si pas d'historique navigable (arrivee directe sur la
 * fiche via partage URL, ouverture nouvel onglet) : navigation standard SSR.
 */
export function BackToProspectsLink({
  className,
  ariaLabel,
  children,
}: {
  className?: string
  ariaLabel?: string
  children: React.ReactNode
}) {
  const router = useRouter()
  // `hasHistory` controle si on peut utiliser router.back() en toute securite.
  // `window.history.length > 1` n'est pas toujours fiable (sessions partagees),
  // mais c'est la meilleure heuristique cote client sans tracker custom.
  const [hasHistory, setHasHistory] = useState(false)

  useEffect(() => {
    setHasHistory(typeof window !== 'undefined' && window.history.length > 1)
  }, [])

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!hasHistory) return // laisser le <Link> faire sa navigation standard
    e.preventDefault()
    router.back()
  }

  return (
    <Link
      href="/prospects"
      onClick={handleClick}
      className={className}
      aria-label={ariaLabel}
    >
      {children}
    </Link>
  )
}
