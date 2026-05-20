// ============================================================
// PROSPECT STATUS — Source unique de vérité
//
// Centralise les labels, styles (badges + dots), et options
// des statuts CRM pour éviter la duplication entre :
//   - app/(dashboard)/prospects/page.tsx
//   - components/pipeline/kanban-side-panel.tsx
//   - components/pipeline/pipeline-client.tsx
//   - components/prospects/status-dropdown.tsx
//   - components/prospects/prospects-filters.tsx
//
// Refonte UI 2026-05-14 — voir memory/project-refont-alpha
// ============================================================

import type { ProspectStatus } from '@/lib/types'

/**
 * Libellés FR pour chaque statut.
 * `rdv` (legacy) fusionné visuellement avec `interested` côté liste,
 * conservé séparé côté kanban side panel pour rétrocompat.
 */
export const STATUS_LABELS: Record<ProspectStatus, string> = {
  sourced: 'Nouveau',
  qualified: 'Qualifié',
  contacted: 'Contacté',
  interested: 'Intéressé',
  rdv: 'RDV',
  offer_sent: 'Offre envoyée',
  converted: 'Affaire conclue',
  rejected: 'Sans suite',
  on_hold: 'En stand-by',
  // Migration 017 : opt-out manuel utilisateur. Sémantique "ne jamais contacter".
  do_not_contact: 'Ne pas contacter',
}

/**
 * Variante "compacte" pour la liste : fusionne `rdv` → `Intéressé` car
 * ces deux statuts sont collés sémantiquement dans le pipeline commercial.
 */
export const STATUS_LABELS_COMPACT: Record<ProspectStatus, string> = {
  ...STATUS_LABELS,
  rdv: 'Intéressé',
}

/**
 * Couleur sémantique de chaque statut.
 * Sert de base pour générer les classes Tailwind selon le "tone" voulu.
 */
const STATUS_COLOR: Record<ProspectStatus, string> = {
  sourced: 'gray',
  qualified: 'blue',
  contacted: 'yellow',
  interested: 'green',
  rdv: 'purple',
  offer_sent: 'indigo',
  converted: 'emerald',
  rejected: 'red',
  on_hold: 'orange',
  // slate = neutre, distinct du red 'rejected' (qui reste pour les refus actifs).
  do_not_contact: 'slate',
}

export interface StatusStyle {
  /** Classes Tailwind pour le badge (background + texte) */
  badge: string
  /** Classe Tailwind pour le point coloré (background uniquement) */
  dot: string
}

/**
 * Style "solide" (bg-100/bg-950) — utilisé dans le Kanban side panel
 * et les vues où le statut est mis en avant.
 */
export const STATUS_STYLES_SOLID: Record<ProspectStatus, StatusStyle> = {
  sourced: {
    badge: 'bg-gray-800/60 text-gray-300',
    dot: 'bg-gray-400',
  },
  qualified: {
    badge: 'bg-blue-950 text-blue-400',
    dot: 'bg-blue-500',
  },
  contacted: {
    badge: 'bg-yellow-950 text-yellow-400',
    dot: 'bg-yellow-500',
  },
  interested: {
    badge: 'bg-green-950 text-green-400',
    dot: 'bg-green-500',
  },
  rdv: {
    badge: 'bg-purple-950 text-purple-400',
    dot: 'bg-purple-500',
  },
  offer_sent: {
    badge: 'bg-indigo-950 text-indigo-400',
    dot: 'bg-indigo-500',
  },
  converted: {
    badge: 'bg-emerald-950 text-emerald-400',
    dot: 'bg-emerald-500',
  },
  rejected: {
    badge: 'bg-red-950 text-red-400',
    dot: 'bg-red-500',
  },
  on_hold: {
    badge: 'bg-orange-950 text-orange-400',
    dot: 'bg-orange-500',
  },
  // Migration 017 : slate — neutre, distinct visuellement du rouge 'rejected'.
  do_not_contact: {
    badge: 'bg-slate-800/60 text-slate-300',
    dot: 'bg-slate-400',
  },
}

/**
 * Style "discret" (bg-50/bg-950) — utilisé dans la liste prospects où
 * plusieurs badges cohabitent en colonne et doivent rester subtils.
 */
export const STATUS_STYLES_SOFT: Record<ProspectStatus, StatusStyle> = {
  sourced: {
    badge: 'bg-gray-800/60 text-gray-400',
    dot: 'bg-gray-400',
  },
  qualified: {
    badge: 'bg-blue-950 text-blue-400',
    dot: 'bg-blue-500',
  },
  contacted: {
    badge: 'bg-yellow-950 text-yellow-400',
    dot: 'bg-yellow-500',
  },
  interested: {
    badge: 'bg-green-950 text-green-400',
    dot: 'bg-green-500',
  },
  rdv: {
    badge: 'bg-green-950 text-green-400',
    dot: 'bg-green-500',
  },
  offer_sent: {
    badge: 'bg-indigo-950 text-indigo-400',
    dot: 'bg-indigo-500',
  },
  converted: {
    badge: 'bg-emerald-950 text-emerald-400',
    dot: 'bg-emerald-500',
  },
  rejected: {
    badge: 'bg-red-950 text-red-400',
    dot: 'bg-red-500',
  },
  on_hold: {
    badge: 'bg-orange-950 text-orange-400',
    dot: 'bg-orange-500',
  },
  // Migration 017 : slate — neutre, distinct visuellement du rouge 'rejected'.
  do_not_contact: {
    badge: 'bg-slate-800/60 text-slate-300',
    dot: 'bg-slate-400',
  },
}

/**
 * Ordre canonique des colonnes du Kanban /pipeline (spec utilisateur).
 * `rdv` exclu — legacy fusionné visuellement avec `interested`.
 */
export const KANBAN_COLUMN_ORDER: ProspectStatus[] = [
  'sourced',
  'qualified',
  'contacted',
  'interested',
  'offer_sent',
  'converted',
  'rejected',
  'on_hold',
]

/**
 * Options proposées par le `<StatusDropdown>` d'édition manuelle.
 * Identique à `KANBAN_COLUMN_ORDER` aujourd'hui — séparé pour pouvoir
 * diverger sans casser l'autre usage.
 */
export const STATUS_DROPDOWN_OPTIONS: ProspectStatus[] = KANBAN_COLUMN_ORDER

/**
 * Helper : retourne le style approprié pour un statut, avec fallback `sourced`
 * (sécurise les data DB qui peuvent contenir des statuts hors enum).
 */
export function getStatusStyle(
  statut: ProspectStatus | string,
  tone: 'solid' | 'soft' = 'solid',
): StatusStyle {
  const table = tone === 'soft' ? STATUS_STYLES_SOFT : STATUS_STYLES_SOLID
  return (table as Record<string, StatusStyle>)[statut] ?? table.sourced
}

/**
 * Helper : retourne le label approprié pour un statut, avec fallback sur la
 * valeur brute (pour ne pas afficher "undefined" si statut hors enum).
 */
export function getStatusLabel(
  statut: ProspectStatus | string,
  compact = false,
): string {
  const table = compact ? STATUS_LABELS_COMPACT : STATUS_LABELS
  return (table as Record<string, string>)[statut] ?? statut
}

/**
 * Couleur sémantique brute (utile pour générer du CSS dynamique, glow, etc.)
 */
export function getStatusColor(statut: ProspectStatus | string): string {
  return STATUS_COLOR[statut as ProspectStatus] ?? 'gray'
}
