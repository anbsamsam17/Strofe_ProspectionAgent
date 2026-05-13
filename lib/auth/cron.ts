// ============================================================
// CRON AUTH — Verification du secret cron Vercel
// Module partage entre les routes API protegees par CRON_SECRET.
//
// SECURITE :
// - Comparaison en temps constant via crypto.timingSafeEqual
//   pour empecher les timing attacks sur la longueur/contenu.
// - Padding a longueur fixe (128 octets) pour eviter le leak
//   de longueur via le temps de reponse.
// - Verification supplementaire de longueur apres timingSafeEqual
//   car le padding pourrait masquer des tokens tronques.
// ============================================================

import { type NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'

/**
 * Verifie que le header Authorization de la requete contient
 * le Bearer token correspondant a CRON_SECRET.
 *
 * Retourne `false` si CRON_SECRET n'est pas configure (env manquant)
 * ou si le token fourni ne correspond pas.
 *
 * Utilise par :
 * - POST /api/agent/run (cron nocturne Vercel 22h)
 * - POST /api/agent/reap-stale (cron toutes les 10 min)
 */
export function isCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false

  const authHeader = request.headers.get('authorization') ?? ''
  const provided = authHeader.replace('Bearer ', '').trim()

  // Padding a longueur fixe pour eviter le leak de longueur via timing
  const expectedBuf = Buffer.from(cronSecret.padEnd(128, '\0'))
  const providedBuf = Buffer.from(provided.padEnd(128, '\0'))

  return timingSafeEqual(expectedBuf, providedBuf) && provided.length === cronSecret.length
}
