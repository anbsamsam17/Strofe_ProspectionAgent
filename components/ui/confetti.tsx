'use client'

// ============================================================
// Confetti — petites particules pour célébrer une conversion
//
// 60 particules SVG en 4 couleurs (brand, gold, indigo, emerald),
// chute libre + rotation. ~2s de durée totale.
// Respect strict prefers-reduced-motion (ne rend rien).
//
// Usage : déclencher programmatiquement via le composant monté + isShown=true,
// ou via un context global (à venir).
// ============================================================

import { useEffect, useMemo, useState } from 'react'

interface ConfettiProps {
  /** Si true, lance l'animation pendant ~2s puis se désactive. */
  trigger: boolean
  /** Nombre de particules. Défaut 60. */
  count?: number
}

const COLORS = [
  'oklch(69% 0.19 152)', // brand
  'oklch(82% 0.13 88)', // gold
  'oklch(64% 0.19 256)', // info
  'oklch(75% 0.13 75)', // amber
]

interface Particle {
  id: number
  left: number // %
  delay: number // ms
  duration: number // ms
  rotate: number // deg
  color: string
  size: number // px
}

function makeParticles(count: number): Particle[] {
  return Array.from({ length: count }).map((_, id) => ({
    id,
    left: Math.random() * 100,
    delay: Math.random() * 300,
    duration: 1500 + Math.random() * 1000,
    rotate: Math.random() * 720 - 360,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    size: 6 + Math.random() * 6,
  }))
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function Confetti({ trigger, count = 60 }: ConfettiProps) {
  const [isActive, setIsActive] = useState(false)
  const particles = useMemo(() => makeParticles(count), [count])

  useEffect(() => {
    if (!trigger) return
    if (prefersReducedMotion()) return
    setIsActive(true)
    const id = setTimeout(() => setIsActive(false), 2400)
    return () => clearTimeout(id)
  }, [trigger])

  if (!isActive) return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[60] overflow-hidden"
    >
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute top-0 block rounded-sm"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.4,
            background: p.color,
            animation: `confetti-fall ${p.duration}ms cubic-bezier(0.22, 1, 0.36, 1) ${p.delay}ms forwards`,
            // @ts-expect-error : transform inline pour rotation initial
            '--confetti-rotate': `${p.rotate}deg`,
          }}
        />
      ))}
      {/* Keyframes inline pour éviter d'alourdir globals.css (animation usage rare) */}
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translate3d(0, -10vh, 0) rotate(0deg); opacity: 1; }
          80% { opacity: 1; }
          100% { transform: translate3d(0, 110vh, 0) rotate(var(--confetti-rotate, 360deg)); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
