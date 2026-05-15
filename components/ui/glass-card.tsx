// ============================================================
// GlassCard — wrapper de carte avec effet glassmorphism
//
// Surface translucide + blur + bordure subtile. Dark navy en dark mode.
// Server Component (pas d'état) — utilisable partout.
//
// Variantes :
//   - default : fond surface-glass standard
//   - elevated : ombre lift en plus
//   - outlined : pas de fond, juste la bordure
// ============================================================

import type { HTMLAttributes } from 'react'

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'outlined'
  /** Si true, padding interne par défaut (p-5). Sinon padding au consommateur. */
  padded?: boolean
}

const VARIANT_CLASSES: Record<NonNullable<GlassCardProps['variant']>, string> = {
  default:
    'bg-white/70 backdrop-blur-md border border-gray-200/60 dark:bg-white/5 dark:border-white/10',
  elevated:
    'bg-white/80 backdrop-blur-md border border-gray-200/60 shadow-lg shadow-black/5 dark:bg-white/5 dark:border-white/10 dark:shadow-black/40',
  outlined:
    'bg-transparent backdrop-blur-sm border border-white/[0.08] dark:border-white/10',
}

export function GlassCard({
  variant = 'default',
  padded = true,
  className = '',
  children,
  ...rest
}: GlassCardProps) {
  return (
    <div
      className={`rounded-2xl ${VARIANT_CLASSES[variant]} ${padded ? 'p-5' : ''} ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}
