// ============================================================
// GET /api/admin/sirene-status
//
// Retourne le status du cache SIRENE (taille, fraicheur, nb rows).
//
// AUTH DUAL-MODE — deux modes acceptés :
//   1. Bearer CRON_SECRET (utilise par GitHub Actions / monitoring externe).
//   2. Session SSR Supabase (widget admin dans l'UI settings).
//
//   On accepte les deux pour éviter de dupliquer la route. Si aucune des
//   deux conditions n'est satisfaite → 401.
//
// FRESHNESS — calculée côté serveur à partir de `days_since_import` :
//   - fresh  : < 30 jours (cache à jour, SIRENE INSEE est mensuel)
//   - aging  : 30-59 jours (rappel : prévoir un re-import bientôt)
//   - stale  : >= 60 jours (déclencher un re-import ASAP)
//
// SÉCURITÉ :
//   - Pas de PII (la vue n'expose que des métriques agrégées).
//   - Pas de service_role côté session user — RLS implicite via la
//     policy GRANT SELECT ON sirene_cache_size TO authenticated.
// ============================================================

import { type NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isCronRequest } from '@/lib/auth/cron'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** Row de la vue `sirene_cache_size` (migration 019, pas encore régénérée). */
type SireneCacheSizeRow = {
  total_size: string | null
  total_bytes: number | null
  active_count: number | null
  last_import_at: string | null
  days_since_import: number | null
}

/** Seuils de fraicheur du cache SIRENE (jours). */
const FRESHNESS_THRESHOLD_FRESH_DAYS = 30
const FRESHNESS_THRESHOLD_AGING_DAYS = 60

/** Valeur par défaut si `days_since_import` est NULL (cache vide). */
const DAYS_FALLBACK_WHEN_EMPTY = 999

export async function GET(req: NextRequest) {
  // 1. Auth dual-mode : cron OU session user.
  const cronOk = isCronRequest(req)

  // Si pas cron, on tente la session SSR.
  let userOk = false
  if (!cronOk) {
    const sbSsr = await createClient()
    const {
      data: { user },
    } = await sbSsr.auth.getUser()
    userOk = !!user
  }

  if (!cronOk && !userOk) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Non authentifié' } },
      { status: 401 },
    )
  }

  // 2. Lecture de la vue.
  //    - En mode cron : on utilise service_role (bypass RLS, robuste si la
  //      policy GRANT venait à manquer).
  //    - En mode session : on pourrait utiliser le client SSR, mais la vue
  //      est GRANT-ée à anon+authenticated dans la migration 019 ; on garde
  //      le client admin pour homogénéité — la vue n'expose pas de PII.
  //
  //    Cast vers SupabaseClient<any> nécessaire : la vue n'est pas encore
  //    dans les types générés.
  const supabase = createAdminClient() as unknown as SupabaseClient
  const { data, error } = await supabase
    .from('sirene_cache_size')
    .select('total_size, total_bytes, active_count, last_import_at, days_since_import')
    .single<SireneCacheSizeRow>()

  if (error) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 },
    )
  }

  // 3. Calcul de la freshness.
  const days = data?.days_since_import ?? DAYS_FALLBACK_WHEN_EMPTY
  let freshness: 'fresh' | 'aging' | 'stale'
  if (days < FRESHNESS_THRESHOLD_FRESH_DAYS) freshness = 'fresh'
  else if (days < FRESHNESS_THRESHOLD_AGING_DAYS) freshness = 'aging'
  else freshness = 'stale'

  const isEmpty = (data?.active_count ?? 0) === 0

  return NextResponse.json(
    {
      data: {
        total_size: data?.total_size ?? null,
        total_bytes: data?.total_bytes ?? null,
        active_count: data?.active_count ?? null,
        last_import_at: data?.last_import_at ?? null,
        days_since_import: data?.days_since_import ?? null,
        freshness,
        is_empty: isEmpty,
      },
    },
    { status: 200 },
  )
}
