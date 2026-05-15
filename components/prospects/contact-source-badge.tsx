// ============================================================
// ContactSourceBadge — pastille indiquant l'origine d'un contact
//
// Pure presentational (Server Component). Affiche un pill translucide
// dont la couleur correspond au provider d'enrichissement v2 :
//   RE / INPI / BODACC / Pappers / Hunter (pattern) / Pattern + DNS /
//   ADEME / Manuel.
// Utilisé par les listes de contacts et les fiches prospect détaillées.
// ============================================================

import type { JSX } from 'react'

export type ContactSource =
  | 're'
  | 'inpi'
  | 'bodacc'
  | 'pappers'
  | 'hunter-pattern'
  | 'pattern'
  | 'ademe'
  | 'manual'

interface ContactSourceBadgeProps {
  source: ContactSource
  className?: string
}

interface SourceMeta {
  label: string
  description: string
  classes: string
  italic?: boolean
}

// Palette translucide alignée sur les autres badges (PriorityDropdown, etc.).
// Forced dark theme : on s'appuie sur des fills /15 et des rings /25.
const SOURCE_META: Record<ContactSource, SourceMeta> = {
  re: {
    label: 'RE',
    description:
      'Source : Recherche Entreprises (api.gouv.fr) — données légales publiques',
    classes: 'bg-cyan-500/15 text-cyan-200 ring-cyan-500/25',
  },
  inpi: {
    label: 'INPI',
    description:
      'Source : INPI Registre National des Entreprises (mandataires sociaux)',
    classes: 'bg-violet-500/15 text-violet-200 ring-violet-500/25',
  },
  bodacc: {
    label: 'BODACC',
    description:
      'Source : BODACC — annonces légales (nominations de dirigeants)',
    classes: 'bg-blue-500/15 text-blue-200 ring-blue-500/25',
  },
  pappers: {
    label: 'Pappers',
    description: 'Source : Pappers (api.pappers.fr) — fiche entreprise enrichie',
    classes: 'bg-amber-500/15 text-amber-200 ring-amber-500/25',
  },
  'hunter-pattern': {
    label: 'Hunter',
    description:
      'Source : Hunter.io — pattern email vérifié sur le domaine de l\'entreprise',
    classes: 'bg-orange-500/15 text-orange-200 ring-orange-500/25',
  },
  pattern: {
    label: 'Pattern + DNS',
    description:
      'Source : email deviné par pattern (prénom.nom@domaine), non vérifié',
    classes: 'bg-white/[0.06] text-gray-300 ring-white/[0.12]',
    italic: true,
  },
  ademe: {
    label: 'ADEME',
    description: 'Source : ADEME — bilan BEGES public (bilans-ges.ademe.fr)',
    classes: 'bg-green-500/15 text-green-200 ring-green-500/25',
  },
  manual: {
    label: 'Manuel',
    description: 'Source : saisie manuelle dans l\'application',
    classes: 'bg-white/[0.08] text-white ring-white/[0.18]',
  },
}

export function ContactSourceBadge({
  source,
  className = '',
}: ContactSourceBadgeProps): JSX.Element {
  const meta = SOURCE_META[source]
  const italicClass = meta.italic ? ' italic' : ''
  return (
    <span
      title={meta.description}
      aria-label={meta.description}
      data-source={source}
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ring-1 ${meta.classes}${italicClass} ${className}`.trim()}
    >
      {meta.label}
    </span>
  )
}
