'use client'

// ============================================================
// useInView — hook IntersectionObserver minimal pour scroll-reveal
//
// Détecte si un élément est entré dans le viewport. Une fois révélé,
// le hook reste "in view" (one-shot) pour éviter les flickers au scroll.
// SSR-safe : retourne false initialement (les sections passent par
// "opacity-0 translate-y-6" jusqu'à révélation côté client).
// ============================================================

import { useEffect, useRef, useState, type RefObject } from 'react'

interface UseInViewOptions {
  /** Marge autour du root pour anticiper la révélation. Défaut '0px 0px -80px 0px'. */
  rootMargin?: string
  /** Seuil de visibilité 0-1. Défaut 0.1. */
  threshold?: number
  /** Si true, déclenche une seule fois puis se déconnecte. Défaut true. */
  once?: boolean
}

export function useInView<T extends Element>(
  options: UseInViewOptions = {},
): { ref: RefObject<T | null>; inView: boolean } {
  const { rootMargin = '0px 0px -80px 0px', threshold = 0.1, once = true } = options
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    // Fallback navigateurs sans IntersectionObserver — affiche tout.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true)
            if (once) observer.disconnect()
          } else if (!once) {
            setInView(false)
          }
        }
      },
      { rootMargin, threshold },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [rootMargin, threshold, once])

  return { ref, inView }
}
