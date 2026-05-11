// ============================================================
// FIXTURES — Pagination CURSEUR Sirene INSEE (Wave 1.3)
// Cible : Wave 2 refactorera `sourcerEntreprises` (lib/agent/sourcing.ts)
// pour utiliser la pagination officielle par curseur :
//   - 1er appel : curseur=*
//   - Suivants : utiliser header.curseurSuivant comme curseur
//   - Fin     : curseur === curseurSuivant (page terminale)
//
// Types utilisés :
//   - SireneEtablissement : lib/types.ts:181-202
//   - SireneResponse      : lib/types.ts:204-213
//     (NB : le header officiel Sirene contient déjà `curseur` et `curseurSuivant`
//     mais ces champs ne sont PAS encore dans le type SireneResponse de types.ts.
//     Wave 2 les ajoutera. En attendant, on définit ici un type local
//     `SireneCursorResponse` qui ÉTEND SireneResponse avec les champs curseur.
//     `// Mirror of type in sourcing.ts — keep in sync` une fois Wave 2 mergée.)
// ============================================================

import type { SireneEtablissement, SireneResponse } from '@/lib/types'

// ------------------------------------------------------------
// TYPE LOCAL — Réponse curseur (sera mergé dans types.ts en Wave 2)
// Mirror of type in sourcing.ts — keep in sync
// ------------------------------------------------------------

/**
 * Header Sirene étendu avec les champs de pagination curseur officielle INSEE.
 * Voir https://api.insee.fr/catalogue/site/themes/wso2/subthemes/insee/pages/item-info.jag?name=Sirene&version=V3.11
 */
export interface SireneCursorHeader {
  statut: number
  message: string
  total: number
  debut: number
  nombre: number
  curseur: string
  curseurSuivant: string
}

/**
 * Réponse Sirene avec pagination curseur (étend SireneResponse).
 * Wave 2 modifiera SireneResponse dans types.ts pour inclure ces champs ;
 * d'ici là, ce type local mirroite la forme attendue.
 */
export interface SireneCursorResponse extends Omit<SireneResponse, 'header'> {
  header: SireneCursorHeader
}

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

/** Premier SIREN de la séquence de tests. Permet de générer 250+ SIREN distincts. */
const BASE_SIREN = 100_000_000

/** Codes NAF cohérents avec les secteurs prioritaires (cf. sourcing.ts:25-48). */
const SAMPLE_NAFS = [
  '30.30Z', // Construction aéronautique (NAF prioritaire)
  '10.11Z', // Transformation/conservation viande
  '49.41A', // Transport routier de fret
  '01.21Z', // Culture de la vigne
  '23.11Z', // Fabrication verre plat
] as const

/** Villes de Gironde (cohérent avec CODE_POSTAL_QUERY de sourcing.ts:62). */
const SAMPLE_LOCATIONS: Array<{ codePostal: string; commune: string }> = [
  { codePostal: '33000', commune: 'BORDEAUX' },
  { codePostal: '33300', commune: 'BORDEAUX' },
  { codePostal: '33700', commune: 'MERIGNAC' },
  { codePostal: '33600', commune: 'PESSAC' },
  { codePostal: '33170', commune: 'GRADIGNAN' },
]

/** Tranches d'effectifs INSEE >= 21 (50 salariés et plus). */
const SAMPLE_TRANCHES = ['21', '22', '31', '32', '41', '42', '51'] as const

// ------------------------------------------------------------
// FACTORY : un établissement Sirene typique
// ------------------------------------------------------------

/**
 * Construit un établissement Sirene réaliste pour les tests.
 * Le SIRET est dérivé du SIREN (SIREN + 5 chiffres NIC = 14 chiffres).
 *
 * @param siren - SIREN à 9 chiffres
 * @param opts  - Surcharges optionnelles sur les champs Sirene
 */
export function sireneSampleEtablissement(
  siren: string,
  opts: Partial<SireneEtablissement> = {},
): SireneEtablissement {
  const idx = parseInt(siren.slice(-3), 10) || 0
  const naf = SAMPLE_NAFS[idx % SAMPLE_NAFS.length]
  const loc = SAMPLE_LOCATIONS[idx % SAMPLE_LOCATIONS.length]
  const tranche = SAMPLE_TRANCHES[idx % SAMPLE_TRANCHES.length]
  const siret = `${siren}00012` // NIC simulé

  return {
    siret,
    siren,
    denominationUniteLegale: `ENTREPRISE TEST ${siren}`,
    codePostalEtablissement: loc.codePostal,
    libelleCommuneEtablissement: loc.commune,
    activitePrincipaleEtablissement: naf,
    nomenclatureActivitePrincipaleEtablissement: 'NAFRev2',
    trancheEffectifsEtablissement: tranche,
    anneeEffectifsEtablissement: '2023',
    adresseEtablissement: {
      numeroVoieEtablissement: '12',
      typeVoieEtablissement: 'RUE',
      libelleVoieEtablissement: 'DE LA REPUBLIQUE',
      codePostalEtablissement: loc.codePostal,
      libelleCommuneEtablissement: loc.commune,
    },
    etatAdministratifEtablissement: 'A',
    ...opts,
  }
}

// ------------------------------------------------------------
// BUILDER : page Sirene custom (pour tests dynamiques)
// ------------------------------------------------------------

export interface BuildSirenePageOptions {
  /** Curseur courant (utilisé pour la requête). '*' pour la première page. */
  curseur: string
  /** Curseur suivant renvoyé dans le header. Égal à curseur = fin de pagination. */
  curseurSuivant: string
  /** Nombre d'établissements à générer sur cette page. */
  count: number
  /** Préfixe numérique pour générer les SIREN. Defaults to BASE_SIREN. */
  sirenStart?: number
  /** Total d'univers disponible renvoyé dans le header. Defaults to 1000. */
  total?: number
  /** Index `debut` renvoyé dans le header (informatif en mode curseur). */
  debut?: number
}

/**
 * Construit une page Sirene paramétrable pour les tests.
 * Les SIREN générés sont contigus à partir de `sirenStart`.
 */
export function buildSirenePage(opts: BuildSirenePageOptions): SireneCursorResponse {
  const {
    curseur,
    curseurSuivant,
    count,
    sirenStart = BASE_SIREN,
    total = 1000,
    debut = 0,
  } = opts

  const etablissements: SireneEtablissement[] = []
  for (let i = 0; i < count; i++) {
    const siren = String(sirenStart + i).padStart(9, '0')
    etablissements.push(sireneSampleEtablissement(siren))
  }

  return {
    header: {
      statut: 200,
      message: 'OK',
      total,
      debut,
      nombre: count,
      curseur,
      curseurSuivant,
    },
    etablissements,
  }
}

// ------------------------------------------------------------
// SÉQUENCE DE 3 PAGES — flow nominal complet
// page1 (curseur=*)   → curseurSuivant=c2
// page2 (curseur=c2)  → curseurSuivant=c3
// page3 (curseur=c3)  → curseurSuivant=c3 (FIN, terminale)
//
// SIREN uniques sur les 3 pages : 100000000..100000249 (250 distincts).
// ------------------------------------------------------------

export const sireneCursorSequence: {
  page1: SireneCursorResponse
  page2: SireneCursorResponse
  page3: SireneCursorResponse
} = {
  page1: buildSirenePage({
    curseur: '*',
    curseurSuivant: 'c2',
    count: 100,
    sirenStart: BASE_SIREN, // 100000000..100000099
    total: 250,
    debut: 0,
  }),
  page2: buildSirenePage({
    curseur: 'c2',
    curseurSuivant: 'c3',
    count: 100,
    sirenStart: BASE_SIREN + 100, // 100000100..100000199
    total: 250,
    debut: 100,
  }),
  page3: buildSirenePage({
    curseur: 'c3',
    curseurSuivant: 'c3', // FIN : curseurSuivant === curseur
    count: 50,
    sirenStart: BASE_SIREN + 200, // 100000200..100000249
    total: 250,
    debut: 200,
  }),
}

// ------------------------------------------------------------
// HELPERS : cas limites
// ------------------------------------------------------------

/** Page Sirene vide — univers sans aucun résultat (filtre trop restrictif). */
export const sireneEmptyResponse: SireneCursorResponse = {
  header: {
    statut: 200,
    message: 'OK',
    total: 0,
    debut: 0,
    nombre: 0,
    curseur: '*',
    curseurSuivant: '*', // pas de page suivante → terminale d'office
  },
  etablissements: [],
}

/**
 * Réponse d'erreur Sirene (HTTP 500) — pour tester le mode dégradé / retry.
 * Représente l'enveloppe que renverrait `fetch` mocké : `{ ok: false, status, json }`.
 */
export const sireneErrorResponse: {
  status: 500
  ok: false
  json: { erreur: string }
} = {
  status: 500,
  ok: false,
  json: {
    erreur: 'Service Sirene momentanément indisponible',
  },
}
