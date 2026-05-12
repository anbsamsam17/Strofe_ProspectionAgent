// ============================================================
// OBSERVABILITY — Helpers Sentry
//
// Centralise :
//   1. Le scrub PII (emails + téléphones) — utilisé par `beforeSend` et par
//      les `captureException` directs pour garantir un comportement uniforme.
//   2. Les helpers de capture avec tags normalisés (`pipeline_phase`, `api`,
//      `run_id`, `user.id`) — pour pouvoir filtrer dans Sentry.
//   3. Un compteur d'échecs consécutifs anti-spam (pour les fetch failed dans
//      enrichirContact qui pourraient tirer 15 erreurs identiques).
//
// PII scrub :
//   - Emails (regex RFC-lite) → "[email]"
//   - Téléphones FR (10 chiffres, +33...) → "[phone]"
//   - Appliqué récursivement sur strings de tout le payload Sentry.
//
// NE PAS scrub :
//   - Les messages d'erreur eux-mêmes (Sirene "Erreur de syntaxe...", Pappers
//     401, etc.) — ce sont des signaux de debug, pas des PII.
//   - Les SIREN (identifiant entreprise, public, jamais PII).
// ============================================================

import * as Sentry from '@sentry/nextjs'
import type { ErrorEvent } from '@sentry/core'

// ------------------------------------------------------------
// TYPES PUBLICS
// ------------------------------------------------------------

export type PipelinePhase =
  | 'sourcing'
  | 'enrichment'
  | 'scoring'
  | 'pitch'
  | 'daily_list'
  | 'notification'

export type ExternalApi =
  | 'sirene'
  | 'recherche_entreprises'
  | 'ademe'
  | 'pappers'
  | 'hunter'
  | 'openai'
  | 'resend'

/** Contexte normalisé pour `captureException` du pipeline. */
export interface PipelineErrorContext {
  pipeline_phase: PipelinePhase
  api?: ExternalApi
  /** UUID du run agent_runs.id pour corréler avec la DB. */
  run_id?: string
  /** UUID auth.users.id — sera mappé sur `user.id` côté Sentry. */
  user_id?: string
  /** Status HTTP si erreur API externe. */
  http_status?: number
  /** Données supplémentaires non-PII (curseur, page, count, etc.). */
  extra?: Record<string, unknown>
}

// ------------------------------------------------------------
// SCRUB PII
// ------------------------------------------------------------

// Regex emails — volontairement large mais limite les faux positifs.
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

// Téléphones FR : +33 X XX XX XX XX, 0X XX XX XX XX, avec ou sans séparateurs.
// On match 10 chiffres consécutifs (avec séparateurs optionnels) OU +33 suivi de 9 chiffres.
const PHONE_REGEX_FR = /(?:\+33|0033|0)\s*[1-9](?:[\s.-]?\d{2}){4}/g

// E.164 international générique (11-15 chiffres précédés de +).
const PHONE_REGEX_E164 = /\+\d{10,15}/g

/**
 * Remplace emails et téléphones par des placeholders dans une chaîne.
 * Exporté pour permettre des tests directs et un usage en dehors de Sentry.
 */
export function scrubPiiString(s: string): string {
  return s
    .replace(EMAIL_REGEX, '[email]')
    .replace(PHONE_REGEX_FR, '[phone]')
    .replace(PHONE_REGEX_E164, '[phone]')
}

/**
 * Parcourt récursivement un objet/array et applique `scrubPiiString` sur toutes
 * les chaînes. Mutation-safe : retourne une nouvelle structure (pas de side-effect).
 *
 * Limite de profondeur (depth) pour éviter une boucle infinie sur des objets
 * cycliques que Sentry pourrait nous passer.
 */
function scrubPiiDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return value
  if (typeof value === 'string') return scrubPiiString(value)
  if (Array.isArray(value)) return value.map((v) => scrubPiiDeep(v, depth + 1))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubPiiDeep(v, depth + 1)
    }
    return out
  }
  return value
}

/**
 * `beforeSend` Sentry — scrub PII sur le payload entier avant envoi.
 *
 * Applique le scrub sur :
 *   - `message` (top-level)
 *   - `exception.values[].value` (message d'exception)
 *   - `breadcrumbs[].message` + `breadcrumbs[].data`
 *   - `contexts.*`
 *   - `extra.*`
 *   - `request.*` (body, headers)
 *
 * Ne scrub PAS `tags` (clés/valeurs courtes, pas de PII attendue) ni `user.id`
 * (UUID Supabase, pas une donnée perso au sens RGPD).
 *
 * Signature compatible avec le contrat `beforeSend` de Sentry SDK 9 :
 * `(event: ErrorEvent) => ErrorEvent | null`.
 *
 * @returns le `event` modifié (même shape, strings scrubbées) — Sentry l'envoie tel quel.
 */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  // Cast double `unknown` car le type ErrorEvent de Sentry est plus strict que
  // `Record<string, unknown>` (champs `type`, `event_id`, etc. typés). On garantit
  // que `scrubPiiDeep` préserve la shape (seules les chaînes terminales sont remplacées).
  return scrubPiiDeep(event) as unknown as ErrorEvent
}

// ------------------------------------------------------------
// CAPTURE EXCEPTION TYPÉE
// ------------------------------------------------------------

/**
 * Wrapper autour de `Sentry.captureException` qui :
 *   - Applique les tags normalisés (pipeline_phase, api, run_id, http_status)
 *   - Setup le contexte user (id uniquement, pas d'email)
 *   - Met les extras dans `extra` (filtrés via scrubSentryEvent au moment de l'envoi)
 *
 * Usage :
 *   captureWithContext(err, {
 *     pipeline_phase: 'sourcing',
 *     api: 'sirene',
 *     run_id: run.id,
 *     user_id: run.user_id,
 *     http_status: 400,
 *     extra: { curseur: '*', page: 1 },
 *   })
 */
export function captureWithContext(
  err: unknown,
  ctx: PipelineErrorContext,
): void {
  Sentry.withScope((scope) => {
    scope.setTag('pipeline_phase', ctx.pipeline_phase)
    if (ctx.api) scope.setTag('api', ctx.api)
    if (ctx.run_id) scope.setTag('run_id', ctx.run_id)
    if (typeof ctx.http_status === 'number') {
      scope.setTag('http_status', String(ctx.http_status))
    }
    if (ctx.user_id) {
      // user.id = UUID Supabase Auth, jamais l'email (PII).
      scope.setUser({ id: ctx.user_id })
    }
    if (ctx.extra) {
      for (const [k, v] of Object.entries(ctx.extra)) {
        scope.setExtra(k, v)
      }
    }
    Sentry.captureException(err)
  })
}

// ------------------------------------------------------------
// COMPTEUR ANTI-SPAM
// ------------------------------------------------------------

/**
 * Compteur en mémoire-module pour éviter de spammer Sentry avec N erreurs
 * identiques sur le même run (typiquement enrichirContact qui peut faire
 * 10+ fetch failed d'affilée si Recherche Entreprises est down).
 *
 * Clé = `${key}:${runId}` (ou juste key si pas de runId).
 * Reset uniquement au cold start (instance Vercel recyclée).
 */
const _consecutiveFailures: Record<string, number> = {}

/**
 * Incrémente le compteur et retourne `true` ssi on a atteint le seuil
 * (1ère erreur ET multiple de `reportEvery`). Permet de capturer la 1ère
 * occurrence puis 1 fois toutes les N suivantes.
 *
 * Usage :
 *   if (shouldReportFailure('contact-enrichment.fetch', runId, 5)) {
 *     captureWithContext(err, { pipeline_phase: 'enrichment', ... })
 *   }
 */
export function shouldReportFailure(
  key: string,
  runId: string | undefined,
  reportEvery = 5,
): boolean {
  const fullKey = runId ? `${key}:${runId}` : key
  const next = (_consecutiveFailures[fullKey] ?? 0) + 1
  _consecutiveFailures[fullKey] = next
  // Toujours capturer la 1ère erreur, puis toutes les `reportEvery` suivantes.
  return next === 1 || next % reportEvery === 0
}

/**
 * Reset le compteur d'échecs (à appeler quand une opération réussit).
 * Permet de re-capturer si une nouvelle vague d'erreurs survient plus tard.
 */
export function resetFailureCounter(key: string, runId?: string): void {
  const fullKey = runId ? `${key}:${runId}` : key
  delete _consecutiveFailures[fullKey]
}

/** Exposé uniquement pour les tests — ne pas utiliser en prod. */
export function _resetAllFailureCountersForTests(): void {
  for (const k of Object.keys(_consecutiveFailures)) {
    delete _consecutiveFailures[k]
  }
}
