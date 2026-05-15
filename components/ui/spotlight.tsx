'use client'

// ============================================================
// Spotlight — radial gradient qui suit le curseur
//
// Wrapper qui ajoute une lumière interactive sur ses enfants.
// Throttlé via requestAnimationFrame, écrit directement les variables CSS
// sur le DOM pour éviter le re-render React à chaque mouseMove.
// ============================================================

import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react'

interface SpotlightProps extends HTMLAttributes<HTMLDivElement> {
  /** Couleur du spotlight en CSS. Défaut : var(--brand-glow). */
  color?: string
  /** Rayon du spotlight en pixels. Défaut 200. */
  radius?: number
  children: ReactNode
}

export function Spotlight({
  color = 'var(--brand-glow)',
  radius = 200,
  className = '',
  children,
  ...rest
}: SpotlightProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const targetRef = useRef<{ x: number; y: number }>({ x: -1000, y: -1000 })

  useEffect(() => {
    const el: HTMLDivElement | null = containerRef.current
    if (!el) return
    const node: HTMLDivElement = el

    function onMove(e: MouseEvent) {
      const rect = node.getBoundingClientRect()
      targetRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          node.style.setProperty('--spotlight-x', `${targetRef.current.x}px`)
          node.style.setProperty('--spotlight-y', `${targetRef.current.y}px`)
          rafRef.current = null
        })
      }
    }

    function onLeave() {
      node.style.setProperty('--spotlight-x', '-1000px')
      node.style.setProperty('--spotlight-y', '-1000px')
    }

    node.addEventListener('mousemove', onMove)
    node.addEventListener('mouseleave', onLeave)
    return () => {
      node.removeEventListener('mousemove', onMove)
      node.removeEventListener('mouseleave', onLeave)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      style={
        {
          '--spotlight-x': '-1000px',
          '--spotlight-y': '-1000px',
        } as React.CSSProperties
      }
      {...rest}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          background: `radial-gradient(${radius}px circle at var(--spotlight-x) var(--spotlight-y), ${color}, transparent 70%)`,
        }}
      />
      <div className="relative">{children}</div>
    </div>
  )
}
