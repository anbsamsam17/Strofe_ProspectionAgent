// ============================================================
// ContactEmailStatusBadge — badge couleur + score Hunter
// ------------------------------------------------------------
// Ticket : GLN-062 (verification email + score confiance Hunter)
//
// Pure presentational (Server-safe). Rend un badge selon le statut Hunter
// persisté en base (`prospect_contacts.email_status`) + score optionnel
// (`email_confidence`).
//
// Mapping :
//   - valid                → vert,    affiche le score (ex. "Valide · 92")
//   - accept_all / catchall → orange, affiche le score (catchall)
//   - invalid / disposable → rouge,  pas de score (verdict ferme)
//   - webmail              → gris,   "Email perso" (pas envoyable pro)
//   - unverified / null    → gris pointillé, "Non vérifié"
//   - unknown / autre      → gris,   "Indéterminé"
//
// Accessibilité : aria-label + title explicites pour chaque variante.
// ============================================================

import type { JSX } from 'react'

// ------------------------------------------------------------
// TYPES
// ------------------------------------------------------------

interface ContactEmailStatusBadgeProps {
  /** Statut Hunter persisté en base (peut être null = jamais vérifié). */
  status: string | null | undefined
  /** Score 0-100 Hunter (peut être null si pas de vérif ou statut sans score). */
  score?: number | null | undefined
  className?: string
}

interface BadgeVariant {
  label: string
  ariaLabel: string
  classes: string
  showScore: boolean
  dashed?: boolean
}

// ------------------------------------------------------------
// RÉSOLUTION DU VARIANT
// ------------------------------------------------------------

/**
 * Résout le variant visuel selon le statut. Exposé pour faciliter les tests.
 */
export function resolveBadgeVariant(status: string | null | undefined): BadgeVariant {
  const s = (status ?? '').toLowerCase().trim()

  if (s === 'valid') {
    return {
      label: 'Valide',
      ariaLabel: 'Email vérifié et valide — envoyable',
      classes: 'bg-green-500/15 text-green-200 ring-green-500/25',
      showScore: true,
    }
  }
  if (s === 'accept_all' || s === 'catchall') {
    return {
      label: 'Catchall',
      ariaLabel:
        'Domaine catchall — accepte tous les emails, validité non garantie',
      classes: 'bg-orange-500/15 text-orange-200 ring-orange-500/25',
      showScore: true,
    }
  }
  if (s === 'invalid') {
    return {
      label: 'Invalide',
      ariaLabel: 'Email refusé par le serveur SMTP — ne pas envoyer',
      classes: 'bg-red-500/15 text-red-200 ring-red-500/25',
      showScore: false,
    }
  }
  if (s === 'disposable') {
    return {
      label: 'Jetable',
      ariaLabel: 'Domaine email jetable — ne pas envoyer',
      classes: 'bg-red-500/15 text-red-200 ring-red-500/25',
      showScore: false,
    }
  }
  if (s === 'webmail') {
    return {
      label: 'Email perso',
      ariaLabel: 'Email personnel (gmail, yahoo, etc.) — pas envoyable en B2B',
      classes: 'bg-white/[0.05] text-gray-400 ring-white/[0.1]',
      showScore: false,
    }
  }
  if (s === 'unverified' || s === '' || status == null) {
    return {
      label: 'Non vérifié',
      ariaLabel: 'Email jamais vérifié — cliquez sur "Vérifier" pour lancer Hunter',
      classes: 'bg-white/[0.03] text-gray-400 ring-white/[0.08]',
      showScore: false,
      dashed: true,
    }
  }
  // unknown / pattern_unverified / autre → variante neutre.
  return {
    label: 'Indéterminé',
    ariaLabel: 'Statut email indéterminé — vérification non concluante',
    classes: 'bg-white/[0.05] text-gray-300 ring-white/[0.1]',
    showScore: true,
  }
}

// ------------------------------------------------------------
// COMPOSANT
// ------------------------------------------------------------

export function ContactEmailStatusBadge({
  status,
  score,
  className = '',
}: ContactEmailStatusBadgeProps): JSX.Element {
  const variant = resolveBadgeVariant(status)
  const hasScore = variant.showScore && typeof score === 'number' && score >= 0

  // Bordure pointillée pour l'état "non vérifié" — signal visuel d'action requise.
  const ringStyle = variant.dashed ? ' ring-1 ring-dashed' : ' ring-1'

  return (
    <span
      aria-label={variant.ariaLabel}
      title={variant.ariaLabel}
      data-status={status ?? 'unverified'}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${variant.classes}${ringStyle} ${className}`.trim()}
    >
      <span>{variant.label}</span>
      {hasScore && (
        <span
          className="font-semibold tabular-nums"
          aria-label={`Score de confiance ${score}/100`}
        >
          · {score}
        </span>
      )}
    </span>
  )
}
