// ============================================================
// RATE-LIMITING par utilisateur — self-contained (Postgres)
//
// Anti-abus des routes coûteuses : quotas LLM (OpenAI), Hunter, Pappers, et
// anti-spam Resend. Aucun rate-limit n'existait avant cet helper.
//
// Conception :
//   - Stockage dans `public.rate_limit_hits` (migration 031), écrit via le
//     client admin (service_role) — pas de dépendance externe (Upstash/Redis),
//     compatible serverless Vercel.
//   - Fenêtre glissante simple ("tumbling window") : `window_start` est l'instant
//     `now()` tronqué à la taille de fenêtre du bucket. Tous les hits d'une même
//     fenêtre partagent la même ligne, incrémentée atomiquement via le RPC
//     `increment_rate_limit` (UPSERT ON CONFLICT — pas de course read/write).
//
// Fail-open :
//   Si la DB du limiteur a un souci (RPC en erreur, réseau, etc.), on NE BLOQUE
//   PAS l'utilisateur légitime — on log via Sentry et on autorise. Le limiteur
//   est une protection best-effort, pas un point de défaillance dur du produit.
//
// Désactivation en test :
//   En environnement de test (NODE_ENV === 'test') ou via RATE_LIMIT_DISABLED,
//   le limiteur est un no-op (allowed: true) et ne touche jamais la DB — la
//   suite de tests des routes (qui ne mocke pas le client admin) reste verte.
// ============================================================

import type { SupabaseAdminClient } from '@/lib/supabase/server'
import { captureWithContext } from '@/lib/observability/sentry-helpers'

// ------------------------------------------------------------
// TYPES
// ------------------------------------------------------------

export interface RateLimitOptions {
  /** Nombre maximum de hits autorisés par fenêtre. */
  limit: number
  /** Taille de la fenêtre en secondes. */
  windowSec: number
}

export interface RateLimitResult {
  /** `false` ssi la limite est dépassée (le hit courant est compté). */
  allowed: boolean
  /** Hits restants dans la fenêtre courante (>= 0). */
  remaining: number
  /** Secondes avant le début de la prochaine fenêtre (pour l'en-tête Retry-After). */
  retryAfter: number
}

// ------------------------------------------------------------
// HELPERS INTERNES
// ------------------------------------------------------------

/**
 * Limiteur désactivé en test pour ne pas casser la suite (les tests des routes
 * ne mockent pas le client admin / la table rate_limit_hits) et offrir un
 * échappatoire d'exploitation via flag d'env.
 */
function isDisabled(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.RATE_LIMIT_DISABLED === 'true'
  )
}

/**
 * Tronque un timestamp (ms epoch) au début de la fenêtre de taille `windowSec`.
 * Les fenêtres sont alignées sur l'epoch (déterministe, sans état partagé).
 */
function windowStartIso(nowMs: number, windowSec: number): {
  windowStartMs: number
  iso: string
} {
  const windowMs = windowSec * 1000
  const windowStartMs = Math.floor(nowMs / windowMs) * windowMs
  return { windowStartMs, iso: new Date(windowStartMs).toISOString() }
}

// ------------------------------------------------------------
// API PUBLIQUE
// ------------------------------------------------------------

/**
 * Vérifie et consomme un hit de rate-limit pour `(userId, bucket)`.
 *
 * @param adminClient   Client service_role (bypass RLS, écrit `rate_limit_hits`),
 *                      OU une factory `() => client`. La factory est appelée
 *                      uniquement quand le limiteur est actif — ainsi, en test
 *                      (no-op), aucun client admin n'est instancié, ce qui évite
 *                      d'imposer aux tests des routes de mocker `createAdminClient`.
 * @param userId        UUID auth.users.id.
 * @param bucket        Identifiant logique du seau (ex. 'agent_run').
 * @param opts          { limit, windowSec }.
 * @returns { allowed, remaining, retryAfter }. Fail-open en cas d'erreur DB.
 */
export async function checkRateLimit(
  adminClient: SupabaseAdminClient | (() => SupabaseAdminClient),
  userId: string,
  bucket: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  // No-op en test / si explicitement désactivé. On NE résout PAS la factory ici
  // pour ne pas instancier de client admin inutilement (cf. tests des routes).
  if (isDisabled()) {
    return { allowed: true, remaining: opts.limit, retryAfter: 0 }
  }

  const supabaseAdmin =
    typeof adminClient === 'function' ? adminClient() : adminClient

  const nowMs = Date.now()
  const { windowStartMs, iso } = windowStartIso(nowMs, opts.windowSec)
  // Secondes restantes jusqu'à la prochaine fenêtre (borne basse à 1s).
  const retryAfter = Math.max(
    1,
    Math.ceil((windowStartMs + opts.windowSec * 1000 - nowMs) / 1000),
  )

  try {
    // RPC d'incrément atomique — renvoie le compteur APRÈS incrément.
    // Cast `as never` sur le nom de la RPC : `increment_rate_limit` (migration
    // 031) n'est pas encore dans les types Supabase générés (database.types.ts),
    // régénérés via scripts/regen-supabase-types.ps1 après push de la migration.
    const { data, error } = await supabaseAdmin.rpc(
      'increment_rate_limit' as never,
      {
        p_user_id: userId,
        p_bucket: bucket,
        p_window_start: iso,
      } as never,
    )

    if (error) {
      // FAIL-OPEN : ne pas bloquer un user légitime si le limiteur est en panne.
      captureWithContext(error, {
        pipeline_phase: 'notification',
        extra: { module: 'rate-limit', bucket, reason: 'rpc_error' },
      })
      return { allowed: true, remaining: opts.limit, retryAfter: 0 }
    }

    const count = typeof data === 'number' ? data : Number(data)
    if (!Number.isFinite(count)) {
      // Réponse inattendue → fail-open.
      return { allowed: true, remaining: opts.limit, retryAfter: 0 }
    }

    const allowed = count <= opts.limit
    const remaining = Math.max(0, opts.limit - count)
    return { allowed, remaining, retryAfter }
  } catch (err) {
    // FAIL-OPEN : toute exception (réseau, etc.) autorise mais est loggée.
    captureWithContext(err, {
      pipeline_phase: 'notification',
      extra: { module: 'rate-limit', bucket, reason: 'exception' },
    })
    return { allowed: true, remaining: opts.limit, retryAfter: 0 }
  }
}

/**
 * Construit une réponse 429 standardisée (avec en-tête Retry-After) à partir
 * d'un `RateLimitResult` refusé. Centralisé pour homogénéiser les 4 routes.
 */
export function rateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      error: 'Trop de requêtes — réessayez plus tard.',
      code: 'RATE_LIMITED',
      retryAfter: result.retryAfter,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(result.retryAfter),
      },
    },
  )
}
