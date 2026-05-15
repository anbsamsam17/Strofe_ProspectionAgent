// ============================================================
// EmptyState — composant générique pour les états vides
//
// Variantes :
//   - no-prospects : table prospects vide
//   - no-calls : aucun appel passé aujourd'hui
//   - no-pipeline : colonne kanban vide
//   - agent-idle : agent au repos
//   - no-results : aucun résultat filtre
//
// Toujours rendu sobre, ton Alpha 1ʳᵉ pers.
// ============================================================

import type { ReactNode } from 'react'

type Variant = 'no-prospects' | 'no-calls' | 'no-pipeline' | 'agent-idle' | 'no-results'

interface EmptyStateProps {
  variant?: Variant
  title?: string
  description?: string
  /** Bouton ou lien d'action. */
  action?: ReactNode
  className?: string
}

interface VariantPreset {
  title: string
  description: string
  icon: ReactNode
}

const SearchIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

const InboxIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
)

const PhoneIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
)

const MoonIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

const VARIANT_PRESETS: Record<Variant, VariantPreset> = {
  'no-prospects': {
    title: 'Aucun prospect',
    description: 'La prochaine campagne nocturne remplira cette liste.',
    icon: InboxIcon,
  },
  'no-calls': {
    title: 'Aucun appel passé aujourd’hui',
    description:
      "Sélectionnez un prospect pour commencer. Le pipeline s'enrichit à chaque échange.",
    icon: PhoneIcon,
  },
  'no-pipeline': {
    title: 'Aucun prospect dans cette colonne',
    description: 'Glissez une carte ici ou changez le statut depuis le détail.',
    icon: InboxIcon,
  },
  'agent-idle': {
    title: 'Glan dort.',
    description: 'Prochaine exécution ce soir, 22h.',
    icon: MoonIcon,
  },
  'no-results': {
    title: 'Aucun résultat',
    description: 'Essayez de modifier ou réinitialiser vos filtres.',
    icon: SearchIcon,
  },
}

export function EmptyState({
  variant = 'no-results',
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  const preset = VARIANT_PRESETS[variant]
  const finalTitle = title ?? preset.title
  const finalDescription = description ?? preset.description

  return (
    <div
      className={`flex flex-col items-center gap-3 py-12 text-center ${className}`}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.05] text-gray-400 ring-1 ring-white/[0.08]">
        {preset.icon}
      </div>
      <p className="text-sm font-medium text-gray-200">
        {finalTitle}
      </p>
      <p className="max-w-sm text-xs text-gray-400">
        {finalDescription}
      </p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
