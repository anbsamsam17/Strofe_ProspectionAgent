// ============================================================
// SIRENE CACHE — Lecture du miroir local SIRENE (Supabase)
//
// Drop-in remplaçant de l'appel API Sirene runtime quand le cache
// est frais. Encapsule l'appel à la fonction PL/pgSQL
// `search_sirene_cache(...)` ajoutée par la migration 019.
//
// Cascade côté caller (sourcing-runner) :
//   1. Cache SUPABASE (ce module)          ← gratuit, < 50ms, données ETL mensuelles
//   2. API Sirene INSEE (sourcing.ts)      ← throttlé, instable
//   3. Recherche Entreprises gouv (idem)   ← fallback ultime
//
// Stratégie :
//   - `searchSireneCache()` retourne `null` quand le cache est inutilisable
//     (vide OU obsolète > 60j). Le caller bascule alors sur l'API Sirene.
//   - `getSireneCacheHealth()` interroge la vue `sirene_cache_size`
//     (count actifs + âge en jours) pour le diag.
//
// SÉCURITÉ : la table `sirene_cache` ne contient PAS de PII (données INSEE
// publiques). RLS ouverte en SELECT, écriture service_role uniquement.
//
// Cf. supabase/migrations/018_sirene_cache.sql + 019_sirene_search_function.sql.
// ============================================================

import type { SupabaseAdminClient } from '@/lib/supabase/server'
import type { SireneEtablissement } from '@/lib/types'

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

/**
 * Âge maximum toléré pour considérer le cache utilisable.
 * Le bulk INSEE SIRENE est réimporté mensuellement (~30j) — au-delà
 * de 60j, les données sont considérées obsolètes et le caller doit
 * fallback sur l'API Sirene live.
 *
 * 60j = 2x la cadence d'import attendue. Marge confortable pour
 * absorber un import raté sans dégrader le sourcing.
 */
const CACHE_STALE_THRESHOLD_DAYS = 60

/** Default page size (cohérent avec DEFAULT_PAGE_SIZE de sourcing.ts). */
const DEFAULT_PAGE_SIZE = 100

// ------------------------------------------------------------
// TYPES PUBLICS
// ------------------------------------------------------------

export interface SearchSireneCacheParams {
  /** Codes NAF format `XX.XXY` (avec point) à filtrer. `[]` ou `undefined` = tous. */
  nafCodes: string[]
  /** Codes tranche d'effectifs INSEE (`'21'`, `'22'`, ...). `[]` = toutes. */
  trancheEffectifs: string[]
  /** Borne CP `[min, max]` (5 chars chacun, ex. `['33000', '33999']`). Optionnel. */
  codePostalRange?: [string, string]
  /** SIREN à exclure (dedup avec la base `prospects`). Peut être vide. */
  excludeSirens: string[]
  /** Nombre max d'établissements à retourner. Défaut : 100. */
  pageSize?: number
  /** Offset pour pagination. Défaut : 0. */
  offset?: number
}

export interface SearchSireneCacheResult {
  /** Établissements convertis au format Sirene wire (drop-in replacement). */
  etablissements: SireneEtablissement[]
  /**
   * Total d'établissements potentiellement disponibles dans le cache pour ces
   * filtres. Approximation = `etablissements.length` quand on n'a pas paginé
   * (i.e. on a reçu moins que `pageSize`). Sinon on signale au caller via le
   * fait qu'il faut paginer en augmentant `offset`.
   *
   * Note : la fonction PL/pgSQL ne renvoie pas de COUNT (volontairement, pour
   * éviter un second scan). Le caller doit ré-appeler avec offset si besoin.
   */
  totalAvailable: number
  /** Marker statique pour les logs / branches caller. */
  cacheUsed: true
  /** Âge des données (jours depuis le dernier import bulk INSEE). */
  cacheAgeDays: number
}

export interface SireneCacheHealth {
  /** True ssi aucun établissement actif n'est en cache (jamais importé). */
  isEmpty: boolean
  /** Jours écoulés depuis le dernier `imported_at` max (NaN si vide). */
  ageDays: number
  /** Nombre total d'établissements actifs en cache. */
  rowCount: number
}

// ------------------------------------------------------------
// TYPES INTERNES — shape brute renvoyée par la RPC / la vue
// ------------------------------------------------------------

/**
 * Row retournée par `search_sirene_cache(...)`. Mirror du `RETURNS TABLE`
 * de la migration 019. Types alignés sur PostgreSQL : `INT` → `number`,
 * `TEXT` → `string`.
 */
interface SireneCacheRow {
  siren: string
  siret: string
  raison_sociale: string | null
  activite_principale: string | null
  tranche_effectifs: string | null
  effectif_min: number | null
  effectif_max: number | null
  code_postal: string | null
  commune: string | null
  adresse: string | null
}

/**
 * Row de la vue `sirene_cache_size`. `days_since_import` est `NULL` quand le
 * cache est vide (pas d'`imported_at` max), à coercer en `NaN` côté TS.
 */
interface SireneCacheSizeRow {
  total_size: string | null
  total_bytes: number | null
  active_count: number | null
  last_import_at: string | null
  days_since_import: number | null
}

// ------------------------------------------------------------
// LOGGING
// ------------------------------------------------------------

function log(
  level: 'info' | 'warn' | 'error',
  message: string,
  data?: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      level,
      module: 'sirene-cache',
      msg: message,
      ...(data ?? {}),
    }),
  )
}

// ------------------------------------------------------------
// MAPPING — SireneCacheRow → SireneEtablissement (wire Sirene)
// ------------------------------------------------------------

/**
 * Adapte une row du cache au format `SireneEtablissement` (forme renvoyée
 * historiquement par l'API Sirene v3.11). Garantit la rétrocompatibilité
 * avec le pipeline existant (`enrichirProspect`, `buildDegradedProspect`,
 * `matchesAnyNaf`, scoring, etc.).
 *
 * Pertes acceptables (le cache ne stocke pas tout) :
 *   - `denominationUsuelle1UniteLegale` (rarement utilisé)
 *   - `nomUniteLegale`, `prenomUsuelUniteLegale` (entreprises individuelles)
 *   - `anneeEffectifsEtablissement` (millésime tranche INSEE)
 *   - `nomenclatureActivitePrincipaleEtablissement` (vaut systématiquement
 *     `NAFRev2` pour les codes 01.21Z stockés — implicite côté caller).
 *
 * `etatAdministratifEtablissement` est forcé à `'A'` car la fonction SQL
 * filtre déjà `WHERE etat_administratif = 'A'`.
 */
function toSireneEtablissement(row: SireneCacheRow): SireneEtablissement {
  const etab: SireneEtablissement = {
    siret: row.siret,
    siren: row.siren,
    etatAdministratifEtablissement: 'A',
  }
  if (row.raison_sociale) {
    etab.denominationUniteLegale = row.raison_sociale
  }
  if (row.activite_principale) {
    etab.activitePrincipaleEtablissement = row.activite_principale
  }
  if (row.tranche_effectifs) {
    etab.trancheEffectifsEtablissement = row.tranche_effectifs
  }
  if (row.code_postal) {
    etab.codePostalEtablissement = row.code_postal
  }
  if (row.commune) {
    etab.libelleCommuneEtablissement = row.commune
  }
  if (row.adresse || row.code_postal || row.commune) {
    etab.adresseEtablissement = {
      ...(row.adresse ? { libelleVoieEtablissement: row.adresse } : {}),
      ...(row.code_postal ? { codePostalEtablissement: row.code_postal } : {}),
      ...(row.commune ? { libelleCommuneEtablissement: row.commune } : {}),
    }
  }
  return etab
}

// ------------------------------------------------------------
// API PUBLIQUE — getSireneCacheHealth
// ------------------------------------------------------------

/**
 * Lit la vue de monitoring `sirene_cache_size` pour exposer la fraîcheur
 * et la volumétrie du cache.
 *
 * Retourne `null` si Supabase répond une erreur (table/vue manquante, droits
 * manquants, réseau). Le caller bascule alors comme si le cache était inutilisable.
 *
 * Cas `cache vide` (jamais importé) :
 *   - `active_count = 0`
 *   - `last_import_at = NULL` → `days_since_import = NULL` côté SQL,
 *     coercé en `NaN` côté TS.
 *   - On retourne `{ isEmpty: true, ageDays: NaN, rowCount: 0 }`.
 */
export async function getSireneCacheHealth(
  supabase: SupabaseAdminClient,
): Promise<SireneCacheHealth | null> {
  // La vue `sirene_cache_size` n'est pas (encore) dans `database.types.ts`
  // — on caste via `unknown` pour éviter un `as any` qui serait sentinelle.
  // Quand la migration 019 sera pushée + types regénérés, le cast devra
  // être supprimé.
  type SupabaseFrom = (table: string) => {
    select: (cols: string) => Promise<{
      data: SireneCacheSizeRow[] | null
      error: { message: string } | null
    }>
  }
  const client = supabase as unknown as { from: SupabaseFrom }

  try {
    const { data, error } = await client
      .from('sirene_cache_size')
      .select('active_count, last_import_at, days_since_import')

    if (error) {
      log('warn', 'getSireneCacheHealth: erreur Supabase (vue sirene_cache_size)', {
        error: error.message,
      })
      return null
    }

    // La vue retourne TOUJOURS exactement une ligne (agrégats globaux).
    // Si elle est absente (migration 019 non appliquée), on traite comme indispo.
    const row = data?.[0]
    if (!row) {
      log('warn', 'getSireneCacheHealth: vue sirene_cache_size vide ou indisponible')
      return null
    }

    const rowCount = typeof row.active_count === 'number' ? row.active_count : 0
    const isEmpty = rowCount === 0
    const ageDays =
      typeof row.days_since_import === 'number' && Number.isFinite(row.days_since_import)
        ? row.days_since_import
        : Number.NaN

    return { isEmpty, ageDays, rowCount }
  } catch (err) {
    log('warn', 'getSireneCacheHealth: exception inattendue', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// ------------------------------------------------------------
// API PUBLIQUE — searchSireneCache
// ------------------------------------------------------------

/**
 * Recherche multi-critères dans le cache SIRENE Supabase via la fonction
 * PL/pgSQL `search_sirene_cache(...)`. Drop-in remplaçant de
 * `sourcerEntreprises()` quand le cache est frais.
 *
 * Retourne `null` quand :
 *   - le cache est VIDE (rowCount = 0) → jamais importé / ETL pas encore tourné ;
 *   - le cache est OBSOLÈTE (ageDays > 60) → re-import nécessaire ;
 *   - une erreur Supabase est remontée (réseau, fonction manquante, etc.).
 *
 * Dans tous ces cas, le caller (sourcing-runner) doit fallback sur l'API
 * Sirene live (ou Recherche Entreprises en cascade).
 *
 * Le résultat retourné contient les `SireneEtablissement` au format wire
 * Sirene — rétrocompatible avec `enrichirProspect`, `matchesAnyNaf`, etc.
 */
export async function searchSireneCache(
  supabase: SupabaseAdminClient,
  params: SearchSireneCacheParams,
): Promise<SearchSireneCacheResult | null> {
  const {
    nafCodes,
    trancheEffectifs,
    codePostalRange,
    excludeSirens,
    pageSize = DEFAULT_PAGE_SIZE,
    offset = 0,
  } = params

  // 1. Health-check préalable. Évite l'appel coûteux si le cache est inutilisable.
  // On accepte le coût (~5ms) en échange d'un log structuré du motif d'échec.
  const health = await getSireneCacheHealth(supabase)
  if (!health) {
    // L'erreur a déjà été loguée dans getSireneCacheHealth — on bascule fallback.
    return null
  }
  if (health.isEmpty) {
    log('info', 'Cache SIRENE vide — fallback API live requis', {
      row_count: 0,
    })
    return null
  }
  if (!Number.isFinite(health.ageDays) || health.ageDays > CACHE_STALE_THRESHOLD_DAYS) {
    log('warn', 'Cache SIRENE obsolète — fallback API live requis', {
      age_days: Number.isFinite(health.ageDays) ? health.ageDays : null,
      threshold_days: CACHE_STALE_THRESHOLD_DAYS,
      row_count: health.rowCount,
    })
    return null
  }

  // 2. Appel RPC. Le typage `Functions` de `database.types.ts` ne contient pas
  // encore `search_sirene_cache` (sera regénéré après migration push) — on caste
  // via `unknown` pour ne pas polluer le code avec des `as any`.
  type SupabaseRpc = (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: SireneCacheRow[] | null
    error: { message: string } | null
  }>
  const client = supabase as unknown as { rpc: SupabaseRpc }

  try {
    const { data, error } = await client.rpc('search_sirene_cache', {
      p_naf_codes: nafCodes,
      p_tranche_effectifs: trancheEffectifs,
      p_code_postal_min: codePostalRange?.[0] ?? null,
      p_code_postal_max: codePostalRange?.[1] ?? null,
      p_exclude_sirens: excludeSirens,
      p_limit: pageSize,
      p_offset: offset,
    })

    if (error) {
      log('warn', 'searchSireneCache: RPC search_sirene_cache erreur', {
        error: error.message,
        naf_count: nafCodes.length,
        tranche_count: trancheEffectifs.length,
        exclude_count: excludeSirens.length,
      })
      return null
    }

    const rows = data ?? []
    const etablissements = rows.map(toSireneEtablissement)

    log('info', 'Cache SIRENE utilisé', {
      rows_returned: etablissements.length,
      page_size: pageSize,
      offset,
      cache_age_days: health.ageDays,
      cache_row_count: health.rowCount,
    })

    return {
      etablissements,
      // Approximation : si on a rempli la page, le cache contient potentiellement
      // d'autres rows (le caller doit ré-appeler avec offset+pageSize). Sinon,
      // `totalAvailable` = nombre réellement retourné.
      totalAvailable: etablissements.length,
      cacheUsed: true,
      cacheAgeDays: health.ageDays,
    }
  } catch (err) {
    log('warn', 'searchSireneCache: exception inattendue', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
