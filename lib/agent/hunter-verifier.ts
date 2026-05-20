// ============================================================
// HUNTER EMAIL VERIFIER — wrapper typé autour de l'API
// ------------------------------------------------------------
// Endpoint : GET https://api.hunter.io/v2/email-verifier?email=X&api_key=Y
// Doc      : https://hunter.io/api-documentation/v2#email-verifier
//
// Renvoie un statut + score 0-100 + signaux SMTP (gibberish, regex, etc.).
// On ne conserve que `status` + `score` côté DB (les signaux servent au debug
// éventuel mais pas à la décision : Hunter agrège déjà tout dans `status`).
//
// Sécurité :
//   - Pas de PII en log (juste le domaine de l'email pour stats).
//   - API key lue depuis process.env.HUNTER_API_KEY (jamais loggée).
//   - SSRF safe : URL hardcodée sur api.hunter.io (whitelist sécurité).
//
// Robustesse :
//   - Timeout 10s (Hunter répond généralement < 3s).
//   - Validation Zod du payload (Hunter peut faire évoluer sa shape).
//   - Mapping des statuts non reconnus → 'unknown' (defensive).
// ============================================================

import { z } from 'zod'

// ------------------------------------------------------------
// TYPES
// ------------------------------------------------------------

/**
 * Statuts canoniques persistés en DB. Les valeurs Hunter brutes sont mappées
 * ici : tout statut inconnu (évolution future de Hunter) tombe sur 'unknown'.
 * Aligné sur le CHECK constraint de la migration 025.
 */
export type EmailVerificationStatus =
  | 'valid'
  | 'invalid'
  | 'accept_all'
  | 'webmail'
  | 'disposable'
  | 'unknown'

export interface EmailVerificationResult {
  /** Statut canonique persistable. */
  status: EmailVerificationStatus
  /** Score 0-100 (confiance Hunter sur la validité). */
  score: number
}

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

const HUNTER_VERIFIER_URL = 'https://api.hunter.io/v2/email-verifier'
const VERIFIER_TIMEOUT_MS = 10_000

/**
 * Mapping des statuts bruts Hunter vers nos valeurs canoniques DB.
 * Source : https://hunter.io/api-documentation/v2#email-verifier
 */
const HUNTER_STATUS_MAP: Record<string, EmailVerificationStatus> = {
  valid: 'valid',
  invalid: 'invalid',
  accept_all: 'accept_all',
  webmail: 'webmail',
  disposable: 'disposable',
  unknown: 'unknown',
}

// ------------------------------------------------------------
// SCHEMA ZOD
// ------------------------------------------------------------

/**
 * Schema minimal de la réponse Hunter. On valide uniquement les champs qu'on
 * persiste (`status`, `score`) — le reste (regexp, gibberish, mx_records, …)
 * n'est pas exploité. Champs optionnels pour rester souple face aux évolutions.
 */
const HunterVerifierResponseSchema = z.object({
  data: z.object({
    status: z.string(),
    /** Hunter renvoie score 0-100 (number, parfois null en cas d'erreur SMTP). */
    score: z.number().nullable().optional(),
    /** Présent en erreur — pas exploité ici, juste validé pour debug Zod. */
    result: z.string().optional(),
  }),
})

/**
 * Schema d'erreur Hunter (quota épuisé, clé invalide, etc.).
 *   { errors: [{ id, code, details }] }
 */
const HunterErrorResponseSchema = z.object({
  errors: z
    .array(
      z.object({
        id: z.string().optional(),
        code: z.union([z.number(), z.string()]).optional(),
        details: z.string().optional(),
      }),
    )
    .nonempty(),
})

// ------------------------------------------------------------
// ERREURS TYPÉES
// ------------------------------------------------------------

/**
 * Erreur dédiée quota épuisé (HTTP 429 ou code 192 côté Hunter).
 * Permet à la route API de mapper proprement sur un 429 côté client.
 */
export class HunterQuotaExhaustedError extends Error {
  constructor(message: string = 'Quota Hunter Email Verifier épuisé') {
    super(message)
    this.name = 'HunterQuotaExhaustedError'
  }
}

/**
 * Erreur dédiée API key invalide / manquante.
 */
export class HunterAuthError extends Error {
  constructor(message: string = 'Clé Hunter manquante ou invalide') {
    super(message)
    this.name = 'HunterAuthError'
  }
}

// ------------------------------------------------------------
// API PUBLIQUE
// ------------------------------------------------------------

/**
 * Vérifie un email via Hunter Email Verifier.
 *
 * @throws HunterQuotaExhaustedError si quota épuisé (429 ou code 192)
 * @throws HunterAuthError si clé invalide / manquante (401)
 * @throws Error pour timeout / erreur réseau / payload malformé
 */
export async function verifyEmail(
  email: string,
  options: { apiKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<EmailVerificationResult> {
  const apiKey = options.apiKey ?? process.env.HUNTER_API_KEY
  if (!apiKey) {
    throw new HunterAuthError('HUNTER_API_KEY manquante en environnement')
  }

  const url = new URL(HUNTER_VERIFIER_URL)
  url.searchParams.set('email', email)
  url.searchParams.set('api_key', apiKey)

  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), VERIFIER_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetchImpl(url.toString(), {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('abort')) {
      throw new Error('Hunter Email Verifier : timeout')
    }
    throw new Error('Hunter Email Verifier : erreur réseau — ' + msg)
  } finally {
    clearTimeout(timeout)
  }

  // 429 — quota mensuel épuisé.
  if (response.status === 429) {
    throw new HunterQuotaExhaustedError()
  }

  // 401 — clé invalide ou révoquée.
  if (response.status === 401) {
    throw new HunterAuthError()
  }

  // 400-499 hors 429/401 : parse l'erreur si possible, sinon générique.
  if (response.status >= 400) {
    let detail = ''
    try {
      const raw = (await response.json()) as unknown
      const parsed = HunterErrorResponseSchema.safeParse(raw)
      if (parsed.success) {
        const first = parsed.data.errors[0]
        // Code 192 = "Too many requests" côté Hunter (rare mais possible).
        if (first.code === 192 || String(first.code) === '192') {
          throw new HunterQuotaExhaustedError()
        }
        detail = first.details ?? first.id ?? ''
      }
    } catch (err) {
      if (err instanceof HunterQuotaExhaustedError) throw err
      // Ignore : on tombe sur l'erreur générique.
    }
    throw new Error(
      `Hunter Email Verifier : HTTP ${response.status}${detail ? ' — ' + detail : ''}`,
    )
  }

  // 200 — parse réponse.
  let rawJson: unknown
  try {
    rawJson = await response.json()
  } catch {
    throw new Error('Hunter Email Verifier : réponse non JSON')
  }

  const parsed = HunterVerifierResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    throw new Error(
      'Hunter Email Verifier : payload inattendu — ' + parsed.error.message,
    )
  }

  return normalizeVerifierResult(parsed.data.data)
}

/**
 * Mappe la réponse Hunter brute vers notre forme canonique.
 * Exposé pour tests unitaires.
 */
export function normalizeVerifierResult(input: {
  status: string
  score?: number | null | undefined
}): EmailVerificationResult {
  const rawStatus = (input.status ?? '').toLowerCase().trim()
  const status: EmailVerificationStatus =
    HUNTER_STATUS_MAP[rawStatus] ?? 'unknown'

  // Score clamp 0-100 (Hunter peut renvoyer null en cas de status='unknown').
  const rawScore = typeof input.score === 'number' ? input.score : 0
  const score = Math.max(0, Math.min(100, Math.round(rawScore)))

  return { status, score }
}
