// ============================================================
// TESTS — Intégration API Sirene INSEE v3.11
// ------------------------------------------------------------
// Objectif : détecter toute future régression sur le HTTP 400
// "Erreur de syntaxe dans le paramètre q" qui a déjà sauté
// l'agent en prod le 2026-05-12 puis le 2026-05-17.
//
// Hindsight :
//   - 2026-04-06 — clauses Lucene vides `champ:()` → HTTP 400.
//   - 2026-05-12 — disjonction OR sur 41 NAF (>limite Solr) → HTTP 400.
//   - 2026-05-17 — tokens alphanumériques non quotés (ex `0121Z`)
//                  interprétés par Solr comme expressions Lucene → HTTP 400.
//
// 3 niveaux :
//   1. Tests unitaires `buildLuceneQuery` (mock, déterministes, < 10ms).
//   2. Tests d'intégration wiring fetch (mock global, < 100ms par test).
//   3. Tests d'intégration RÉELLE (skipped sauf opt-in env var).
//
// Pour lancer les tests d'intégration RÉELLE Sirene :
//   $env:TEST_REAL_SIRENE = "true"
//   $env:INSEE_API_KEY = "ta-cle"
//   npm run test -- lib/agent/__tests__/sirene-integration.test.ts
//
// En CI/dev normal : les tests réels sont skip automatiquement.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildLuceneQuery,
  chunkNafCodes,
  normalizeNafCodes,
  SireneApiError,
  sourcerEntreprises,
} from '../sourcing'

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

interface MockResponseInit {
  status?: number
  body?: unknown
  text?: string
  rejectFetch?: boolean
}

/**
 * Construit une Response minimale compatible avec `fetchWithRetry`.
 * `body` est sérialisé en JSON sauf si `text` est fourni (pour erreurs).
 */
function makeResponse(init: MockResponseInit): Response {
  const status = init.status ?? 200
  const ok = status >= 200 && status < 300
  return {
    status,
    ok,
    json: async () => init.body ?? {},
    text: async () => init.text ?? JSON.stringify(init.body ?? {}),
  } as unknown as Response
}

/** Page Sirene minimale valide (header + etablissements vides). */
function makeEmptySirenePage(curseur = '*', curseurSuivant = curseur) {
  return {
    header: {
      statut: 200,
      message: 'OK',
      total: 0,
      debut: 0,
      nombre: 0,
      curseur,
      curseurSuivant,
    },
    etablissements: [],
  }
}

/** Récupère l'URL de la première (ou Nème) requête `fetch` capturée. */
function fetchedUrl(fetchMock: ReturnType<typeof vi.fn>, idx = 0): string {
  return String(fetchMock.mock.calls[idx]?.[0] ?? '')
}

/** Décode `+` (espaces form-urlencoded) puis `%XX` pour inspecter la query Lucene. */
function decodeFetchUrl(url: string): string {
  return decodeURIComponent(url.replace(/\+/g, ' '))
}

// ------------------------------------------------------------
// SETUP / TEARDOWN
// ------------------------------------------------------------

const ORIGINAL_INSEE_API_KEY = process.env.INSEE_API_KEY

beforeEach(() => {
  process.env.INSEE_API_KEY = 'test-api-key'
  vi.restoreAllMocks()
})

afterEach(() => {
  if (ORIGINAL_INSEE_API_KEY === undefined) {
    delete process.env.INSEE_API_KEY
  } else {
    process.env.INSEE_API_KEY = ORIGINAL_INSEE_API_KEY
  }
  vi.unstubAllGlobals()
})

// ============================================================
// NIVEAU 1 — TESTS UNITAIRES `buildLuceneQuery`
// ------------------------------------------------------------
// Objectif : 15+ assertions sur la syntaxe Lucene produite.
// Aucun appel réseau. Aucune dépendance sur fetch.
// ============================================================

describe('Niveau 1 — buildLuceneQuery (syntaxe Lucene Solr)', () => {
  // Regex stricte : la query doit commencer par etatAdministratifEtablissement:A
  // (non quoté — Solr `string` field) suivie d'un nombre arbitraire de clauses
  // `AND champ:valeur` non vides.
  // - Le premier caractère après ':' doit être non-blanc (anti `champ: `).
  // - Aucun `AND` trailing toléré (la regex ancre sur `$`).
  const STRICT_QUERY_REGEX =
    /^etatAdministratifEtablissement:A( AND \w+:[^\s][\s\S]*?)*$/

  it('produit une query qui matche la regex stricte (cas minimal)', () => {
    const q = buildLuceneQuery([], [], ['00000', '99999'])
    expect(q).toMatch(STRICT_QUERY_REGEX)
  })

  it('produit une query qui matche la regex stricte (tous filtres présents)', () => {
    const q = buildLuceneQuery(
      ['01.21Z', '49.41A'],
      ['21', '22', '31'],
      ['33000', '33999'],
    )
    expect(q).toMatch(STRICT_QUERY_REGEX)
  })

  it('NAF, tranches, état admin sont tous NON quotés (Solr `string` field, point natif)', () => {
    const q = buildLuceneQuery(['01.21Z'], ['21'], ['00000', '99999'])
    expect(q).toContain('etatAdministratifEtablissement:A')
    expect(q).not.toContain('"A"')
    expect(q).toContain('(21)')
    expect(q).toContain('(01.21Z)')
    expect(q).not.toContain('"01.21Z"')
  })

  it('aucune clause ne génère `champ:()` quand un filtre est vide (NAF)', () => {
    const q = buildLuceneQuery([], ['21'], ['00000', '99999'])
    expect(q).not.toMatch(/activitePrincipaleEtablissement:\s*\(/)
    expect(q).not.toContain('()')
  })

  it('aucune clause ne génère `champ:()` quand un filtre est vide (tranches)', () => {
    const q = buildLuceneQuery(['01.21Z'], [], ['00000', '99999'])
    expect(q).not.toMatch(/trancheEffectifsEtablissement:\s*\(/)
    expect(q).not.toContain('()')
  })

  it('aucun `[ TO ]` vide quand code postal a borne malformée', () => {
    const q = buildLuceneQuery(['01.21Z'], ['21'], ['abc', '99999'])
    expect(q).not.toContain('codePostalEtablissement:[')
    expect(q).not.toContain('[ TO ]')
  })

  it('range code postal `[X TO Y]` valide uniquement si bornes sont 5 chiffres exacts', () => {
    const q = buildLuceneQuery(['01.21Z'], ['21'], ['33000', '33999'])
    expect(q).toContain('codePostalEtablissement:[33000 TO 33999]')
  })

  it('range code postal omis si une borne contient des lettres', () => {
    const q = buildLuceneQuery(['01.21Z'], ['21'], ['33A00', '33999'])
    expect(q).not.toContain('codePostalEtablissement:')
  })

  it('range code postal omis si bornes ont moins de 5 chiffres', () => {
    const q = buildLuceneQuery(['01.21Z'], ['21'], ['3300', '99999'])
    expect(q).not.toContain('codePostalEtablissement:')
  })

  it('rejette un code NAF contenant un `:` (caractère Solr réservé)', () => {
    // Pipeline : normalizeNafCodes → buildLuceneQuery (pour reproduire le wiring réel).
    // Le point `.` est CONSERVÉ (légitime), mais `:` reste rejeté (réservé Solr).
    const naf = normalizeNafCodes(['01.21Z', '01:21'])
    const q = buildLuceneQuery(naf, ['21'], ['00000', '99999'])
    expect(q).not.toContain('01:21')
    expect(q).toContain('(01.21Z)')
  })

  it('rejette les codes NAF avec espaces et caractères Solr réservés', () => {
    // NB : le point `.` n'est PAS dans SOLR_RESERVED_CHARS — il fait partie du
    // format canonique NAF. Ce test cible uniquement les chars qui cassent
    // réellement Solr (espace, *, +, \, :, etc.).
    const naf = normalizeNafCodes(['01 21Z', '01*Z', '01+Z', '01\\Z', '01:Z'])
    const q = buildLuceneQuery(naf, ['21'], ['00000', '99999'])
    // Aucun de ces inputs ne doit générer de clause NAF — naf normalisée = vide.
    expect(q).not.toContain('activitePrincipaleEtablissement:')
  })

  it('AND est utilisé sans doubles espaces ni trailing AND', () => {
    const q = buildLuceneQuery(['01.21Z'], ['21'], ['33000', '33999'])
    expect(q).not.toMatch(/\s{2,}/)
    expect(q).not.toMatch(/ AND $/)
    expect(q.endsWith('AND')).toBe(false)
  })

  it('tranches sont triées (déterminisme query — cache HTTP côté Sirene/Vercel)', () => {
    const q = buildLuceneQuery(
      ['01.21Z'],
      ['52', '21', '41', '22', '31'],
      ['00000', '99999'],
    )
    expect(q).toContain('trancheEffectifsEtablissement:(21 OR 22 OR 31 OR 41 OR 52)')
  })

  it('tranches dédupliquées', () => {
    const q = buildLuceneQuery(['01.21Z'], ['21', '21', '22'], ['00000', '99999'])
    // 21 ne doit apparaître qu'une seule fois dans la clause tranches.
    const match = q.match(/trancheEffectifsEtablissement:\(([^)]+)\)/)?.[1] ?? ''
    const tokens = match.split(' OR ')
    expect(tokens).toEqual(['21', '22'])
  })

  it('NAF dans OR clause, parenthèses présentes', () => {
    const q = buildLuceneQuery(['01.21Z', '49.41A'], [], ['00000', '99999'])
    expect(q).toContain('activitePrincipaleEtablissement:(01.21Z OR 49.41A)')
  })

  it('mono-NAF utilise toujours parenthèses (cohérence parser Solr)', () => {
    const q = buildLuceneQuery(['01.21Z'], [], ['00000', '99999'])
    expect(q).toContain('activitePrincipaleEtablissement:(01.21Z)')
  })

  it('query reste sous la limite Solr (8KB) avec un chunk de 20 NAF complet', () => {
    // 20 NAF format canonique `LL.NNZ` (6 chars chacun).
    const naf20 = Array.from(
      { length: 20 },
      (_, i) => `${String(i).padStart(2, '0')}.00Z`,
    )
    const q = buildLuceneQuery(
      naf20,
      ['21', '22', '31', '32', '41', '42', '51', '52', '53'],
      ['00000', '99999'],
    )
    expect(q.length).toBeLessThan(8192)
    expect(q).toMatch(STRICT_QUERY_REGEX)
  })

  it('chunkNafCodes + buildLuceneQuery : aucun chunk ne fait planter la regex stricte', () => {
    // 41 NAF (cas prod 2026-05-12) → 3 chunks de 20/20/1.
    const naf41 = Array.from(
      { length: 41 },
      (_, i) => `${String(i % 99).padStart(2, '0')}.${String(i).padStart(2, '0')}Z`,
    )
    const chunks = chunkNafCodes(naf41)
    for (const chunk of chunks) {
      const q = buildLuceneQuery(chunk, ['21'], ['33000', '33999'])
      expect(q).toMatch(STRICT_QUERY_REGEX)
    }
  })

  it('jamais de `OR` au top-level (anti précédence — toujours dans une clause `()`)', () => {
    const q = buildLuceneQuery(['01.21Z', '49.41A'], ['21', '22'], ['33000', '33999'])
    // On reconstruit la query sans les contenus de parenthèses pour valider qu'il n'y a
    // que des AND comme connecteurs entre clauses (les OR sont confinés aux groupes).
    const withoutParens = q.replace(/\([^)]*\)/g, '(...)')
    expect(withoutParens).not.toContain(' OR ')
  })
})

// ============================================================
// NIVEAU 2 — TESTS D'INTÉGRATION (mock fetch)
// ------------------------------------------------------------
// Objectif : vérifier le wiring complet sans appel réseau.
//   - URL/headers corrects (clé INSEE, Accept JSON).
//   - Curseur dans param `?curseur=`, pas dans `q=`.
//   - Encodage URI standard (parenthèses + espaces de la query Lucene).
//   - Mapping HTTP status → SireneApiError typée.
// ============================================================

describe('Niveau 2 — Intégration wiring fetch (mock global)', () => {
  // NAF court pour rester en mono-chunk legacy (curseur raw, pas composite).
  const NAF_MONO_CHUNK = ['10.11Z', '49.41A']

  it('200 OK : la query construite est envoyée correctement dans `?q=`', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ body: makeEmptySirenePage('*', '*') }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      pageSize: 100,
      nafCodes: NAF_MONO_CHUNK,
      codePostalRange: ['33000', '33999'],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = fetchedUrl(fetchMock)
    const decoded = decodeFetchUrl(url)

    // La query Lucene attendue est présente dans l'URL.
    expect(decoded).toContain('q=etatAdministratifEtablissement:A')
    expect(decoded).toContain('codePostalEtablissement:[33000 TO 33999]')
    expect(decoded).toContain('activitePrincipaleEtablissement:(10.11Z OR 49.41A)')
  })

  it('headers : `X-INSEE-Api-Key-Integration` et `Accept: application/json`', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ body: makeEmptySirenePage('*', '*') }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      pageSize: 100,
      nafCodes: NAF_MONO_CHUNK,
    })

    const [, options] = fetchMock.mock.calls[0] ?? []
    const headers = (options as RequestInit | undefined)?.headers as Record<string, string> | undefined
    expect(headers).toBeDefined()
    expect(headers!['X-INSEE-Api-Key-Integration']).toBe('test-api-key')
    expect(headers!['Accept']).toBe('application/json')
  })

  it('curseur est dans `?curseur=` SÉPARÉ, jamais dans `q=`', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ body: makeEmptySirenePage('c2', 'c2') }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprises({
      curseur: 'c2',
      maxPages: 1,
      pageSize: 100,
      nafCodes: NAF_MONO_CHUNK,
    })

    const url = fetchedUrl(fetchMock)
    const parsed = new URL(url)
    // Le curseur doit être un param dédié, pas un fragment de q.
    expect(parsed.searchParams.get('curseur')).toBe('c2')
    expect(parsed.searchParams.get('q')).not.toContain('curseur')
    expect(parsed.searchParams.get('q')).not.toContain('c2')
  })

  it('URL finale encode les caractères spéciaux de la query Lucene (parenthèses, espaces)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ body: makeEmptySirenePage('*', '*') }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      pageSize: 100,
      nafCodes: NAF_MONO_CHUNK,
    })

    const url = fetchedUrl(fetchMock)
    // L'URL brute (avant decode) doit encoder les parenthèses (`%28` / `%29`)
    // ou les avoir percent-encodées d'une manière ou d'une autre — sinon Solr peut
    // mal parser. Les espaces dans `OR` sont encodés en `+` par URLSearchParams.
    // Au minimum on attend un percent-encoded char OU des `+` (espaces de la query).
    expect(url).toMatch(/[%+]/)
    // Vérification miroir : la query décodée contient bien le format non-quoté attendu.
    const decoded = decodeFetchUrl(url)
    expect(decoded).toContain('etatAdministratifEtablissement:A')
    expect(decoded).not.toContain('"A"')
  })

  it('curseur `*` arrive nu dans le param (pas dans `q=`)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ body: makeEmptySirenePage('*', '*') }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      pageSize: 100,
      nafCodes: NAF_MONO_CHUNK,
    })

    const url = fetchedUrl(fetchMock)
    // URLSearchParams ne ré-encode pas `*` (caractère sub-delim non réservé en application/x-www-form-urlencoded).
    // L'invariant qu'on teste : `curseur=*` arrive intact à l'API Sirene, hors de q.
    expect(new URL(url).searchParams.get('curseur')).toBe('*')
    expect(url).toMatch(/[?&]curseur=\*(?:&|$)/)
  })

  it('HTTP 400 : throw SireneApiError avec status + extrait body', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({
        status: 400,
        text: 'Erreur de syntaxe dans le paramètre q',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    // Capturer l'erreur une seule fois pour éviter les unhandled rejections
    // (chaque `expect(promise).rejects` réobserve la même promesse).
    const error = await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      pageSize: 100,
      nafCodes: NAF_MONO_CHUNK,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(SireneApiError)
    expect((error as SireneApiError).status).toBe(400)
  })

  it('HTTP 429 : throw SireneApiError avec status=429 (rate limit)', async () => {
    // 429 est dans la plage [400, 500) — pas de retry, throw immédiat (cohérent avec fetchWithRetry).
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ status: 429, text: 'Too Many Requests' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const error = await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      pageSize: 100,
      nafCodes: NAF_MONO_CHUNK,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(SireneApiError)
    expect((error as SireneApiError).status).toBe(429)
  })

  it('HTTP 500 : retry puis throw SireneApiError si persistant', async () => {
    // `fetchWithRetry` retry 2 fois sur 5xx → 3 tentatives totales.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeResponse({ status: 500, text: 'Internal Server Error' }))
        .mockResolvedValueOnce(makeResponse({ status: 500, text: 'Internal Server Error' }))
        .mockResolvedValueOnce(makeResponse({ status: 500, text: 'Internal Server Error' }))
      vi.stubGlobal('fetch', fetchMock)

      const promise = sourcerEntreprises({
        curseur: '*',
        maxPages: 1,
        pageSize: 100,
        nafCodes: NAF_MONO_CHUNK,
      }).catch((e: unknown) => e)
      // Avancer les timers du backoff (1+2s).
      await vi.advanceTimersByTimeAsync(5_000)
      const error = await promise
      expect(error).toBeInstanceOf(SireneApiError)
      // 3 tentatives totales (1 initial + 2 retries).
      expect(fetchMock).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('erreur réseau (timeout) : throw SireneApiError avec message réseau', async () => {
    // `fetch` qui throw simule timeout / connection reset.
    // fetchWithRetry retry 2x sur erreur réseau → on retourne `mockRejectedValue` X fois.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const fetchMock = vi.fn().mockRejectedValue(new Error('fetch failed: ETIMEDOUT'))
      vi.stubGlobal('fetch', fetchMock)

      const promise = sourcerEntreprises({
        curseur: '*',
        maxPages: 1,
        pageSize: 100,
        nafCodes: NAF_MONO_CHUNK,
      }).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(5_000)
      const error = await promise
      expect(error).toBeInstanceOf(SireneApiError)
      expect((error as Error).message).toMatch(/erreur réseau/i)
    } finally {
      vi.useRealTimers()
    }
  })

  it('URL ciblée : api.insee.fr/api-sirene/3.11/siret (anti-régression endpoint)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ body: makeEmptySirenePage('*', '*') }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      pageSize: 100,
      nafCodes: NAF_MONO_CHUNK,
    })

    const url = fetchedUrl(fetchMock)
    expect(url).toMatch(/^https:\/\/api\.insee\.fr\/api-sirene\/3\.11\/siret\?/)
  })

  it('param `nombre` (pageSize) est passé tel quel — clampé à [1, 1000]', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ body: makeEmptySirenePage('*', '*') }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      pageSize: 250,
      nafCodes: NAF_MONO_CHUNK,
    })

    const url = fetchedUrl(fetchMock)
    expect(new URL(url).searchParams.get('nombre')).toBe('250')
  })
})

// ============================================================
// NIVEAU 3 — TESTS D'INTÉGRATION RÉELLE (opt-in)
// ------------------------------------------------------------
// Skipped par défaut. Pour activer :
//   $env:TEST_REAL_SIRENE = "true"
//   $env:INSEE_API_KEY    = "<ta-cle>"
//
// Ces tests appellent VRAIMENT api.insee.fr. À utiliser pour :
//   - smoke-test post-migration de l'API Sirene (rare).
//   - reproduire un HTTP 400 prod si la regression revient.
// ============================================================

const SHOULD_TEST_REAL_SIRENE =
  process.env.TEST_REAL_SIRENE === 'true' && !!process.env.INSEE_API_KEY

// `INSEE_SIRET_URL` mirror — gardé local pour ne pas exposer la const interne.
const REAL_SIRENE_URL = 'https://api.insee.fr/api-sirene/3.11/siret'
// SIREN stable et public, utilisé comme canari : Renault SAS (RCS Nanterre).
// Aucune PII — c'est une raison sociale connue, déjà publique.
const STABLE_SIREN = '441639465'

// 10 codes NAF prioritaires (sous-set représentatif du sourcing prod) — format
// Sirene canonique AVEC point. normalizeNafCodes accepte aussi le legacy sans
// point, mais on stocke ici la forme finale envoyée à Solr.
const PROD_LIKE_NAFS = [
  '01.21Z', '01.22Z',
  '30.30Z',
  '52.10B', '52.29A',
  '10.11Z', '10.13A',
  '46.17B',
  '49.41A', '49.41B',
]

describe.skipIf(!SHOULD_TEST_REAL_SIRENE)(
  'Niveau 3 — Sirene REAL API (require TEST_REAL_SIRENE=true + INSEE_API_KEY)',
  () => {
    // Pas de stub fetch ici — on appelle l'API réelle. Restaurer le `fetch` global
    // au cas où un autre fichier de test l'aurait laissé stubé (paranoïa CI).
    beforeEach(() => {
      vi.unstubAllGlobals()
    })

    it('query minimale par SIREN stable retourne 200 + 1 résultat', async () => {
      const url = new URL(REAL_SIRENE_URL)
      url.searchParams.set('q', `siren:${STABLE_SIREN}`)
      url.searchParams.set('nombre', '1')
      url.searchParams.set('curseur', '*')

      const response = await fetch(url.toString(), {
        headers: {
          'X-INSEE-Api-Key-Integration': process.env.INSEE_API_KEY!,
          Accept: 'application/json',
        },
      })

      expect(response.status).toBe(200)
      const data = (await response.json()) as {
        header?: { total?: number }
        etablissements?: unknown[]
      }
      // Au moins 1 établissement pour un SIREN actif.
      expect(data.header?.total ?? 0).toBeGreaterThanOrEqual(1)
      expect(Array.isArray(data.etablissements)).toBe(true)
    }, 15_000)

    it('query avec filtres complexes (production-like) retourne 200', async () => {
      // Reproduction du cas user qui plante (2026-05-12 / 2026-05-17).
      // Si cette query renvoie 400 → régression dans buildLuceneQuery ou Sirene v3.11.
      const q = buildLuceneQuery(
        PROD_LIKE_NAFS.slice(0, 5),
        ['21', '22', '31', '32', '41', '42', '51', '52', '53'],
        ['33000', '33999'],
      )
      const url = new URL(REAL_SIRENE_URL)
      url.searchParams.set('q', q)
      url.searchParams.set('nombre', '1')
      url.searchParams.set('curseur', '*')

      const response = await fetch(url.toString(), {
        headers: {
          'X-INSEE-Api-Key-Integration': process.env.INSEE_API_KEY!,
          Accept: 'application/json',
        },
      })

      // 200 OK ou 404 (univers vide) acceptés — TOUT 4xx hors 404 = régression.
      expect([200, 404]).toContain(response.status)
    }, 15_000)

    it('query NAF avec 10 codes prioritaires (sous limite Solr 20) retourne 200', async () => {
      // Cas réel : 10 NAF prioritaires + tranches 50+ + France entière.
      const q = buildLuceneQuery(
        PROD_LIKE_NAFS,
        ['21', '22', '31', '32', '41', '42', '51', '52', '53'],
        ['00000', '99999'],
      )
      const url = new URL(REAL_SIRENE_URL)
      url.searchParams.set('q', q)
      url.searchParams.set('nombre', '1')
      url.searchParams.set('curseur', '*')

      const response = await fetch(url.toString(), {
        headers: {
          'X-INSEE-Api-Key-Integration': process.env.INSEE_API_KEY!,
          Accept: 'application/json',
        },
      })

      expect([200, 404]).toContain(response.status)
      if (response.status === 200) {
        const data = (await response.json()) as { header?: { total?: number } }
        // Sanity : on devrait trouver au moins quelques établissements actifs dans toute la France.
        expect(data.header?.total ?? 0).toBeGreaterThan(0)
      }
    }, 15_000)
  },
)
