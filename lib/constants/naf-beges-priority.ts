// ============================================================
// NAF BEGES PRIORITY — secteurs prioritaires bilan carbone
// ------------------------------------------------------------
// Sous-ensemble curé de `NAF_CODES` (lib/constants/naf-codes.ts)
// restreint aux 6 sections NAF historiquement les plus émettrices
// de GES (cf. rapports ADEME / Citepa "Secten") :
//
//   - A : Agriculture, sylviculture et pêche (élevage, cultures)
//   - C : Industrie manufacturière (ciment, acier, chimie, agro)
//   - D : Production et distribution d'énergie (élec, gaz, vapeur)
//   - E : Production et distribution d'eau, déchets, assainissement
//   - F : Construction (gros œuvre, génie civil, second œuvre)
//   - H : Transports et entreposage (routier, aérien, maritime, fret)
//
// Méthodologie :
//   - On part des codes déjà présents dans `NAF_CODES`, on filtre
//     sur la section, puis on retient ceux dont l'activité a un
//     poids GES significatif (>1% du scope sectoriel selon Citepa
//     Secten 2023, ou cible explicite de la stratégie nationale
//     bas carbone — SNBC).
//   - On garde tous les codes des `NAF_GROUPS_SUGGESTED` qui
//     tombent dans ces sections (cohérence quick-picks ↔ détail).
//   - On exclut volontairement les sections G/I/J/K/L/M/N/P/Q/R/S
//     qui sont des activités tertiaires faiblement émettrices en
//     direct (scopes 1+2). Les consultants BEGES les abordent
//     surtout via scope 3 — sortent du périmètre prioritaire.
//   - Sections B (extractives) écartée : sous-représentée en
//     France, peu de prospects B2B accessibles.
//
// Cible : ~80 codes, exhaustifs et représentatifs.
// Toute modification → check que NAF_GROUPS_SUGGESTED restent
// inclus (test d'intégrité côté UI).
// ============================================================

import { NAF_CODES, type NafCode } from './naf-codes'

/** Sections NAF prioritaires pour BEGES (cf. en-tête). */
export type NafBegesSection = 'A' | 'C' | 'D' | 'E' | 'F' | 'H'

export const NAF_BEGES_SECTIONS: readonly NafBegesSection[] = [
  'A',
  'C',
  'D',
  'E',
  'F',
  'H',
] as const

/**
 * Codes NAF retenus pour la prospection prioritaire BEGES.
 * Liste curée : représente l'essentiel des entreprises soumises à
 * l'obligation L. 229-25 (BEGES réglementaire > 500 / 250 salariés).
 *
 * NB : ces codes sont une stricte sous-partie de `NAF_CODES`.
 */
const PRIORITY_CODES: ReadonlySet<string> = new Set<string>([
  // ── Section A — Agriculture (cultures intensives + élevage) ──
  '01.11Z', // Céréales, légumineuses, oléagineuses
  '01.13Z', // Légumes, melons, racines
  '01.21Z', // Viticulture
  '01.22Z', // Fruits tropicaux et subtropicaux
  '01.24Z', // Fruits à pépins / noyau
  '01.41Z', // Élevage vaches laitières
  '01.42Z', // Élevage autres bovins / buffles
  '01.46Z', // Élevage porcins
  '01.47Z', // Élevage volailles
  '01.50Z', // Culture et élevage associés
  '02.10Z', // Sylviculture
  '02.20Z', // Exploitation forestière

  // ── Section C — Industrie manufacturière (cœur émetteur) ────
  '10.11Z', // Viande de boucherie
  '10.13A', // Préparation industrielle viande
  '10.32Z', // Jus de fruits et légumes
  '10.51A', // Lait liquide
  '10.51C', // Fromage
  '10.71A', // Pain et pâtisserie industriels
  '10.81Z', // Sucre
  '10.91Z', // Aliments pour animaux de ferme
  '11.02B', // Vinification
  '11.05Z', // Bière
  '13.20Z', // Tissage
  '13.30Z', // Ennoblissement textile
  '16.10A', // Sciage / rabotage bois
  '17.11Z', // Pâte à papier
  '17.12Z', // Papier / carton
  '19.20Z', // Raffinage du pétrole
  '20.11Z', // Gaz industriels
  '20.13B', // Chimie inorganique de base
  '20.14Z', // Chimie organique de base
  '20.15Z', // Engrais / produits azotés
  '20.16Z', // Plastiques de base
  '20.20Z', // Pesticides / agrochimiques
  '20.30Z', // Peintures, vernis, encres
  '21.10Z', // Pharmaceutique de base
  '22.11Z', // Pneumatiques
  '22.21Z', // Plaques / tubes / profilés plastiques
  '22.22Z', // Emballages plastiques
  '23.11Z', // Verre plat
  '23.13Z', // Verre creux
  '23.32Z', // Briques, tuiles, terre cuite
  '23.51Z', // Ciment
  '23.52Z', // Chaux et plâtre
  '23.61Z', // Éléments béton pour construction
  '23.63Z', // Béton prêt à l'emploi
  '24.10Z', // Sidérurgie
  '24.20Z', // Tubes / tuyaux en acier
  '24.42Z', // Métallurgie aluminium
  '24.44Z', // Métallurgie cuivre
  '24.51Z', // Fonderie de fonte
  '24.52Z', // Fonderie d'acier
  '25.11Z', // Structures métalliques
  '25.29Z', // Réservoirs / citernes / conteneurs métalliques
  '25.50A', // Forge, estampage, matriçage
  '25.61Z', // Traitement / revêtement métaux
  '28.11Z', // Moteurs et turbines
  '28.30Z', // Machines agricoles et forestières
  '29.10Z', // Construction véhicules automobiles
  '29.20Z', // Carrosseries et remorques
  '30.11Z', // Navires
  '30.20Z', // Locomotives / matériel ferroviaire
  '30.30Z', // Aéronautique et spatiale

  // ── Section D — Énergie ─────────────────────────────────────
  '35.11Z', // Production d'électricité
  '35.12Z', // Transport d'électricité
  '35.13Z', // Distribution d'électricité
  '35.14Z', // Commerce d'électricité
  '35.21Z', // Production de combustibles gazeux
  '35.22Z', // Distribution de gaz par conduites
  '35.30Z', // Vapeur et air conditionné

  // ── Section E — Eau et déchets ──────────────────────────────
  '36.00Z', // Captage / traitement / distribution d'eau
  '37.00Z', // Collecte / traitement des eaux usées
  '38.11Z', // Collecte déchets non dangereux
  '38.12Z', // Collecte déchets dangereux
  '38.21Z', // Traitement déchets non dangereux
  '38.22Z', // Traitement déchets dangereux
  '38.32Z', // Récupération de déchets triés
  '39.00Z', // Dépollution

  // ── Section F — Construction ────────────────────────────────
  '41.10A', // Promotion immobilière de logements
  '41.20A', // Construction maisons individuelles
  '41.20B', // Construction autres bâtiments
  '42.11Z', // Construction routes / autoroutes
  '42.12Z', // Construction voies ferrées
  '42.13A', // Ouvrages d'art
  '42.21Z', // Réseaux pour fluides
  '42.22Z', // Réseaux électriques / télécoms
  '42.99Z', // Autres ouvrages de génie civil
  '43.11Z', // Démolition
  '43.12A', // Terrassement courant
  '43.21A', // Installation électrique
  '43.22A', // Installation eau / gaz
  '43.22B', // Installation thermique / clim
  '43.29A', // Travaux d'isolation
  '43.99C', // Maçonnerie / gros œuvre

  // ── Section H — Transports et entreposage ──────────────────
  '49.10Z', // Transport ferroviaire de voyageurs
  '49.20Z', // Transport ferroviaire de fret
  '49.31Z', // Transports urbains / suburbains de voyageurs
  '49.39A', // Transport routier régulier de voyageurs
  '49.41A', // Transport routier de fret interurbain
  '49.41B', // Transport routier de fret de proximité
  '49.42Z', // Déménagement
  '49.50Z', // Transports par conduites
  '50.20Z', // Transport maritime de fret
  '50.40Z', // Transport fluvial de fret
  '51.10Z', // Transport aérien passagers
  '51.21Z', // Transport aérien de fret
  '52.10A', // Entreposage frigorifique
  '52.10B', // Entreposage non frigorifique
  '52.21Z', // Services auxiliaires transports terrestres
  '52.24A', // Manutention portuaire
  '52.29A', // Messagerie / fret express
  '52.29B', // Affrètement / organisation transports
])

/**
 * Liste plate des codes NAF BEGES prioritaires, enrichis (libellé + section).
 * Garde l'ordre canonique de `NAF_CODES` (tri par code croissant).
 *
 * Note : si un code de `PRIORITY_CODES` n'existe pas dans `NAF_CODES`,
 * il est silencieusement omis — c'est volontaire pour éviter de
 * désynchroniser les deux fichiers en cas d'évolution.
 */
export const NAF_BEGES_PRIORITY: readonly NafCode[] = NAF_CODES.filter((c) =>
  PRIORITY_CODES.has(c.code),
)

/** Set des codes BEGES prioritaires, pour lookup O(1) côté UI. */
export const NAF_BEGES_PRIORITY_SET: ReadonlySet<string> = new Set(
  NAF_BEGES_PRIORITY.map((c) => c.code),
)

/** Libellés courts des sections BEGES (UI : group headers, filtres). */
export const NAF_BEGES_SECTION_LABELS: Record<NafBegesSection, string> = {
  A: 'Agriculture',
  C: 'Industrie',
  D: 'Énergie',
  E: 'Eau & déchets',
  F: 'Construction',
  H: 'Transports',
}
