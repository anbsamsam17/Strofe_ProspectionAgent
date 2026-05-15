'use client'

// ============================================================
// ProspectCard3D — wrapper de carte avec tilt 3D au hover
//
// Variante allégée de MagicCard (pas de spotlight) — destinée aux cartes
// du Kanban pipeline qui sont nombreuses et doivent rester perf.
// ============================================================

import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react'

interface ProspectCard3DProps extends HTMLAttributes<HTMLDivElement> {
  /** Intensité max du tilt en degrés. Défaut 2 (plus subtil que MagicCard). */
  tilt?: number
  children: ReactNode
}

export function ProspectCard3D({
  tilt = 2,
  className = '',
  children,
  ...rest
}: ProspectCard3DProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const node = el

    function onMove(e: MouseEvent) {
      const rect = node.getBoundingClientRect()
      const dx = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2)
      const dy = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2)

      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          node.style.transform = `perspective(800px) rotateY(${dx * tilt}deg) rotateX(${-dy * tilt}deg) translateY(-1px)`
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

  return (
    <div
      ref={ref}
      className={`transition-[transform,box-shadow] duration-150 will-change-transform ${className}`}
      style={{ transformStyle: 'preserve-3d' }}
      {...rest}
    >
      {children}
    </div>
  )
}
