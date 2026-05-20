// ============================================================
// DETECT PERSONA — déduit DAF/RSE/DG/DRH depuis le libellé `poste`
//
// Sert à pré-sélectionner le template email côté UI EmailComposer.
// Détection naïve par includes — l'utilisateur peut toujours
// override manuellement le template choisi.
// ============================================================

export type EmailPersona = 'daf' | 'rse' | 'dg' | 'drh'

const DAF_KEYWORDS = [
  'daf',
  'directeur financier',
  'directrice financier',
  'directeur financière',
  'directrice financière',
  'finance',
  'financ',
  'cfo',
  'comptab',
  'tréso',
  'treso',
  'achats',
  'contrôl', // contrôleur de gestion
  'controle',
  'admin',
]

const RSE_KEYWORDS = [
  'rse',
  'durable',
  'développement durable',
  'developpement durable',
  'esg',
  'sustainab',
  'sustainability',
  'environnement',
  'climat',
  'carbone',
  'décarbon',
  'decarbon',
  'green',
  'csr', // corporate social responsibility
  'qhse',
  'hse',
]

const DRH_KEYWORDS = [
  'drh',
  'rh ',
  'rh,',
  'ressources humaines',
  'ressources-humaines',
  'human resources',
  'human-resources',
  'hrbp',
  'people',
  'talent',
  'recrutement',
  'recruteur',
]

const DG_KEYWORDS = [
  'dg ',
  'dg,',
  'directeur général',
  'directrice générale',
  'directeur general',
  'directrice generale',
  'président',
  'presidente',
  'president',
  'pdg',
  'p-dg',
  'ceo',
  'chief executive',
  'fondateur',
  'fondatrice',
  'founder',
  'gérant',
  'gerant',
  'gérante',
  'gerante',
]

/**
 * Déduit la persona d'un libellé `poste` libre. Cas par défaut = 'dg'
 * (figure d'autorité, message le plus universel : risque + accès marchés).
 *
 * Ordre des checks : RSE > DAF > DRH > DG.
 * RSE en premier car un "Directeur RSE" matcherait sinon DAF via "directeur".
 */
export function detectPersona(poste: string | null | undefined): EmailPersona {
  if (!poste) return 'dg'
  const p = poste.toLowerCase().trim()
  if (!p) return 'dg'

  if (RSE_KEYWORDS.some((kw) => p.includes(kw))) return 'rse'
  if (DAF_KEYWORDS.some((kw) => p.includes(kw))) return 'daf'
  if (DRH_KEYWORDS.some((kw) => p.includes(kw))) return 'drh'
  if (DG_KEYWORDS.some((kw) => p.includes(kw))) return 'dg'

  return 'dg'
}

/**
 * Libellé humain pour une persona — utilisé dans le UI du composer.
 */
export const PERSONA_LABELS: Record<EmailPersona, string> = {
  daf: 'DAF / Direction financière',
  rse: 'RSE / Direction durable',
  dg: 'DG / Direction générale',
  drh: 'DRH / Ressources humaines',
}
