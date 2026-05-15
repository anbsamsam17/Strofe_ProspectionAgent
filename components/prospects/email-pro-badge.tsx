// ============================================================
// EmailProBadge — indicateur pro / perso / vérifié pour un email
//
// Pure presentational (Server Component).
//   - isPro=true, verified=true  → "✓ Email pro vérifié" (vert)
//   - isPro=true, verified=false → "Email pro non vérifié" (cyan)
//   - isPro=false                → "Email perso non envoyable" (gray italic)
//   - isPro=null/undefined       → ne rend rien
// ============================================================

import type { JSX } from 'react'

interface EmailProBadgeProps {
  isPro: boolean | null | undefined
  verified?: boolean
  className?: string
}

interface BadgeVariant {
  label: string
  ariaLabel: string
  classes: string
  italic?: boolean
}

function resolveVariant(
  isPro: boolean,
  verified: boolean | undefined,
): BadgeVariant {
  if (isPro) {
    if (verified) {
      return {
        label: '✓ Email pro vérifié',
        ariaLabel: 'Email professionnel vérifié et envoyable',
        classes: 'bg-green-500/15 text-green-200 ring-green-500/25',
      }
    }
    return {
      label: 'Email pro non vérifié',
      ariaLabel: 'Email professionnel non vérifié — à confirmer avant envoi',
      classes: 'bg-cyan-500/15 text-cyan-200 ring-cyan-500/25',
    }
  }
  return {
    label: 'Email perso non envoyable',
    ariaLabel:
      'Email personnel détecté — non envoyable depuis l\'application',
    classes: 'bg-white/[0.05] text-gray-400 ring-white/[0.1]',
    italic: true,
  }
}

export function EmailProBadge({
  isPro,
  verified,
  className = '',
}: EmailProBadgeProps): JSX.Element | null {
  if (isPro === null || isPro === undefined) return null

  const variant = resolveVariant(isPro, verified)
  const italicClass = variant.italic ? ' italic' : ''

  return (
    <span
      aria-label={variant.ariaLabel}
      title={variant.ariaLabel}
      data-pro={isPro ? 'true' : 'false'}
      data-verified={verified ? 'true' : 'false'}
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ring-1 ${variant.classes}${italicClass} ${className}`.trim()}
    >
      {variant.label}
    </span>
  )
}
