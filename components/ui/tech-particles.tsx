'use client'

// ============================================================
// TechParticles — particules flottantes ambient (tech vibe)
//
// 24 petits points lumineux qui montent du bas vers le haut sur des
// trajectoires aléatoires. Couches multiples pour profondeur.
// Pure CSS animation (keyframe tech-particle-float dans globals.css).
//
// À monter en `position: fixed inset-0 pointer-events-none z-0` dans le
// root layout pour effet permanent. Désactivé via prefers-reduced-motion
// au niveau du media query global de globals.css.
// ============================================================

import { useMemo } from 'react'

interface TechParticlesProps {
  /** Nombre de particules à rendre. Défaut 24 (équilibre perf / densité). */
  count?: number
  className?: string
}

interface Particle {
  id: number
  left: number // %
  delay: number // s
  duration: number // s
  size: number // px
  color: string
  blur: number // px
}

const COLORS = [
  'oklch(75% 0.15 152)', // green brand
  'oklch(72% 0.16 188)', // cyan
  'oklch(70% 0.18 285)', // violet
  'oklch(85% 0.10 220)', // pale blue
]

function makeParticles(count: number): Particle[] {
  const seed = 7919 // déterministe pour éviter le hydration mismatch
  return Array.from({ length: count }).map((_, id) => {
    const r1 = ((seed * (id + 1)) % 997) / 997
    const r2 = ((seed * (id + 13)) % 1009) / 1009
    const r3 = ((seed * (id + 37)) % 1013) / 1013
    const r4 = ((seed * (id + 71)) % 1019) / 1019
    return {
      id,
      left: r1 * 100,
      delay: r2 * -20, // démarrent à des phases aléatoires
      duration: 18 + r3 * 22, // 18-40s par particule
      size: 1.5 + r4 * 3, // 1.5-4.5 px
      color: COLORS[Math.floor(r2 * COLORS.length) % COLORS.length],
      blur: r3 > 0.7 ? 1 : 0,
    }
  })
}

export function TechParticles({ count = 24, className = '' }: TechParticlesProps) {
  const particles = useMemo(() => makeParticles(count), [count])

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 z-0 overflow-hidden ${className}`}
    >
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute bottom-0 block rounded-full"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            background: p.color,
            boxShadow: `0 0 ${p.size * 3}px ${p.color}`,
            filter: p.blur > 0 ? `blur(${p.blur}px)` : undefined,
            animation: `tech-particle-float ${p.duration}s linear ${p.delay}s infinite`,
            willChange: 'transform, opacity',
          }}
        />
      ))}
    </div>
  )
}
