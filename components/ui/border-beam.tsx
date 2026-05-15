// ============================================================
// BorderBeam — anneau lumineux rotatif autour d'un élément
//
// Sert à signaler un état actif (bouton "Lancer l'agent" pendant un run,
// GlanStatusBar en working). Animation CSS pure via @keyframes border-beam
// (cf. globals.css).
//
// Server Component — pas de JS d'animation.
// ============================================================

import type { HTMLAttributes, ReactNode } from 'react'

interface BorderBeamProps extends HTMLAttributes<HTMLDivElement> {
  /** Couleur du beam — var CSS. Défaut brand. */
  color?: 'brand' | 'amber' | 'gold' | 'danger'
  /** Largeur du beam. Défaut 1.5px. */
  thickness?: number
  /** Si true, désactive l'animation (utile pour preview). */
  paused?: boolean
  children: ReactNode
}

const COLOR_GRADIENT: Record<NonNullable<BorderBeamProps['color']>, string> = {
  brand:
    'conic-gradient(from var(--angle, 0deg), transparent 0%, oklch(69% 0.19 152) 50%, transparent 100%)',
  amber:
    'conic-gradient(from var(--angle, 0deg), transparent 0%, oklch(78% 0.15 75) 50%, transparent 100%)',
  gold:
    'conic-gradient(from var(--angle, 0deg), transparent 0%, oklch(82% 0.13 88) 50%, transparent 100%)',
  danger:
    'conic-gradient(from var(--angle, 0deg), transparent 0%, oklch(62% 0.22 27) 50%, transparent 100%)',
}

export function BorderBeam({
  color = 'brand',
  thickness = 1.5,
  paused = false,
  className = '',
  children,
  ...rest
}: BorderBeamProps) {
  return (
    <div
      className={`relative rounded-2xl ${className}`}
      {...rest}
    >
      {/* Beam ring — positionné derrière le contenu, mask via padding négatif */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 rounded-2xl ${paused ? '' : 'animate-border-beam'}`}
        style={{
          padding: thickness,
          background: COLOR_GRADIENT[color],
          WebkitMask:
            'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
        }}
      />
      <div className="relative">{children}</div>
    </div>
  )
}
