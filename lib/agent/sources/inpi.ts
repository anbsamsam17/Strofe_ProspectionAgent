// ============================================================
// INPI RNE — Registre National des Entreprises
//
// Adaptateur officiel (France) pour récupérer les mandataires sociaux
// (président, DG, gérant, administrateurs) d'une entreprise.
//
// Source : https://registre-national-entreprises.inpi.fr/
//   - API gratuite mais nécessite un compte INPI (username/password).
//   - Auth : POST /api/sso/login { username, password } → JWT (champ `token`)
//     valable ~1h. Cache module-level avec refresh automatique.
//   - Données : GET /api/companies/{siren} avec `Authorization: Bearer <jwt>`
//
// Variables d'environnement requises :
//   INPI_USERNAME — login compte INPI (email)
//   INPI_PASSWORD — mot de passe compte INPI
// (à documenter dans .env.example, section "INPI RNE — mandataires sociaux")
//
// SSRF whitelist : domaine `registre-national-entreprises.inpi.fr` à ajouter
// à `.claude/rules/security.md` (voir bas du fichier).
//
// RGPD critique :
//   - On NE retourne JAMAIS la date de naissance complète (jour/mois) :
//     uniquement l'année (`anneeNaissance: number`). Le RNE est public mais
//     les jour/mois de naissance des dirigeants ne sont pas légitimement
//     nécessaires à la prospection B2B.
//   - On NE retourne JAMAIS les bénéficiaires effectifs (RBE) : ils
//     contiennent des adresses personnelles. Strictement limité aux
//     `pouvoirs[]` (mandataires sociaux publics).
//   - Logs structurés : `{ module: 'inpi', siren, status, count }`.
//     Jamais de nom/prénom/date de naissance dans les logs.
// ============================================================

import { z } from 'zod'

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

const INPI_BASE_URL = 'https://registre-national-entreprises.inpi.fr'
const INPI_LOGIN_URL = `${INPI_BASE_URL}/api/sso/login`
const INPI_COMPANY_URL = `${INPI_BASE_URL}/api/companies`

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Durée de vie d'un JWT INPI : 1h documentée, on prend une marge de
 * sécurité de 5 min pour ne pas se faire 401 sur un appel limite.
 */
const TOKEN_TTL_MS = 55 * 60 * 1_000

const SIREN_REGEX = /^\d{9}$/

/**
 * Priorité de tri des mandataires pour identifier le "principal".
 * Plus le score est élevé, plus la qualité est représentative.
 */
const QUALITE_PRIORITE: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /pr[ée]sident/i, score: 100 },
  { pattern: /directeur\s+g[ée]n[ée]ral/i, score: 90 },
  { pattern: /g[ée]rant/i, score: 80 },
  { pattern: /administrateur/i, score: 50 },
]

// ------------------------------------------------------------
// TYPES PUBLICS
// ------------------------------------------------------------

export interface InpiMandataire {
  nom: string
  prenoms: string
  /** "Président", "Directeur général", "Gérant", "Administrateur", … */
  qualite: string
  /** Année de naissance uniquement (RGPD : jour/mois jamais persistés). */
  anneeNaissance: number | null
}

export interface InpiResult {
  siren: string
  /** ISO date de la dernière mise à jour INPI (champ `updatedAt` ou `dateMaj`). */
  dateMaj: string
  mandataires: InpiMandataire[]
  /** Mandataire principal sélectionné selon `QUALITE_PRIORITE`. */
  mandatairePrincipal: InpiMandataire | null
}

// ------------------------------------------------------------
// SCHEMAS ZOD — validation des réponses INPI
// ------------------------------------------------------------

const loginResponseSchema = z.object({
  token: z.string().min(10),
})

const descriptionPersonneSchema = z
  .object({
    nom: z.string().optional().nullable(),
    prenoms: z.union([z.string(), z.array(z.string())]).optional().nullable(),
    qualite: z.string().optional().nullable(),
    dateDeNaissance: z.string().optional().nullable(),
    dateNaissance: z
      .object({ dateNaissancePartielle: z.string().optional().nullable() })
      .partial()
      .optional()
      .nullable(),
  })
  .passthrough()

const pouvoirSchema = z
  .object({
    individu: z
      .object({ descriptionPersonne: descriptionPersonneSchema })
      .partial()
      .optional()
      .nullable(),
    // Variante : certains pouvoirs INPI ont descriptionPersonne au niveau racine
    descriptionPersonne: descriptionPersonneSchema.optional().nullable(),
  })
  .passthrough()

const companyResponseSchema = z
  .object({
    updatedAt: z.string().optional().nullable(),
    formality: z
      .object({
        content: z
          .object({
            personneMorale: z
              .object({
                identite: z
                  .object({
                    entreprise: z
                      .object({ dateMaj: z.string().optional().nullable() })
                      .partial()
                      .optional()
                      .nullable(),
                  })
                  .partial()
                  .optional()
                  .nullable(),
                composition: z
                  .object({ pouvoirs: z.array(pouvoirSchema).optional().nullable() })
                  .partial()
                  .optional()
                  .nullable(),
              })
              .partial()
              .optional()
              .nullable(),
          })
          .partial()
          .optional()
          .nullable(),
      })
      .partial()
      .optional()
      .nullable(),
  })
  .passthrough()

// ------------------------------------------------------------
// CACHE TOKEN — module-level (warm Vercel instance)
// ------------------------------------------------------------

interface TokenCache {
  value: string
  expiresAt: number
}

let _tokenCache: TokenCache | null = null
let _pendingLogin: Promise<string> | null = null

/**
 * Reset du cache JWT (tests + recovery après rotation password).
 * Visible uniquement pour tests / outils ops — préfixe `_`.
 */
export function _resetInpiTokenCache(): void {
  _tokenCache = null
  _pendingLogin = null
}

// ------------------------------------------------------------
// LOGIN — récupère un JWT (avec cache)
// ------------------------------------------------------------

function logInpi(
  level: 'info' | 'warn' | 'error',
  msg: string,
  meta: Record<string, unknown> = {},
): void {
  console.log(JSON.stringify({ level, module: 'inpi', msg, ...meta }))
}

/**
 * Récupère un JWT valide depuis le cache ou par login.
 * Coalesce les appels concurrents (un seul login en parallèle).
 *
 * @throws Error si INPI_USERNAME/PASSWORD absent ou login échoue
 */
async function getInpiToken(timeoutMs: number, forceRefresh = false): Promise<string> {
  const username = process.env.INPI_USERNAME
  const password = process.env.INPI_PASSWORD

  if (!username || !password) {
    throw new Error(
      'INPI_USERNAME et INPI_PASSWORD doivent être définis dans l\'environnement. ' +
        'Cf. .env.example section "INPI RNE".',
    )
  }

  const now = Date.now()
  if (
    !forceRefresh &&
    _tokenCache &&
    _tokenCache.expiresAt > now
  ) {
    return _tokenCache.value
  }

  // Coalesce : si un login est déjà en cours, on attend son résultat
  if (_pendingLogin && !forceRefresh) {
    return _pendingLogin
  }

  _pendingLogin = (async () => {
    try {
      const res = await fetch(INPI_LOGIN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'prospection-agent/1.0 (+inpi-rne)',
        },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!res.ok) {
        logInpi('error', 'login failed', { status: res.status })
        throw new Error(`INPI login HTTP ${res.status}`)
      }

      const raw: unknown = await res.json()
      const parsed = loginResponseSchema.safeParse(raw)
      if (!parsed.success) {
        logInpi('error', 'login response malformed', {})
        throw new Error('INPI login: réponse JSON inattendue (token absent)')
      }

      _tokenCache = {
        value: parsed.data.token,
        expiresAt: Date.now() + TOKEN_TTL_MS,
      }
      logInpi('info', 'login ok', { status: res.status })
      return parsed.data.token
    } finally {
      _pendingLogin = null
    }
  })()

  return _pendingLogin
}

// ------------------------------------------------------------
// EXTRACTION + RGPD : année de naissance uniquement
// ------------------------------------------------------------

/**
 * Extrait UNIQUEMENT l'année (YYYY) d'une date partielle ou complète INPI.
 * Accepte : "1972-04-18", "1972-04", "1972", null, undefined.
 * Retourne `null` si année invalide (hors [1900, currentYear]).
 */
function extractAnneeNaissance(
  dateDeNaissance?: string | null,
  dateNaissancePartielle?: string | null,
): number | null {
  const raw = dateDeNaissance ?? dateNaissancePartielle ?? null
  if (!raw || typeof raw !== 'string') return null

  const match = raw.match(/^(\d{4})/)
  if (!match) return null

  const year = Number.parseInt(match[1], 10)
  const currentYear = new Date().getUTCFullYear()
  if (!Number.isFinite(year) || year < 1900 || year > currentYear) return null

  return year
}

/**
 * Normalise un mandataire INPI vers notre format public.
 * Skip silencieux si nom ou qualité manquent.
 */
function normalizeMandataire(
  desc: z.infer<typeof descriptionPersonneSchema>,
): InpiMandataire | null {
  const nom = (desc.nom ?? '').trim()
  const qualite = (desc.qualite ?? '').trim()
  if (!nom || !qualite) return null

  const prenomsRaw = desc.prenoms
  let prenoms = ''
  if (typeof prenomsRaw === 'string') {
    prenoms = prenomsRaw.trim()
  } else if (Array.isArray(prenomsRaw)) {
    prenoms = prenomsRaw.filter((p) => typeof p === 'string').join(' ').trim()
  }

  const anneeNaissance = extractAnneeNaissance(
    desc.dateDeNaissance,
    desc.dateNaissance?.dateNaissancePartielle,
  )

  return { nom, prenoms, qualite, anneeNaissance }
}

/**
 * Sélectionne le mandataire principal selon `QUALITE_PRIORITE`.
 */
function pickMandatairePrincipal(
  mandataires: InpiMandataire[],
): InpiMandataire | null {
  if (mandataires.length === 0) return null

  let best: InpiMandataire | null = null
  let bestScore = -1

  for (const m of mandataires) {
    const rule = QUALITE_PRIORITE.find((r) => r.pattern.test(m.qualite))
    const score = rule?.score ?? 0
    if (score > bestScore) {
      best = m
      bestScore = score
    }
  }

  return best
}

// ------------------------------------------------------------
// FETCH PRINCIPAL
// ------------------------------------------------------------

/**
 * Récupère les mandataires sociaux d'une entreprise via INPI RNE.
 *
 * @param siren - 9 chiffres
 * @param options.timeoutMs - timeout par appel (login + data) — défaut 10s
 * @returns InpiResult ou `null` (404, timeout, erreur réseau, SIREN invalide)
 * @throws Error si INPI_USERNAME/PASSWORD absent
 *
 * Stratégie d'erreur :
 *  - Validation SIREN locale → null (pas d'appel réseau)
 *  - Login échoue → throw (config invalide, ne masque pas)
 *  - 401 sur /companies → refresh token + retry 1× (cas token cache obsolète)
 *  - 404 → null (entreprise inconnue, cas légitime)
 *  - 5xx / timeout → null + log warn (pipeline dégradé non bloquant)
 *  - JSON malformé → null + log warn
 *
 * Strictement limité aux `pouvoirs[]` — les bénéficiaires effectifs (RBE) sont
 * IGNORÉS volontairement (PII : adresses personnelles).
 */
export async function fetchInpiData(
  siren: string,
  options?: { timeoutMs?: number },
): Promise<InpiResult | null> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (!siren || !SIREN_REGEX.test(siren)) {
    logInpi('warn', 'siren invalide', { siren_len: siren?.length ?? 0 })
    return null
  }

  // 1. Récupère ou rafraîchit le token
  let token: string
  try {
    token = await getInpiToken(timeoutMs)
  } catch (err) {
    // Login échoue → on remonte l'erreur (config). Pas de log du payload.
    if (err instanceof Error && err.message.startsWith('INPI_USERNAME')) {
      throw err
    }
    logInpi('error', 'login impossible', {
      err: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    })
    return null
  }

  // 2. Fetch /companies/{siren} avec retry 1× sur 401
  const fetchCompany = async (jwt: string): Promise<Response | null> => {
    try {
      return await fetch(`${INPI_COMPANY_URL}/${siren}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${jwt}`,
          'User-Agent': 'prospection-agent/1.0 (+inpi-rne)',
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      logInpi('warn', 'fetch error / timeout', {
        siren,
        err: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      })
      return null
    }
  }

  let res = await fetchCompany(token)
  if (!res) return null

  // 401 → token expiré côté serveur INPI (peut arriver malgré le TTL local) :
  // on invalide le cache et on retry UNE fois.
  if (res.status === 401) {
    logInpi('warn', '401 sur /companies, refresh token + retry', { siren })
    _resetInpiTokenCache()
    try {
      token = await getInpiToken(timeoutMs, true)
    } catch (err) {
      logInpi('error', 'refresh token échoué', {
        siren,
        err: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      })
      return null
    }
    res = await fetchCompany(token)
    if (!res) return null
  }

  if (res.status === 404) {
    logInpi('info', 'siren inconnu', { siren, status: 404 })
    return null
  }

  if (!res.ok) {
    logInpi('warn', 'http non-2xx', { siren, status: res.status })
    return null
  }

  // 3. Parse + valide
  let raw: unknown
  try {
    raw = await res.json()
  } catch (err) {
    logInpi('warn', 'json parse error', {
      siren,
      err: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    })
    return null
  }

  const parsed = companyResponseSchema.safeParse(raw)
  if (!parsed.success) {
    logInpi('warn', 'schema mismatch', { siren })
    return null
  }

  const data = parsed.data
  const pouvoirs =
    data.formality?.content?.personneMorale?.composition?.pouvoirs ?? []

  const mandataires: InpiMandataire[] = []
  for (const p of pouvoirs) {
    const desc = p.individu?.descriptionPersonne ?? p.descriptionPersonne
    if (!desc) continue
    const m = normalizeMandataire(desc)
    if (m) mandataires.push(m)
  }

  const dateMaj =
    data.updatedAt ??
    data.formality?.content?.personneMorale?.identite?.entreprise?.dateMaj ??
    ''

  const result: InpiResult = {
    siren,
    dateMaj,
    mandataires,
    mandatairePrincipal: pickMandatairePrincipal(mandataires),
  }

  logInpi('info', 'ok', { siren, status: 200, count: mandataires.length })

  return result
}
