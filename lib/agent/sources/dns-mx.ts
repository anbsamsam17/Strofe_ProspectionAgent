// ============================================================
// SOURCE — DNS MX lookup (node:dns)
// Vérifie qu'un domaine accepte du mail avant d'enregistrer un email
// patternisé dans `prospect_contacts`.
//
// Coût : 0€ (Node built-in). Compatible Vercel (DNS lookups OK,
// seul le port 25 outbound est bloqué pour les probes SMTP).
//
// Cache LRU maison (Map FIFO, max 1000 entries, TTL 24h, lazy expiry).
// ============================================================

import { promises as dns } from 'node:dns'

// ------------------------------------------------------------
// TYPES
// ------------------------------------------------------------

export interface MxRecord {
  exchange: string
  priority: number
}

interface CacheEntry {
  value: boolean
  expiresAt: number
}

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

const CACHE_MAX_SIZE = 1000
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const LOG_MODULE = 'dns-mx'

// Regex de détection provider — testées sur l'exchange du MX prioritaire.
// L'ordre n'a pas d'importance fonctionnelle (1ère regex matchante gagne).
const PROVIDER_PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> = [
  { name: 'google', regex: /aspmx\.l\.google\.com|googlemail\.com/i },
  { name: 'microsoft', regex: /mail\.protection\.outlook\.com/i },
  { name: 'ovh', regex: /mx\.ovh|mx1\.mail\.ovh\.net/i },
  { name: 'gandi', regex: /spool\.mail\.gandi\.net/i },
  { name: 'sendgrid', regex: /mx\.sendgrid\.net/i },
  { name: 'mailgun', regex: /mxa\.mailgun\.org/i },
]

// ------------------------------------------------------------
// CACHE LRU (module-scoped)
// ------------------------------------------------------------

const mxCache = new Map<string, CacheEntry>()

function cacheGet(key: string): boolean | undefined {
  const entry = mxCache.get(key)
  if (!entry) return undefined
  if (Date.now() >= entry.expiresAt) {
    mxCache.delete(key)
    return undefined
  }
  return entry.value
}

function cacheSet(key: string, value: boolean): void {
  if (mxCache.size >= CACHE_MAX_SIZE && !mxCache.has(key)) {
    // Eviction FIFO : supprime la 1ère entrée (Map garde l'ordre d'insertion).
    const firstKey = mxCache.keys().next().value
    if (firstKey !== undefined) {
      mxCache.delete(firstKey)
    }
  }
  mxCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
}

// ------------------------------------------------------------
// NORMALISATION
// ------------------------------------------------------------

/**
 * Normalise un domaine : strip protocole, strip path, lowercase, trim.
 * Throw si la valeur résultante est vide (input invalide).
 */
function normalizeDomain(input: string): string {
  if (typeof input !== 'string') {
    throw new TypeError('domain must be a string')
  }
  let d = input.trim().toLowerCase()
  // Strip protocole (https://, http://, mailto:)
  d = d.replace(/^[a-z][a-z0-9+\-.]*:\/\//, '')
  d = d.replace(/^mailto:/, '')
  // Strip user@ si quelqu'un passe un email entier
  const atIdx = d.lastIndexOf('@')
  if (atIdx >= 0) d = d.slice(atIdx + 1)
  // Strip path et query
  d = d.split('/')[0].split('?')[0]
  // Strip port
  d = d.split(':')[0]
  if (!d) {
    throw new Error('domain is empty after normalization')
  }
  return d
}

// ------------------------------------------------------------
// API PUBLIQUE
// ------------------------------------------------------------

/**
 * Vérifie qu'un domaine a au moins 1 MX record.
 * Retourne true si OK, false sur ENOTFOUND/ENODATA, jette uniquement sur input invalide.
 * Cache LRU 24h en mémoire (clé = domain.toLowerCase()).
 */
export async function hasMxRecord(domain: string): Promise<boolean> {
  const key = normalizeDomain(domain)

  const cached = cacheGet(key)
  if (cached !== undefined) return cached

  try {
    const records = await dns.resolveMx(key)
    const ok = Array.isArray(records) && records.length > 0
    cacheSet(key, ok)
    return ok
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      cacheSet(key, false)
      return false
    }
    if (code === 'ETIMEDOUT') {
      // Pas de cache : on veut permettre un retry sur le prochain appel.
      return false
    }
    // Autre erreur : log et false sans cache.
    console.warn(
      JSON.stringify({
        module: LOG_MODULE,
        level: 'warn',
        msg: 'mx_lookup_failed',
        domain: key,
        code: code ?? 'UNKNOWN',
      }),
    )
    return false
  }
}

/**
 * Retourne la liste des MX records triés par priorité ascendante.
 * Utile pour vérifier le provider (Gmail, M365, OVH, etc.) — meta-info.
 */
export async function getMxRecords(domain: string): Promise<MxRecord[]> {
  const key = normalizeDomain(domain)
  try {
    const records = await dns.resolveMx(key)
    if (!Array.isArray(records)) return []
    return [...records]
      .map((r) => ({ exchange: r.exchange, priority: r.priority }))
      .sort((a, b) => a.priority - b.priority)
  } catch {
    return []
  }
}

/**
 * Identifie le provider mail à partir du MX principal (priorité la plus basse).
 * Returns : 'google' | 'microsoft' | 'ovh' | 'gandi' | 'sendgrid' | 'mailgun' | 'other' | null
 */
export function identifyMxProvider(records: MxRecord[]): string | null {
  if (!records || records.length === 0) return null
  const sorted = [...records].sort((a, b) => a.priority - b.priority)
  const primary = sorted[0].exchange
  for (const { name, regex } of PROVIDER_PATTERNS) {
    if (regex.test(primary)) return name
  }
  return 'other'
}

/** Vide le cache (pour tests). */
export function _resetMxCache(): void {
  mxCache.clear()
}
