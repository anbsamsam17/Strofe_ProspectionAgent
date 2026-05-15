'use client'

// ============================================================
// GlanPortrait — Avatar Glan basé sur un portrait haute-qualité
// (style Pixar/Memoji pro, costume gris, design fourni par utilisateur).
//
// Le PNG (statique, fidèle au design) est entouré d'une **frame
// holographique animée** qui change d'ambiance par état :
//
//   - dormant : halo bleu doux, particules lentes, anneau respirant
//   - working : halo vert + cyan, scan-line tournant, particules orbitales
//   - done    : halo doré, sparkles, glow flash
//   - error   : halo rouge atténué, micro-tremblement, anneau pulsant
//
// Le portrait suit le curseur (parallax tilt ±6°) sauf si
// prefers-reduced-motion ou prop `interactive={false}`.
//
// PNG attendu dans public/glan/ :
//   - portrait.png                (neutre, requis)
//   - portrait-working.png        (optionnel — fallback portrait.png)
//   - portrait-done.png           (optionnel)
//   - portrait-error.png          (optionnel)
// ============================================================

import { useEffect, useRef, useState, useMemo } from 'react'
import Image from 'next/image'
import { m, useReducedMotion } from 'motion/react'

export type GlanPortraitState = 'dormant' | 'working' | 'done' | 'error'

interface GlanPortraitProps {
  state?: GlanPortraitState
  /** Diamètre carré px. Défaut 320. */
  size?: number
  /** Active le tilt parallax au curseur. Défaut true. */
  interactive?: boolean
  /** Affiche le label "Lancer Glan" / "Glan travaille" en bas. Défaut false. */
  showLabel?: boolean
  className?: string
}

const STATE_PALETTE: Record<
  GlanPortraitState,
  {
    glow: string
    ring: string
    accent: string
    accentSoft: string
    label: string
  }
> = {
  dormant: {
    glow: 'oklch(60% 0.12 240 / 0.35)',
    ring: 'oklch(60% 0.10 240 / 0.4)',
    accent: '#7aa7ff',
    accentSoft: 'oklch(60% 0.12 240 / 0.15)',
    label: 'Glan au repos',
  },
  working: {
    glow: 'oklch(70% 0.19 152 / 0.55)',
    ring: 'oklch(70% 0.19 152 / 0.55)',
    accent: '#22c55e',
    accentSoft: 'oklch(70% 0.19 152 / 0.2)',
    label: 'Glan travaille',
  },
  done: {
    glow: 'oklch(82% 0.15 88 / 0.6)',
    ring: 'oklch(82% 0.15 88 / 0.55)',
    accent: '#eab308',
    accentSoft: 'oklch(82% 0.15 88 / 0.2)',
    label: 'Glan a terminé',
  },
  error: {
    glow: 'oklch(65% 0.20 27 / 0.5)',
    ring: 'oklch(65% 0.20 27 / 0.5)',
    accent: '#ef4444',
    accentSoft: 'oklch(65% 0.20 27 / 0.15)',
    label: 'Glan a rencontré une erreur',
  },
}

const STATE_IMAGE_FILE: Record<GlanPortraitState, string> = {
  dormant: '/glan/portrait.png',
  working: '/glan/portrait-working.png',
  done: '/glan/portrait-done.png',
  error: '/glan/portrait-error.png',
}

const PARTICLE_COUNT = 14

interface Particle {
  angle: number
  radius: number
  size: number
  duration: number
  delay: number
}

function buildParticles(seed: number): Particle[] {
  // PRNG déterministe (mulberry32) pour SSR-stable.
  let t = seed >>> 0
  function rand(): number {
    t += 0x6d2b79f5
    let r = t
    r = Math.imul(r ^ (r >>> 15), r | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    angle: rand() * 360,
    radius: 44 + rand() * 8, // % du diamètre
    size: 2 + rand() * 3,
    duration: 6 + rand() * 6,
    delay: -rand() * 8,
  }))
}

export function GlanPortrait({
  state = 'dormant',
  size = 320,
  interactive = true,
  showLabel = false,
  className = '',
}: GlanPortraitProps) {
  const prefersReducedMotion = useReducedMotion()
  const palette = STATE_PALETTE[state]
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [tilt, setTilt] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [imgSrc, setImgSrc] = useState<string>(STATE_IMAGE_FILE[state])
  const particles = useMemo(() => buildParticles(state.length * 13 + size), [state, size])

  // Fallback : si l'image dédiée n'existe pas (404), retombe sur portrait.png.
  useEffect(() => {
    setImgSrc(STATE_IMAGE_FILE[state])
  }, [state])

  const enableTilt = interactive && !prefersReducedMotion

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!enableTilt || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = (e.clientX - cx) / (rect.width / 2)
    const dy = (e.clientY - cy) / (rect.height / 2)
    // ±6° max
    setTilt({ x: -dy * 6, y: dx * 6 })
  }

  function handlePointerLeave() {
    setTilt({ x: 0, y: 0 })
  }

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={`relative inline-block select-none ${className}`}
      style={{ width: size, height: size, perspective: 1200 }}
      role="img"
      aria-label={palette.label}
    >
      {/* ── Halo externe (radial gradient, blur, anime sur état) ─────────── */}
      <m.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full blur-2xl"
        style={{
          background: `radial-gradient(circle at center, ${palette.glow} 0%, transparent 70%)`,
        }}
        animate={
          prefersReducedMotion
            ? undefined
            : {
                scale: state === 'done' ? [1, 1.18, 1] : [1, 1.08, 1],
                opacity: state === 'dormant' ? [0.6, 0.9, 0.6] : [0.85, 1, 0.85],
              }
        }
        transition={{
          duration: state === 'working' ? 2.2 : state === 'done' ? 1.4 : 4,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* ── Ring conique animé (rotation lente, accent par état) ─────────── */}
      <m.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-1 rounded-full"
        style={{
          background: `conic-gradient(from 0deg, transparent 0deg, ${palette.ring} 60deg, transparent 120deg, transparent 240deg, ${palette.ring} 300deg, transparent 360deg)`,
          mask: 'radial-gradient(circle, transparent 60%, black 62%, black 64%, transparent 66%)',
          WebkitMask:
            'radial-gradient(circle, transparent 60%, black 62%, black 64%, transparent 66%)',
        }}
        animate={
          prefersReducedMotion
            ? undefined
            : { rotate: state === 'error' ? [-2, 2, -2] : [0, 360] }
        }
        transition={{
          duration: state === 'working' ? 4 : state === 'error' ? 0.2 : 14,
          repeat: Infinity,
          ease: state === 'error' ? 'easeInOut' : 'linear',
        }}
      />

      {/* ── Scan-line cyan (working uniquement) ─────────────────────────── */}
      {state === 'working' && !prefersReducedMotion && (
        <m.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-2 overflow-hidden rounded-full"
          style={{
            background: `linear-gradient(180deg, transparent 0%, ${palette.accentSoft} 48%, ${palette.accent} 50%, ${palette.accentSoft} 52%, transparent 100%)`,
            mixBlendMode: 'screen',
            opacity: 0.7,
          }}
          animate={{ y: ['-100%', '100%'] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
        />
      )}

      {/* ── Portrait (tilt parallax + frame holo) ────────────────────────── */}
      <m.div
        className="relative h-full w-full rounded-full"
        style={{
          transformStyle: 'preserve-3d',
          boxShadow: `0 0 ${size * 0.12}px ${palette.glow}, inset 0 0 0 2px ${palette.ring}, inset 0 0 0 1px rgba(255,255,255,0.08)`,
        }}
        animate={{ rotateX: tilt.x, rotateY: tilt.y }}
        transition={{ type: 'spring', stiffness: 140, damping: 18 }}
      >
        {/* Frame circulaire (border + inner shadow) */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background: `radial-gradient(circle at 30% 25%, rgba(255,255,255,0.06) 0%, transparent 45%), radial-gradient(circle at 70% 80%, ${palette.accentSoft} 0%, transparent 50%)`,
          }}
        />

        {/* Image portrait clipée en cercle */}
        <div
          className="relative h-full w-full overflow-hidden rounded-full"
          style={{
            background: 'oklch(18% 0.025 240)',
          }}
        >
          <Image
            src={imgSrc}
            alt=""
            aria-hidden="true"
            width={size}
            height={size}
            priority={state === 'working' || state === 'done'}
            onError={() => {
              if (imgSrc !== STATE_IMAGE_FILE.dormant) {
                setImgSrc(STATE_IMAGE_FILE.dormant)
              }
            }}
            className="h-full w-full object-cover"
            style={{
              filter:
                state === 'error'
                  ? 'saturate(0.7) brightness(0.85)'
                  : state === 'dormant'
                    ? 'saturate(0.85) brightness(0.95)'
                    : 'saturate(1.05) brightness(1.02)',
            }}
          />

          {/* Tint overlay coloré subtile */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 mix-blend-overlay"
            style={{
              background: `radial-gradient(circle at center, transparent 40%, ${palette.accentSoft} 100%)`,
            }}
          />
        </div>

        {/* Highlight diagonal (effet glass top-left) */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 35%)',
          }}
        />
      </m.div>

      {/* ── Particules orbitales (CSS keyframes) ────────────────────────── */}
      {!prefersReducedMotion && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ transform: 'translateZ(0)' }}
        >
          {particles.map((p, i) => (
            <span
              key={i}
              className="glan-portrait-particle absolute left-1/2 top-1/2 rounded-full"
              style={
                {
                  width: `${p.size}px`,
                  height: `${p.size}px`,
                  background: palette.accent,
                  boxShadow: `0 0 ${p.size * 3}px ${palette.accent}`,
                  ['--glan-radius' as never]: `${p.radius}%`,
                  ['--glan-angle' as never]: `${p.angle}deg`,
                  animationDuration: `${state === 'working' ? p.duration * 0.6 : p.duration}s`,
                  animationDelay: `${p.delay}s`,
                  opacity: state === 'dormant' ? 0.45 : state === 'error' ? 0.5 : 0.85,
                } as React.CSSProperties
              }
            />
          ))}
        </span>
      )}

      {/* ── Indicateur état (pastille en bas-droite) ────────────────────── */}
      <span
        aria-hidden="true"
        className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-black/40"
        style={{ background: palette.accent }}
      >
        {state === 'working' && (
          <span
            className="absolute inset-0 animate-ping rounded-full"
            style={{ background: palette.accent, opacity: 0.6 }}
          />
        )}
      </span>

      {/* Label optionnel sous l'avatar */}
      {showLabel && (
        <p
          className="absolute -bottom-7 left-0 right-0 text-center font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{ color: palette.accent }}
        >
          {`// ${palette.label}`}
        </p>
      )}
    </div>
  )
}

export default GlanPortrait
