// ============================================================
// QUOTAS — Agent IA Prospection Bilan Carbone
// Gestion des quotas d'API tierces (Pappers / Hunter / INPI / Google CSE)
// persistés en DB (table `api_quotas`) — survivent aux cold starts Vercel.
//
// Migration A1 attendue : table `api_quotas` avec colonnes
//   (id, user_id, provider, used_count, limit_count, month_start)
//   + UNIQUE (user_id, provider, month_start)
//   + RLS (auth.uid() = user_id)
//
// Reset automatique : un nouveau `month_start` au 1er du mois courant.
// Defense in depth : refundQuota plancher 0 même si la CHECK constraint DB
// devrait l'empêcher.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

// ------------------------------------------------------------
// TYPES
// ------------------------------------------------------------

export type QuotaProvider = 'pappers' | 'hunter' | 'inpi' | 'google_cse'

export const QUOTA_PROVIDERS: readonly QuotaProvider[] = [
  'pappers',
  'hunter',
  'inpi',
  'google_cse',
] as const

/**
 * Limites des free tiers (mensuelles) :
 *   - Pappers     : 100 req/mois (free tier)
 *   - Hunter      : 25 req/mois (free tier)
 *   - INPI        : pas de quota strict — 10000 = garde-fou observabilité
 *   - Google CSE  : 100/jour = 3000/mois théorique
 */
export const QUOTA_LIMITS: Record<QuotaProvider, number> = {
  pappers: 100,
  hunter: 25,
  inpi: 10000,
  google_cse: 3000,
}

export interface QuotaState {
  provider: QuotaProvider
  used: number
  remaining: number
  limit: number
  monthStart: string // ISO date YYYY-MM-DD
  exhausted: boolean
}

// ------------------------------------------------------------
// HELPERS INTERNES
// ------------------------------------------------------------

const TABLE = 'api_quotas'

/** Premier jour du mois courant au format YYYY-MM-DD (UTC-safe via composants locaux). */
function getCurrentMonthStart(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

/** ID tronqué (4 chars) pour logs — pas de PII complète. */
function shortId(userId: string): string {
  return userId.slice(0, 4)
}

interface LogEntry {
  module: 'quotas'
  user_id: string
  provider: QuotaProvider
  action: 'get' | 'create' | 'consume' | 'refund' | 'exhausted' | 'error'
  used?: number
  limit?: number
  remaining?: number
  level?: 'info' | 'warn' | 'error'
  msg?: string
}

function log(entry: LogEntry): void {
  const level = entry.level ?? 'info'
  console.log(JSON.stringify({ ...entry, level }))
}

// Le type Database peut ne pas encore exporter la table api_quotas.
// On utilise un client générique pour ne pas casser le type-check.
// Quand la table sera ajoutée à database.types.ts, ce module restera compatible.
type AnyClient = SupabaseClient<any, 'public', any>

interface QuotaRow {
  id?: string
  user_id: string
  provider: QuotaProvider
  used_count: number
  limit_count: number
  month_start: string
}

// ------------------------------------------------------------
// API PUBLIQUE
// ------------------------------------------------------------

/**
 * Récupère l'état du quota pour (user, provider, mois courant).
 * Crée la ligne avec used=0 si absente, ou si le `month_start` en base est antérieur
 * (= reset mensuel automatique).
 */
export async function getQuotaState(
  supabase: SupabaseClient,
  userId: string,
  provider: QuotaProvider,
): Promise<QuotaState> {
  const monthStart = getCurrentMonthStart()
  const limit = QUOTA_LIMITS[provider]
  const client = supabase as unknown as AnyClient

  // 1. Lecture de la ligne du mois courant
  const { data: existing, error: selectError } = await client
    .from(TABLE)
    .select('used_count, limit_count, month_start')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('month_start', monthStart)
    .maybeSingle()

  if (selectError) {
    log({
      module: 'quotas',
      user_id: shortId(userId),
      provider,
      action: 'error',
      level: 'error',
      msg: `select failed: ${selectError.message}`,
    })
    // Mode dégradé : on retourne un état "vide" non épuisé pour ne pas bloquer le pipeline
    return {
      provider,
      used: 0,
      remaining: limit,
      limit,
      monthStart,
      exhausted: false,
    }
  }

  if (existing) {
    const row = existing as Pick<QuotaRow, 'used_count' | 'limit_count' | 'month_start'>
    const used = row.used_count ?? 0
    const effectiveLimit = row.limit_count ?? limit
    return {
      provider,
      used,
      remaining: Math.max(0, effectiveLimit - used),
      limit: effectiveLimit,
      monthStart,
      exhausted: used >= effectiveLimit,
    }
  }

  // 2. Pas de ligne pour le mois courant → on crée (upsert idempotent)
  const { error: insertError } = await client.from(TABLE).upsert(
    {
      user_id: userId,
      provider,
      month_start: monthStart,
      used_count: 0,
      limit_count: limit,
    } as never,
    { onConflict: 'user_id,provider,month_start', ignoreDuplicates: true },
  )

  if (insertError) {
    log({
      module: 'quotas',
      user_id: shortId(userId),
      provider,
      action: 'error',
      level: 'error',
      msg: `upsert failed: ${insertError.message}`,
    })
  } else {
    log({
      module: 'quotas',
      user_id: shortId(userId),
      provider,
      action: 'create',
      used: 0,
      limit,
    })
  }

  return {
    provider,
    used: 0,
    remaining: limit,
    limit,
    monthStart,
    exhausted: false,
  }
}

/**
 * Check + incrément atomique (best-effort) du quota.
 * - Assure que la ligne du mois courant existe (via getQuotaState).
 * - UPDATE conditionnel : `used_count = used_count + amount WHERE used_count + amount <= limit_count`
 *   → si 0 ligne retournée, quota épuisé.
 *
 * Race rare possible en absence de RPC ; acceptable car un user = un cron à la fois en pratique.
 */
export async function consumeQuota(
  supabase: SupabaseClient,
  userId: string,
  provider: QuotaProvider,
  amount: number = 1,
): Promise<{ ok: boolean; remaining: number }> {
  const monthStart = getCurrentMonthStart()
  const client = supabase as unknown as AnyClient

  // 1. S'assurer que la ligne existe (création si besoin)
  const state = await getQuotaState(supabase, userId, provider)

  if (state.exhausted || state.remaining < amount) {
    log({
      module: 'quotas',
      user_id: shortId(userId),
      provider,
      action: 'exhausted',
      level: 'warn',
      used: state.used,
      limit: state.limit,
      remaining: state.remaining,
    })
    return { ok: false, remaining: state.remaining }
  }

  // 2. UPDATE conditionnel atomic : on n'incrémente que si on ne dépasse pas la limite.
  const newUsed = state.used + amount
  const { data, error } = await client
    .from(TABLE)
    .update({ used_count: newUsed } as never)
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('month_start', monthStart)
    .eq('used_count', state.used) // garde anti-race minimale (optimistic locking)
    .select('used_count, limit_count')

  if (error) {
    log({
      module: 'quotas',
      user_id: shortId(userId),
      provider,
      action: 'error',
      level: 'error',
      msg: `consume update failed: ${error.message}`,
    })
    return { ok: false, remaining: state.remaining }
  }

  const rows = (data ?? []) as Array<{ used_count: number; limit_count: number }>
  if (rows.length === 0) {
    // Race perdue (qqn a déjà incrémenté) — on considère comme épuisé pour ce tour.
    log({
      module: 'quotas',
      user_id: shortId(userId),
      provider,
      action: 'exhausted',
      level: 'warn',
      msg: 'race lost on update',
    })
    return { ok: false, remaining: 0 }
  }

  const updated = rows[0]
  const remaining = Math.max(0, updated.limit_count - updated.used_count)
  log({
    module: 'quotas',
    user_id: shortId(userId),
    provider,
    action: 'consume',
    used: updated.used_count,
    limit: updated.limit_count,
    remaining,
  })

  return { ok: true, remaining }
}

/**
 * Décrémente le quota (refund en cas d'erreur API).
 * Defense in depth : plancher 0 côté code, même si la CHECK constraint DB
 * (used_count >= 0) doit l'empêcher.
 */
export async function refundQuota(
  supabase: SupabaseClient,
  userId: string,
  provider: QuotaProvider,
  amount: number = 1,
): Promise<void> {
  const monthStart = getCurrentMonthStart()
  const client = supabase as unknown as AnyClient

  // Lire l'état courant pour calculer la nouvelle valeur (plancher 0)
  const { data: row, error: selectError } = await client
    .from(TABLE)
    .select('used_count')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('month_start', monthStart)
    .maybeSingle()

  if (selectError || !row) {
    log({
      module: 'quotas',
      user_id: shortId(userId),
      provider,
      action: 'error',
      level: 'warn',
      msg: 'refund: no row to refund (no-op)',
    })
    return
  }

  const current = (row as { used_count: number }).used_count ?? 0
  const newUsed = Math.max(0, current - amount)
  if (newUsed === current) return

  const { error: updateError } = await client
    .from(TABLE)
    .update({ used_count: newUsed } as never)
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('month_start', monthStart)

  if (updateError) {
    log({
      module: 'quotas',
      user_id: shortId(userId),
      provider,
      action: 'error',
      level: 'error',
      msg: `refund update failed: ${updateError.message}`,
    })
    return
  }

  log({
    module: 'quotas',
    user_id: shortId(userId),
    provider,
    action: 'refund',
    used: newUsed,
  })
}

/**
 * Wrappe un appel API : check quota, consume, exécute, refund on error.
 *
 * Retourne :
 *   - { data, quotaExhausted: false, error: null } : succès
 *   - { data: null, quotaExhausted: true, error: 'QUOTA_EXHAUSTED' } : quota épuisé (fn pas appelée)
 *   - { data: null, quotaExhausted: false, error: '<msg>' } : fn a throw → refund effectué
 */
export async function withQuota<T>(
  supabase: SupabaseClient,
  userId: string,
  provider: QuotaProvider,
  fn: () => Promise<T>,
): Promise<{ data: T | null; quotaExhausted: boolean; error: string | null }> {
  const { ok } = await consumeQuota(supabase, userId, provider, 1)
  if (!ok) {
    return { data: null, quotaExhausted: true, error: 'QUOTA_EXHAUSTED' }
  }

  try {
    const data = await fn()
    return { data, quotaExhausted: false, error: null }
  } catch (err) {
    // Rendre le crédit consommé (l'appel a échoué, ce n'est pas une utilisation effective)
    await refundQuota(supabase, userId, provider, 1)
    const message = err instanceof Error ? err.message : String(err)
    return { data: null, quotaExhausted: false, error: message }
  }
}

/**
 * Récupère l'état de tous les quotas (mois courant) pour un user.
 * Utilisé par le widget UI (dashboard).
 */
export async function getAllQuotas(
  supabase: SupabaseClient,
  userId: string,
): Promise<QuotaState[]> {
  const results = await Promise.all(
    QUOTA_PROVIDERS.map((p) => getQuotaState(supabase, userId, p)),
  )
  return results
}
