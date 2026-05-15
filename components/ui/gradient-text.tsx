// ============================================================
// GradientText — texte en gradient brand (vert → emerald)
//
// Optionnellement animé via la classe `animate-gradient` (cf. globals.css).
// Utiliser sur les titres de section, hero landing.
// ============================================================

import type { HTMLAttributes } from 'react'

interface GradientTextProps extends HTMLAttributes<HTMLSpanElement> {
  animate?: boolean
}

export function GradientText({
  animate = false,
  className = '',
  children,
  ...rest
}: GradientTextProps) {
  return (
    <span
      className={`bg-gradient-to-r from-green-400 via-emerald-300 to-green-500 bg-clip-text text-transparent ${animate ? 'animate-gradient' : ''} ${className}`}
      {...rest}
    >
      {children}
    </span>
  )
}
