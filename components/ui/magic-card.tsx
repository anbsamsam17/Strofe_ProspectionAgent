'use client'

// ============================================================
// MagicCard — carte interactive avec Spotlight + tilt 3D au hover
//
// Combine :
//   - Spotlight qui suit le curseur (radial gradient brand)
//   - Tilt 3D subtil (perspective(800px) rotate ±3deg)
//   - Lift léger au hover (translate-y -2px)
//
// Le tilt est désactivé en touch device (pas de hover) et respecte
// prefers-reduced-motion via globals.css.
// ============================================================

import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react'
import { Spotlight } from './spotlight'

interface MagicCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Intensité max du tilt en degrés. Défaut 3. */
  tilt?: number
  /** Si false, désactive le spotlight (mais garde le tilt). */
  spotlight?: boolean
  children: ReactNode
}

export function MagicCard({
  tilt = 3,
  spotlight = true,
  className = '',
  children,
  ...rest
}: MagicCardProps) {
  const innerRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    const node = el

    function onMove(e: MouseEvent) {
      const rect = node.getBoundingClientRect()
      const cx = rect.width / 2
      const cy = rect.height / 2
      const dx = (e.clientX - rect.left - cx) / cx
      const dy = (e.clientY - rect.top - cy) / cy

      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          node.style.transform = `perspective(800px) rotateY(${dx * tilt}deg) rotateX(${-dy * tilt}deg) translateY(-2px)`
          rafRef.current = null
        })
      }
    }

    function onLeave() {
      node.style.transform = ''
    }

    node.addEventListener('mousemove', onMove)
    node.addEventListener('mouseleave', onLeave)
    return () => {
      node.removeEventListener('mousemove', onMove)
      node.removeEventListener('mouseleave', onLeave)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [tilt])

  const card = (
    <div
      ref={innerRef}
      className={`rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-[transform,box-shadow] duration-200 will-change-transform hover:shadow-md dark:border-gray-800 dark:bg-gray-900 ${className}`}
      style={{ transformStyle: 'preserve-3d' }}
      {...rest}
    >
      {children}
    </div>
  )

  if (!spotlight) return card

  return <Spotlight className="rounded-2xl">{card}</Spotlight>
}
