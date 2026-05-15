// ============================================================
// BODACC — Bulletin Officiel des Annonces Civiles et Commerciales
//
// Source : https://bodacc-datadila.opendatasoft.com/api/explore/v2.1
// Dataset public : `annonces-commerciales`
// Coût : gratuit, ~10k requêtes/jour raisonnable, pas de clé.
//
// Usage : détecter les changements de dirigeants depuis la dernière passe
// pour invalider les contacts obsolètes (`prospects.contact_outdated_at`).
//
// RGPD : noms/prénoms BODACC sont des données légales publiques. OK à
// stocker en DB (RLS protège), mais NE JAMAIS logger les noms — seulement
// les compteurs et les SIREN.
// ============================================================

import { z } from 'zod'

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

const BODACC_BASE_URL =
  'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records'

const DEFAULT_TIMEOUT_MS = 15_000
const PAGE_LIMIT = 100
// Plafond de sécurité : en pratique on aura < 50 records par batch SIREN,
// mais on coupe la pagination au cas où BODACC retournerait des doublons.
const MAX_RECORDS_PER_CALL = 1_000

/**
 * Fonctions de dirigeants surveillées. Toute autre fonction (commissaire aux
 * comptes, administrateur judiciaire, etc.) est ignorée — sortie du périmètre
 * "contact commercial à re-enrichir".
 */
const DIRIGEANT_FONCTIONS = new Set([
  'Président',
  'Gérant',
  'Directeur général',
  'PDG',
  'Administrateur principal',
])

// ------------------------------------------------------------
// TYPES PUBLICS
// ------------------------------------------------------------

export interface BodaccChange {
  siren: string
  typeAvis: string
  dateParution: string
  personne: {
    nom: string | null
    prenom: string | null
    fonction: string | null
  } | null
}

// ------------------------------------------------------------
// SCHEMA ZOD — défensif (ignore tous les champs non utilisés)
// ------------------------------------------------------------

const BodaccRecordSchema = z
  .object({
    registre: z.array(z.string()).optional().nullable(),
    dateparution: z.string().optional().nullable(),
    typeavis_lib: z.string().optional().nullable(),
    personne_nom: z.string().optional().nullable(),
    personne_prenom: z.string().optional().nullable(),
    personne_fonction: z.string().optional().nullable(),
  })
  .passthrough()

const BodaccResponseSchema = z
  .object({
    total_count: z.number().optional(),
    results: z.array(BodaccRecordSchema).optional().default([]),
  })
  .passthrough()

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

/** SIREN BODACC : 9 chiffres. Filtre defensif anti-injection. */
function isValidSiren(siren: string): boolean {
  return /^\d{9}$/.test(siren)
}

function toIsoDate(d: Date): string {
  // BODACC accepte YYYY-MM-DD pour dateparution
  return d.toISOString().slice(0, 10)
}

/**
 * Construit le filtre `where` ODSQL pour BODACC.
 * Échappe naïvement les guillemets (les SIREN sont validés via regex
 * en amont, donc aucune injection possible — défense en profondeur).
 */
function buildWhereClause(sirens: string[], since: Date): string {
  const list = sirens.map((s) => `"${s}"`).join(',')
  const sinceStr = toIsoDate(since)
  return `registre in (${list}) and dateparution >= date'${sinceStr}'`
}

function buildUrl(params: {
  sirens: string[]
  since: Date
  offset: number
}): string {
  const url = new URL(BODACC_BASE_URL)
  url.searchParams.set('where', buildWhereClause(params.sirens, params.since))
  url.searchParams.set('limit', String(PAGE_LIMIT))
  url.searchParams.set('offset', String(params.offset))
  return url.toString()
}

/**
 * Extrait le SIREN depuis un record BODACC. Le champ `registre` est un
 * array de strings (BODACC peut référencer plusieurs registres).
 */
function extractSiren(record: z.infer<typeof BodaccRecordSchema>): string | null {
  if (!record.registre || record.registre.length === 0) return null
  const first = record.registre[0]
  if (typeof first !== 'string') return null
  // Certains registres contiennent suffixes (RCS XXX) — on garde les 9 premiers chiffres
  const match = first.match(/\d{9}/)
  return match ? match[0] : null
}

// ------------------------------------------------------------
// EXPORTS
// ------------------------------------------------------------

/**
 * Filtre les records BODACC pour ne garder que les modifications de
 * dirigeants (président, gérant, DG, PDG, administrateur principal).
 *
 * Robuste aux structures mal formées (`unknown[]` en entrée).
 */
export function extractDirigeantChanges(records: unknown[]): BodaccChange[] {
  const changes: BodaccChange[] = []
  for (const raw of records) {
    const parsed = BodaccRecordSchema.safeParse(raw)
    if (!parsed.success) continue

    const rec = parsed.data
    const fonction = rec.personne_fonction ?? null
    if (!fonction || !DIRIGEANT_FONCTIONS.has(fonction)) continue

    const siren = extractSiren(rec)
    if (!siren) continue

    changes.push({
      siren,
      typeAvis: rec.typeavis_lib ?? 'Inconnu',
      dateParution: rec.dateparution ?? '',
      personne: {
        nom: rec.personne_nom ?? null,
        prenom: rec.personne_prenom ?? null,
        fonction,
      },
    })
  }
  return changes
}

/**
 * Récupère les annonces BODACC pour une liste de SIREN depuis une date donnée.
 *
 * Robustesse : en cas de timeout, 4xx, 5xx ou JSON malformé, retourne `[]`
 * (pas de throw — la pipeline cron doit continuer même si BODACC est down).
 *
 * Pagination : suit le curseur `offset` jusqu'à `MAX_RECORDS_PER_CALL` ou
 * jusqu'à ce qu'une page revienne vide.
 */
export async function fetchBodaccChanges(
  sirens: string[],
  options: { since: Date; timeoutMs?: number },
): Promise<BodaccChange[]> {
  const validSirens = sirens.filter(isValidSiren)
  if (validSirens.length === 0) return []

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const allRecords: unknown[] = []
  let offset = 0

  while (offset < MAX_RECORDS_PER_CALL) {
    const url = buildUrl({ sirens: validSirens, since: options.since, offset })

    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'prospection-agent/1.0',
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      // Timeout réseau ou DNS — abandonne silencieusement
      return []
    }

    if (!response.ok) {
      // 4xx ou 5xx : pas de retry agressif (BODACC est gratuit, on n'a pas
      // de SLA et un cron hebdo retentera dans 7 jours).
      return []
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return []
    }

    const parsed = BodaccResponseSchema.safeParse(payload)
    if (!parsed.success) return []

    const page = parsed.data.results ?? []
    if (page.length === 0) break

    allRecords.push(...page)
    offset += page.length

    // Si la page n'est pas pleine, on a tout récupéré
    if (page.length < PAGE_LIMIT) break
  }

  return extractDirigeantChanges(allRecords)
}
