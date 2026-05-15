// ============================================================
// OPT-OUT TOKEN — Génération / vérification HMAC pour opt-out 1 clic.
//
// Format token : base64url(JSON.stringify({u, s?, e?, exp})) + '.' + hmacSha256(secret, payload)
//
// - `u` : user_id (UUID Supabase auth)
// - `s` : SIREN du prospect (optionnel)
// - `e` : email du prospect (optionnel)
// - `exp` : timestamp ms expiration
//
// Au moins un des champs `s` ou `e` est obligatoire.
//
// Module séparé du route handler (`app/api/opt-out/[token]/route.ts`)
// car Next.js 15 interdit l'export de fonctions utilitaires depuis un
// `route.ts` (seuls GET, POST, etc. sont autorisés).
// ============================================================

import { createHmac, timingSafeEqual } from 'crypto'

export interface OptOutPayload {
  u: string
  s?: string
  e?: string
  exp: number
}

function base64urlEncode(input: string): string {
  return Buffer.from(input, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function base64urlDecode(input: string): string {
  const pad = 4 - (input.length % 4)
  const padded = pad < 4 ? input + '='.repeat(pad) : input
  const std = padded.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(std, 'base64').toString('utf-8')
}

/**
 * Vérifie un token opt-out signé HMAC.
 * Retourne `{ ok: true, payload }` si valide, sinon `{ ok: false, reason }`.
 */
export function verifyOptOutToken(
  token: string,
  secret: string,
):
  | { ok: true; payload: OptOutPayload }
  | { ok: false; reason: 'format' | 'signature' | 'payload' | 'user' | 'target' | 'expired' } {
  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'format' }

  const [payloadB64, sigB64] = parts

  const expected = createHmac('sha256', secret).update(payloadB64).digest('base64url')

  const expectedBuf = Buffer.from(expected)
  const providedBuf = Buffer.from(sigB64)
  if (expectedBuf.length !== providedBuf.length) {
    return { ok: false, reason: 'signature' }
  }
  if (!timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, reason: 'signature' }
  }

  let payload: OptOutPayload
  try {
    payload = JSON.parse(base64urlDecode(payloadB64)) as OptOutPayload
  } catch {
    return { ok: false, reason: 'payload' }
  }

  if (typeof payload.u !== 'string' || !payload.u) {
    return { ok: false, reason: 'user' }
  }
  if (!payload.s && !payload.e) {
    return { ok: false, reason: 'target' }
  }
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) {
    return { ok: false, reason: 'expired' }
  }

  return { ok: true, payload }
}

/**
 * Génère un token opt-out signé HMAC pour inclusion dans un email Resend.
 *
 * @example
 * const token = generateOptOutToken({ userId, siren, email, ttlDays: 365 })
 * const url = `https://app.strofe.fr/api/opt-out/${token}`
 */
export function generateOptOutToken(input: {
  userId: string
  siren?: string
  email?: string
  ttlDays?: number
}): string {
  const secret = process.env.OPT_OUT_HMAC_SECRET
  if (!secret) {
    throw new Error('OPT_OUT_HMAC_SECRET env non configurée')
  }

  const ttlMs = (input.ttlDays ?? 365) * 24 * 60 * 60 * 1000
  const payload: OptOutPayload = {
    u: input.userId,
    s: input.siren,
    e: input.email,
    exp: Date.now() + ttlMs,
  }

  const payloadB64 = base64urlEncode(JSON.stringify(payload))
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url')

  return `${payloadB64}.${sig}`
}
