'use client'

// ============================================================
// ScrollReveal — wrapper de section qui révèle au scroll
//
// Bascule de `opacity-0 translate-y-6` vers `opacity-100 translate-y-0`
// quand la section entre dans le viewport (one-shot via IntersectionObserver).
// Respecte prefers-reduced-motion : affiche immédiatement en pleine opacité.
// ============================================================

import { useEffect, useState, type ReactNode } from 'react'
import { useInView } from '@/lib/hooks/use-in-view'

interface ScrollRevealProps {
  /** Délai d'apparition en ms (utile pour stagger d'une grille). Défaut 0. */
  delay?: number
  className?: string
  children: ReactNode
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function ScrollReveal({
  delay = 0,
  className = '',
  children,
}: ScrollRevealProps) {
  const { ref, inView } = useInView<HTMLDivElement>()
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    setReduced(prefersReducedMotion())
  }, [])

  const visible = reduced || inView

  return (
    <div
      ref={ref}
      style={visible && delay > 0 ? { transitionDelay: `${delay}ms` } : undefined}
      className={`transition-all duration-700 ease-out ${
        visible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-6'
      } ${className}`}
    >
      {children}
    </div>
  )
}
