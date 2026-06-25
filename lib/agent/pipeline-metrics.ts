// ============================================================
// PIPELINE METRICS — Lecture des métriques agrégées du pipeline
//
// Reader typé sur la vue Postgres `pipeline_metrics_daily`
// (cf. supabase/migrations/032_pipeline_metrics.sql).
//
// La vue agrège `agent_runs` PAR JOUR et PAR USER : volumétrie des
// runs, taux de succès, durées moyenne/médiane, totaux sourcés/
// qualifiés, taux de qualification.
//
// SÉCURITÉ : la vue est SECURITY INVOKER (security_invoker=true) →
// elle hérite de la RLS de `agent_runs`. Avec un client SSR (session
// user), un utilisateur ne lit QUE ses propres métriques. Avec le
// client admin (service_role, orchestrateur monitoring), RLS bypassée
// → toutes lignes visibles. On ne double JAMAIS le filtrage par
// `.eq('user_id', ...)` côté SSR (anti-pattern, cf. rules/security.md).
//
// Cf. supabase/migrations/032_pipeline_metrics.sql.
// ============================================================

import type { SupabaseAdminClient, SupabaseServerClient } from '@/lib/supabase/server'

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

/** Nombre max de lignes (jours × users) renvoyées par défaut. */
const DEFAULT_LIMIT = 90

// ------------------------------------------------------------
// TYPES PUBLICS
// ------------------------------------------------------------

/**
 * Une ligne de la vue `pipeline_metrics_daily` : agrégat d'un jour
 * calendaire pour un user. Types alignés sur le mapping côté reader
 * (les agrégats numériques Postgres sont coercés en `number`, les
 * ratios potentiellement `NULL` en `number | null`).
 */
export interface PipelineMetricsDaily {
  /** Jour calendaire (ISO `YYYY-MM-DD`, date de `started_at`). */
  day: string
  /** Tenant (UUID auth.users). */
  userId: string
  /** Nombre total de runs ce jour-là. */
  runsTotal: number
  /** Runs terminés avec succès (`status='completed'`). */
  runsCompleted: number
  /** Runs en échec (`status='failed'`). */
  runsFailed: number
  /** Runs encore en cours (`status='running'`, non terminés). */
  runsRunning: number
  /** Taux de succès `runsCompleted / runsTotal` (0..1). `null` si indéfini. */
  successRate: number | null
  /** Runs ayant effectivement généré une liste (`list_generated=TRUE`). */
  listsGenerated: number
  /** Somme `prospects_sourced` sur le jour. */
  totalSourced: number
  /** Somme `prospects_qualified` sur le jour. */
  totalQualified: number
  /**
   * Taux de qualification `totalQualified / totalSourced` (0..1).
   * `null` si aucun prospect sourcé (division par zéro évitée côté SQL).
   */
  qualificationRate: number | null
  /** Durée moyenne des runs terminés, en secondes. `null` si aucun terminé. */
  avgDurationSeconds: number | null
  /** Durée médiane des runs terminés, en secondes. `null` si aucun terminé. */
  medianDurationSeconds: number | null
}

export interface GetPipelineMetricsDailyOptions {
  /**
   * Filtre optionnel sur un user précis. À n'utiliser QUE côté admin
   * (service_role) pour cibler un tenant : côté SSR la RLS filtre déjà,
   * ne pas l'utiliser pour « double-vérifier » (anti-pattern).
   */
  userId?: string
  /** Borne basse inclusive sur `day` (ISO `YYYY-MM-DD`). */
  fromDay?: string
  /** Borne haute inclusive sur `day` (ISO `YYYY-MM-DD`). */
  toDay?: string
  /** Nombre max de lignes. Défaut : 90. */
  limit?: number
}

// ------------------------------------------------------------
// TYPES INTERNES — shape brute renvoyée par la vue
// ------------------------------------------------------------

/**
 * Row brute de `pipeline_metrics_daily`. PostgREST sérialise les
 * agrégats `numeric` (success_rate, ratios, durées) en `string` JSON
 * et les `bigint`/`int` (COUNT/SUM) en `number`. On type donc
 * largement en `number | string | null` et on normalise dans le mapper.
 */
interface PipelineMetricsRow {
  day: string
  user_id: string
  runs_total: number | string
  runs_completed: number | string
  runs_failed: number | string
  runs_running: number | string
  success_rate: number | string | null
  lists_generated: number | string
  total_sourced: number | string
  total_qualified: number | string
  qualification_rate: number | string | null
  avg_duration_seconds: number | string | null
  median_duration_seconds: number | string | null
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
      module: 'pipeline-metrics',
      msg: message,
      ...(data ?? {}),
    }),
  )
}

// ------------------------------------------------------------
// MAPPING — PipelineMetricsRow → PipelineMetricsDaily
// ------------------------------------------------------------

/** Coerce un agrégat entier (`number | string`) en `number` sûr. */
function toInt(value: number | string): number {
  const n = typeof value === 'number' ? value : Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * Coerce un ratio/durée `numeric` PostgREST (`number | string | null`)
 * en `number | null`. `NULL` SQL (division par zéro, aucun run terminé)
 * → `null` TS. Un parse invalide → `null` (jamais `NaN` qui casserait l'UI).
 */
function toNullableFloat(value: number | string | null): number | null {
  if (value === null) return null
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(n) ? n : null
}

function toPipelineMetrics(row: PipelineMetricsRow): PipelineMetricsDaily {
  return {
    day: row.day,
    userId: row.user_id,
    runsTotal: toInt(row.runs_total),
    runsCompleted: toInt(row.runs_completed),
    runsFailed: toInt(row.runs_failed),
    runsRunning: toInt(row.runs_running),
    successRate: toNullableFloat(row.success_rate),
    listsGenerated: toInt(row.lists_generated),
    totalSourced: toInt(row.total_sourced),
    totalQualified: toInt(row.total_qualified),
    qualificationRate: toNullableFloat(row.qualification_rate),
    avgDurationSeconds: toNullableFloat(row.avg_duration_seconds),
    medianDurationSeconds: toNullableFloat(row.median_duration_seconds),
  }
}

// ------------------------------------------------------------
// API PUBLIQUE — getPipelineMetricsDaily
// ------------------------------------------------------------

/**
 * Lit la vue `pipeline_metrics_daily` et renvoie les agrégats triés du
 * plus récent au plus ancien (`day DESC`).
 *
 * Accepte aussi bien un client SSR (RLS filtre par session user) qu'un
 * client admin (service_role, toutes lignes). Renvoie `[]` sur erreur
 * Supabase (vue absente, droits, réseau) après log — le caller décide
 * de l'affichage dégradé.
 *
 * @param client   Client Supabase (SSR ou admin).
 * @param opts     Filtres optionnels (userId, fenêtre fromDay/toDay, limit).
 */
export async function getPipelineMetricsDaily(
  client: SupabaseServerClient | SupabaseAdminClient,
  opts: GetPipelineMetricsDailyOptions = {},
): Promise<PipelineMetricsDaily[]> {
  const { userId, fromDay, toDay, limit = DEFAULT_LIMIT } = opts

  // La vue `pipeline_metrics_daily` n'est pas (encore) dans
  // `database.types.ts` (à regénérer après push de la migration 032).
  // On caste via `unknown` pour éviter un `as any` qui serait sentinelle.
  type QueryResult = Promise<{
    data: PipelineMetricsRow[] | null
    error: { message: string } | null
  }>
  interface MetricsQueryBuilder {
    eq: (col: string, value: string) => MetricsQueryBuilder
    gte: (col: string, value: string) => MetricsQueryBuilder
    lte: (col: string, value: string) => MetricsQueryBuilder
    order: (col: string, opts: { ascending: boolean }) => MetricsQueryBuilder
    limit: (n: number) => MetricsQueryBuilder & QueryResult
  }
  type MetricsClient = {
    from: (table: string) => { select: (cols: string) => MetricsQueryBuilder }
  }
  const typedClient = client as unknown as MetricsClient

  try {
    let query = typedClient.from('pipeline_metrics_daily').select('*')

    // Filtre user_id : pertinent uniquement côté admin. Côté SSR la RLS
    // filtre déjà ; on n'ajoute ce `.eq` que si le caller le demande
    // explicitement (ex. monitoring back-office ciblé).
    if (userId) {
      query = query.eq('user_id', userId)
    }
    if (fromDay) {
      query = query.gte('day', fromDay)
    }
    if (toDay) {
      query = query.lte('day', toDay)
    }

    const { data, error } = await query
      .order('day', { ascending: false })
      .limit(limit)

    if (error) {
      log('warn', 'getPipelineMetricsDaily: erreur Supabase (vue pipeline_metrics_daily)', {
        error: error.message,
      })
      return []
    }

    return (data ?? []).map(toPipelineMetrics)
  } catch (err) {
    log('warn', 'getPipelineMetricsDaily: exception inattendue', {
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}
