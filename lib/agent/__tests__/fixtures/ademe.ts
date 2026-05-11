// ============================================================
// FIXTURES — API ADEME BEGES (Data Fair) — Wave 1.3
// Cible : Wave 2 batch-enrich ADEME dans la boucle adaptative.
//
// Endpoint mocké : https://data.ademe.fr/data-fair/api/v1/datasets/bilan-ges/lines
// Cf. lib/agent/sourcing.ts:22 (ADEME_BEGES_URL) et :473 (verifierBegesAdeme).
//
// Type record ADEME tel que renvoyé par Data Fair :
//   - défini en interne dans sourcing.ts:84-94 (AdemeBegesDataFairRecord)
//   - PAS exporté actuellement → on le redéclare ici avec un commentaire de sync.
// La forme parsée par `verifierBegesAdeme` (sourcing.ts:508) est
//   `{ results?: AdemeBegesDataFairRecord[]; total?: number }`.
// ============================================================

// ------------------------------------------------------------
// TYPES LOCAUX (mirror)
// ------------------------------------------------------------

/**
 * Record ADEME BEGES Data Fair.
 * Mirror of type in sourcing.ts — keep in sync (lib/agent/sourcing.ts:84-94).
 */
export interface AdemeBegesDataFairRecord {
  siren_principal: string
  raison_sociale: string
  annee_de_reporting: number
  date_de_publication: string
  courriel?: string
  responsable_du_suivi?: string
  fonction?: string
  id: string
  structure_obligee?: string
}

/**
 * Enveloppe de réponse renvoyée par l'API Data Fair pour /bilan-ges/lines.
 * C'est cette forme que `verifierBegesAdeme` parse via `response.json()`.
 */
export interface AdemeResponse {
  results: AdemeBegesDataFairRecord[]
  total: number
}

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

/** Année courante — utilisée pour fabriquer des BEGES valides / expirés.
 *  Un BEGES est valide tant que son annee_de_reporting >= currentYear - 4
 *  (cf. sourcing.ts:658-661). */
const CURRENT_YEAR = new Date().getFullYear()

// ------------------------------------------------------------
// BUILDER : réponse ADEME custom
// ------------------------------------------------------------

export interface BuildAdemeResponseOptions {
  /** SIREN à 9 chiffres associé au bilan. */
  siren: string
  /** true → renvoie 1 record, false → renvoie 0 record (results vide). */
  hasBeges: boolean
  /** ISO date string (ex. "2024-06-15"). Default = milieu de l'année courante. */
  begesDate?: string
  /** true → annee_de_reporting récente (valide), false → > 4 ans (expiré). */
  begesValide?: boolean
  /** Surcharge optionnelle de la raison sociale. */
  raisonSociale?: string
}

/**
 * Construit une réponse ADEME paramétrable.
 * Cohérent avec l'enveloppe attendue par `verifierBegesAdeme` (sourcing.ts:508-518).
 */
export function buildAdemeResponse(opts: BuildAdemeResponseOptions): AdemeResponse {
  const {
    siren,
    hasBeges,
    begesDate,
    begesValide = true,
    raisonSociale,
  } = opts

  if (!hasBeges) {
    return { results: [], total: 0 }
  }

  // Année de reporting : valide → currentYear - 1 ; expiré → currentYear - 5.
  const anneeReporting = begesValide ? CURRENT_YEAR - 1 : CURRENT_YEAR - 5
  const datePublication =
    begesDate ?? `${anneeReporting}-06-15`

  const record: AdemeBegesDataFairRecord = {
    siren_principal: siren,
    raison_sociale: raisonSociale ?? `ENTREPRISE TEST ${siren}`,
    annee_de_reporting: anneeReporting,
    date_de_publication: datePublication,
    courriel: 'rse@entreprise-test.fr',
    responsable_du_suivi: 'Dupont Marie',
    fonction: 'Responsable RSE',
    id: `beges-${siren}-${anneeReporting}`,
    structure_obligee: 'oui',
  }

  return {
    results: [record],
    total: 1,
  }
}

// ------------------------------------------------------------
// FIXTURES PRÊTES À L'EMPLOI
// ------------------------------------------------------------

/**
 * Cas nominal : SIREN avec BEGES publié récent (valide < 4 ans).
 * Annee_de_reporting = CURRENT_YEAR - 1, contact RSE renseigné.
 */
export const ademeWithBegesValide: AdemeResponse = buildAdemeResponse({
  siren: '100000001',
  hasBeges: true,
  begesValide: true,
})

/**
 * BEGES présent mais expiré (annee_de_reporting > 4 ans).
 * Permet de tester la flag `beges_valide = false` dans enrichirProspect.
 */
export const ademeWithBegesExpire: AdemeResponse = buildAdemeResponse({
  siren: '100000002',
  hasBeges: true,
  begesValide: false,
})

/**
 * Cas le plus fréquent — entreprise sans BEGES publié.
 * C'est aussi le prospect le plus pertinent pour la prospection : obligation BEGES
 * + pas encore de bilan → opportunité claire pour un cabinet conseil.
 */
export const ademeWithoutBeges: AdemeResponse = buildAdemeResponse({
  siren: '100000003',
  hasBeges: false,
})

/**
 * Erreur ADEME — service indisponible (HTTP 503).
 * Représente l'enveloppe que renverrait `fetch` mocké : `{ ok: false, status, json }`.
 * `verifierBegesAdeme` doit retourner `null` proprement dans ce cas (sourcing.ts:497-506).
 */
export const ademeErrorResponse: {
  status: 503
  ok: false
  json: null
} = {
  status: 503,
  ok: false,
  json: null,
}
