'use client'

// ============================================================
// AnimatedCounter — chiffre animé de 0 à `value` au montage
//
// Animation `easeOutExpo` sur 800ms (--duration-counter).
// Respecte prefers-reduced-motion (saute directement à la valeur cible).
// ============================================================

import { useEffect, useRef, useState } from 'react'

interface AnimatedCounterProps {
  value: number
  /** Durée de l'animation en ms. Défaut 800 (--duration-counter). */
  duration?: number
  /** Nombre de décimales à afficher. Défaut 0. */
  decimals?: number
  /** Formatter Intl.NumberFormat. Défaut FR séparateurs milliers. */
  format?: (n: number) => string
  className?: string
}

const DEFAULT_FORMAT = new Intl.NumberFormat('fr-FR').format

function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function AnimatedCounter({
  value,
  duration = 800,
  decimals = 0,
  format,
  className = '',
}: AnimatedCounterProps) {
  const [display, setDisplay] = useState(value)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplay(value)
      return
    }

    const from = 0
    const to = value
    startRef.current = null

    function step(now: number) {
      if (startRef.current === null) startRef.current = now
      const elapsed = now - startRef.current
      const t = Math.min(elapsed / duration, 1)
      const eased = easeOutExpo(t)
      setDisplay(from + (to - from) * eased)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        setDisplay(to)
      }
    }

    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [value, duration])

  const rounded =
    decimals === 0 ? Math.round(display) : Number(display.toFixed(decimals))
  const text = (format ?? DEFAULT_FORMAT)(rounded)

  return (
    <span className={`tabular-nums ${className}`} aria-label={`${text}`}>
      {text}
    </span>
  )
}
