// ============================================================
// LINKEDIN COMPANY URL — Agent IA Prospection Bilan Carbone
//
// Construit et valide une URL de PAGE ENTREPRISE LinkedIn (vanity URL)
// depuis la raison sociale d'un prospect. Utilisé en dernier recours
// par `contact-enrichment.ts` quand la cascade Recherche Entreprises
// → Pappers → Hunter n'a fourni AUCUN canal de contact direct.
//
// Pourquoi pas la LinkedIn Public API ?
//   - Très restrictive depuis 2018, refusera notre cas d'usage (B2B
//     prospecting "Vetted Marketing API" sur invitation uniquement).
//   - Vanity URL prédictible : `linkedin.com/company/<slug-raison-sociale>`
//     fonctionne pour la grande majorité des ETI/PME françaises >50 salariés.
//
// Méthode :
//   1. Slugifier la raison sociale (retirer formes juridiques, accents,
//      ponctuation, espacer en tirets).
//   2. HEAD HTTP sur https://www.linkedin.com/company/<slug>/.
//      - 200 → URL valide, retournée.
//      - 404 → page inexistante, return null.
//      - 999 → rate-limit anti-bot LinkedIn → return null + warn.
//      - autre → return null + warn.
//   3. Timeout court (3s) — on est en best-effort, ne pas bloquer la
//      cascade pour ça.
//
// SSRF : domaine whitelist `www.linkedin.com` hardcodé, jamais d'URL
// user-controlled. La raison sociale est sanitizée via le slug-builder
// avant interpolation.
// ============================================================

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

const LINKEDIN_BASE_URL = 'https://www.linkedin.com/company/'
const LINKEDIN_HEAD_TIMEOUT_MS = 3_000
const SLUG_MIN_LENGTH = 2
const SLUG_MAX_LENGTH = 80

/**
 * Formes juridiques à retirer du slug. Cohérent avec `LEGAL_FORMS` de
 * `contact-enrichment.ts` (volontairement dupliqué pour éviter une dépendance
 * croisée — la liste évolue rarement).
 */
const LEGAL_FORMS_SLUG = new Set([
  'sas', 'sa', 'sarl', 'sasu', 'eurl', 'sci', 'sca', 'snc', 'scp',
  'sel', 'selarl', 'selas', 'selafa', 'selca', 'se',
  'gmbh', 'ltd', 'inc', 'llc', 'bv', 'nv', 'ag',
])

/**
 * HTTP 999 = "LinkedIn rate-limit / anti-bot" (code non-standard).
 * Ce n'est pas un échec définitif mais on ne peut pas distinguer
 * "page existe" vs "page n'existe pas", donc on traite comme "unknown".
 */
const LINKEDIN_RATE_LIMIT_STATUS = 999

// ------------------------------------------------------------
// SLUG BUILDER (exporté pour tests unitaires)
// ------------------------------------------------------------

/**
 * Construit un slug LinkedIn-friendly depuis une raison sociale.
 *
 * Règles :
 *  1. Lowercase + retrait des accents (NFD + retrait diacritiques)
 *  2. Retrait des apostrophes (typographique et droite) — pas remplacé
 *     par tiret (ex : "L'Oréal" → "loreal", pas "l-oreal")
 *  3. Tokenisation sur espaces/ponctuation
 *  4. Retrait des formes juridiques en tête/queue
 *  5. Concaténation par tirets
 *  6. Retour `null` si résultat trop court (< 2 chars) ou trop long (> 80)
 *
 * Exemples :
 *  - "Foo Bar SAS"        → "foo-bar"
 *  - "L'Oréal S.A."       → "loreal"
 *  - "Société Générale"   → "societe-generale"
 *  - "Acme & Co"          → "acme-co"
 *  - "SAS"                → null (uniquement forme juridique)
 *  - ""                   → null
 */
export function buildLinkedinSlug(raisonSociale: string): string | null {
  if (!raisonSociale || typeof raisonSociale !== 'string') return null

  let normalized = raisonSociale.toLowerCase()

  // Retire les accents (é → e, ô → o, …)
  normalized = normalized.normalize('NFD').replace(/[̀-ͯ]/g, '')

  // Retire apostrophes (droite ' et typographique ’) sans les remplacer par tiret
  // → "L'Oréal" → "loreal" (et non "l-oreal")
  normalized = normalized.replace(/['’]/g, '')

  // Collapse les sigles avec points : "S.A." → "sa", "S.A.R.L." → "sarl".
  // On le fait AVANT la normalisation ponctuation pour ne pas perdre la
  // continuité entre les lettres. Pattern : une suite de "[a-z]." (au moins
  // 2 occurrences) sera collapsée en concaténation des lettres.
  normalized = normalized.replace(/(?:[a-z]\.){2,}/g, (match) =>
    match.replace(/\./g, ''),
  )

  // Remplace toute ponctuation/whitespace non alphanumérique par un espace
  normalized = normalized.replace(/[^a-z0-9]+/g, ' ')

  // Tokenize, retire les formes juridiques (au début, à la fin, ou isolées)
  const tokens = normalized
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .filter((t) => !LEGAL_FORMS_SLUG.has(t))

  if (tokens.length === 0) return null

  const slug = tokens.join('-')

  if (slug.length < SLUG_MIN_LENGTH) return null
  if (slug.length > SLUG_MAX_LENGTH) return null

  return slug
}

// ------------------------------------------------------------
// HEAD FETCH HELPER
// ------------------------------------------------------------

interface HeadResult {
  /** Status HTTP retourné par LinkedIn (0 si timeout/erreur réseau). */
  status: number
  /** True si la page entreprise existe (status 200). */
  exists: boolean
  /** True si LinkedIn rate-limite (status 999). */
  rateLimited: boolean
}

/**
 * HEAD HTTP sur LinkedIn avec timeout court. Best-effort : ne throw jamais,
 * retourne `{ status: 0 }` en cas d'erreur réseau.
 *
 * @internal exporté pour tests uniquement
 */
export async function headLinkedinCompany(slug: string): Promise<HeadResult> {
  const url = `${LINKEDIN_BASE_URL}${encodeURIComponent(slug)}/`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'HEAD',
      // Pas de cookie / referer custom — on reste neutre côté UA.
      headers: {
        Accept: 'text/html',
        'User-Agent': 'prospection-agent/1.0 (+contact-enrichment)',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(LINKEDIN_HEAD_TIMEOUT_MS),
    })
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'linkedin-company',
        msg: 'HEAD linkedin: erreur réseau / timeout',
        slug,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return { status: 0, exists: false, rateLimited: false }
  }

  // 301/302 vers la page entreprise = page existe (LinkedIn redirige vers
  // l'URL canonique avec slug normalisé).
  const isRedirect = response.status >= 300 && response.status < 400
  const isOk = response.status === 200
  const exists = isOk || isRedirect

  return {
    status: response.status,
    exists,
    rateLimited: response.status === LINKEDIN_RATE_LIMIT_STATUS,
  }
}

// ------------------------------------------------------------
// FONCTION PUBLIQUE
// ------------------------------------------------------------

/**
 * Cherche l'URL LinkedIn de la PAGE ENTREPRISE d'un prospect.
 *
 * @param raisonSociale - Raison sociale (ex: "L'Oréal SAS", "Société Générale")
 * @returns URL canonique linkedin.com/company/<slug>/ si trouvée, sinon null
 *
 * Cas null retournés :
 *  - Slug non constructible (raison sociale vide / uniquement forme juridique)
 *  - HTTP 404 (page n'existe pas)
 *  - HTTP 999 (LinkedIn rate-limit, on ne peut pas trancher)
 *  - Erreur réseau / timeout 3s
 *  - Tout status autre que 200 / 3xx
 *
 * Idempotent : appels répétés produisent le même résultat (modulo rate-limit).
 */
export async function findLinkedinCompanyUrl(
  raisonSociale: string,
): Promise<string | null> {
  const slug = buildLinkedinSlug(raisonSociale)
  if (!slug) {
    console.log(
      JSON.stringify({
        level: 'info',
        module: 'linkedin-company',
        msg: 'slug non constructible — skip',
        // Ne log pas la raison_sociale (déjà discutable côté PII si nom court
        // contient un nom de famille de dirigeant solo).
      }),
    )
    return null
  }

  const result = await headLinkedinCompany(slug)

  if (result.rateLimited) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'linkedin-company',
        msg: 'LinkedIn rate-limit (HTTP 999) — résultat inconnu, skip',
        slug,
      }),
    )
    return null
  }

  if (!result.exists) {
    console.log(
      JSON.stringify({
        level: 'info',
        module: 'linkedin-company',
        msg: 'page entreprise introuvable',
        slug,
        status: result.status,
      }),
    )
    return null
  }

  const url = `${LINKEDIN_BASE_URL}${slug}/`

  console.log(
    JSON.stringify({
      level: 'info',
      module: 'linkedin-company',
      msg: 'page entreprise trouvée',
      slug,
      status: result.status,
    }),
  )

  return url
}
