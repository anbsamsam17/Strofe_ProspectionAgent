// ============================================================
// TESTS UNITAIRES — sourcing.ts (Wave 3.1)
// Cible : pagination par curseur INSEE, filtrage excludeSirens,
//         validation params, erreurs typées, construction de requête.
//
// Stratégie de mock :
//   - fetch globalement stubé via vi.stubGlobal
//   - process.env.INSEE_API_KEY injectée en beforeEach
//   - Aucune dépendance réelle Sirene/ADEME
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chunkNafCodes,
  parseCompositeCursor,
  SireneApiError,
  SireneValidationError,
  sourcerEntreprises,
  sourcerEntreprisesFallback,
  type SourcerEntreprisesParams,
} from '../sourcing'
import {
  buildSirenePage,
  sireneCursorSequence,
} from './fixtures'

// ------------------------------------------------------------
// HELPERS DE MOCK
// ------------------------------------------------------------

interface MockResponseInit {
  status?: number
  ok?: boolean
  json?: () => Promise<unknown>
  text?: () => Promise<string>
}

function makeResponse(init: MockResponseInit): Response {
  const status = init.status ?? 200
  const ok = init.ok ?? (status >= 200 && status < 300)
  return {
    status,
    ok,
    json: init.json ?? (async () => ({})),
    text: init.text ?? (async () => ''),
  } as unknown as Response
}

function makeJsonResponse(body: unknown, status = 200): Response {
  return makeResponse({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  })
}

function makeBadJsonResponse(status = 200): Response {
  return makeResponse({
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      throw new Error('Unexpected token < in JSON at position 0')
    },
    text: async () => 'not-json',
  })
}

// Récupère les URLs de toutes les requêtes fetch capturées
function getFetchedUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]))
}

// Décode une URL fetch : remplace les '+' (espaces dans application/x-www-form-urlencoded)
// par des espaces avant de décoder %XX. Utile pour inspecter les queries Lucene.
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
// CATÉGORIE A — Pagination curseur
// ============================================================

// Sous-set de NAF court (1 seul chunk Sirene) — utilisé par les tests Cat. A pour
// rester en mode mono-chunk legacy et conserver le format `curseurSuivant` raw.
// Les défauts NAF_PRIORITAIRES (41 codes) basculent en mode composite (cf. Cat. H).
const NAF_TEST_MONO_CHUNK = ['10.11Z', '49.41A']

describe('sourcerEntreprises — pagination curseur (Cat. A)', () => {
  it('retourne page1 et curseurSuivant à jour pour curseur="*"', async () => {
    // Arrange : mock fetch → page1 du fixture (curseur='*' → 'c2')
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    // Act — NAF court pour rester en mono-chunk (rétrocompat curseur raw).
    const result = await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      pageSize: 100,
      nafCodes: NAF_TEST_MONO_CHUNK,
    })

    // Assert : page1 ramène 100 etabs, totalAvailable=250 (header), curseurSuivant='c2'
    expect(result.etablissements).toHaveLength(100)
    expect(result.curseur).toBe('*')
    expect(result.curseurSuivant).toBe('c2')
    expect(result.totalAvailable).toBe(250)
    expect(result.pagesLoaded).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('enchaîne 3 pages consécutives en passant le curseurSuivant à chaque appel', async () => {
    // Arrange : 3 appels distincts (le runner appelle maxPages=1 par page)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse(sireneCursorSequence.page1))
      .mockResolvedValueOnce(makeJsonResponse(sireneCursorSequence.page2))
      .mockResolvedValueOnce(makeJsonResponse(sireneCursorSequence.page3))
    vi.stubGlobal('fetch', fetchMock)

    // Act
    const r1 = await sourcerEntreprises({ curseur: '*', maxPages: 1, pageSize: 100, nafCodes: NAF_TEST_MONO_CHUNK })
    const r2 = await sourcerEntreprises({ curseur: 'c2', maxPages: 1, pageSize: 100, nafCodes: NAF_TEST_MONO_CHUNK })
    const r3 = await sourcerEntreprises({ curseur: 'c3', maxPages: 1, pageSize: 100, nafCodes: NAF_TEST_MONO_CHUNK })

    // Assert : la chaîne de curseur progresse correctement page après page.
    expect(r1.curseur).toBe('*')
    expect(r1.curseurSuivant).toBe('c2')
    expect(r1.etablissements).toHaveLength(100)

    expect(r2.curseur).toBe('c2')
    expect(r2.curseurSuivant).toBe('c3')
    expect(r2.etablissements).toHaveLength(100)

    expect(r3.curseur).toBe('c3')
    expect(r3.curseurSuivant).toBe('c3') // FIN d'univers — curseurSuivant === curseur
    expect(r3.exhausted).toBe(true)
    expect(r3.etablissements).toHaveLength(50)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('exhausted=false quand la première page de 2 a un curseurSuivant différent (maxPages=2)', async () => {
    // Test avec maxPages=2 : on enchaîne page1 → page2 dans le même appel.
    // page2 a curseurSuivant='c3' !== curseur='c2' → exhausted doit être false.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(makeJsonResponse(sireneCursorSequence.page1))
        .mockResolvedValueOnce(makeJsonResponse(sireneCursorSequence.page2))
      vi.stubGlobal('fetch', fetchMock)

      const promise = sourcerEntreprises({
        curseur: '*',
        maxPages: 2,
        pageSize: 100,
        nafCodes: NAF_TEST_MONO_CHUNK,
      })

      // Avancer les timers pour zapper SIRENE_DELAY_MS entre pages.
      await vi.advanceTimersByTimeAsync(3_000)
      const result = await promise

      expect(result.pagesLoaded).toBe(2)
      expect(result.curseurSuivant).toBe('c3')
      expect(result.etablissements).toHaveLength(200)
    } finally {
      vi.useRealTimers()
    }
  })

  it('détecte la fin d\'univers quand curseurSuivant === curseur', async () => {
    // Arrange : page terminale (curseurSuivant === curseur)
    const terminalPage = buildSirenePage({
      curseur: 'cX',
      curseurSuivant: 'cX',
      count: 5,
      sirenStart: 200_000_000,
      total: 5,
    })
    const fetchMock = vi.fn().mockResolvedValueOnce(makeJsonResponse(terminalPage))
    vi.stubGlobal('fetch', fetchMock)

    // Act
    const result = await sourcerEntreprises({
      curseur: 'cX',
      maxPages: 1,
      pageSize: 100,
      nafCodes: NAF_TEST_MONO_CHUNK,
    })

    // Assert
    expect(result.exhausted).toBe(true)
    expect(result.curseurSuivant).toBe('cX')
    expect(result.etablissements).toHaveLength(5)
  })
})

// ============================================================
// CATÉGORIE B — Filtrage excludeSirens
// ============================================================

describe('sourcerEntreprises — filtrage excludeSirens (Cat. B)', () => {
  it('exclut 80 SIREN parmi 100 retournés', async () => {
    // Arrange
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    // Construire un set excluant les 80 premiers SIREN de la page1
    const toExclude = new Set<string>()
    for (let i = 0; i < 80; i++) {
      toExclude.add(String(100_000_000 + i).padStart(9, '0'))
    }

    // Act
    const result = await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      pageSize: 100,
      excludeSirens: toExclude,
    })

    // Assert
    expect(result.etablissements).toHaveLength(20)
    // Les 20 restants doivent être les SIREN d'indices 80-99
    for (const etab of result.etablissements) {
      expect(toExclude.has(etab.siren)).toBe(false)
    }
  })

  it('retourne tout quand excludeSirens est vide', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      pageSize: 100,
      excludeSirens: new Set<string>(),
    })

    expect(result.etablissements).toHaveLength(100)
  })

  it('retourne tout quand excludeSirens est undefined', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      pageSize: 100,
    })

    expect(result.etablissements).toHaveLength(100)
  })
})

// ============================================================
// CATÉGORIE C — Validation des params
// ============================================================

describe('sourcerEntreprises — validation params (Cat. C)', () => {
  it('throw SireneValidationError pour effectifTranches contenant un code invalide', async () => {
    await expect(
      sourcerEntreprises({
        effectifTranches: ['21', '99'],
      }),
    ).rejects.toBeInstanceOf(SireneValidationError)
  })

  it('throw SireneValidationError quand effectifTranches est vide', async () => {
    await expect(
      sourcerEntreprises({
        effectifTranches: [],
      }),
    ).rejects.toBeInstanceOf(SireneValidationError)
  })

  it('throw SireneValidationError quand codePostalRange[0] > codePostalRange[1]', async () => {
    await expect(
      sourcerEntreprises({
        codePostalRange: ['33999', '33000'],
      }),
    ).rejects.toBeInstanceOf(SireneValidationError)
  })

  it('throw SireneValidationError quand codePostalRange bornes mal formatées', async () => {
    await expect(
      sourcerEntreprises({
        codePostalRange: ['33', '33999'],
      }),
    ).rejects.toBeInstanceOf(SireneValidationError)
  })

  it('clamp pageSize à 1000 quand > 1000', async () => {
    // L'implémentation clamp via Math.min(SIRENE_MAX_PAGE_SIZE, ...). On vérifie que
    // l'URL passée à fetch contient bien `nombre=1000` et pas plus.
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      pageSize: 5000, // > 1000
    })

    const url = getFetchedUrls(fetchMock)[0]
    expect(url).toMatch(/nombre=1000(&|$)/)
  })

  it('clamp pageSize à 1 quand <= 0', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      pageSize: 0,
    })

    const url = getFetchedUrls(fetchMock)[0]
    expect(url).toMatch(/nombre=1(&|$)/)
  })

  it('throw SireneValidationError quand maxPages <= 0', async () => {
    await expect(
      sourcerEntreprises({
        maxPages: 0,
      }),
    ).rejects.toBeInstanceOf(SireneValidationError)
  })
})

// ============================================================
// CATÉGORIE D — Gestion des erreurs
// ============================================================

describe('sourcerEntreprises — gestion erreurs API (Cat. D)', () => {
  it('throw SireneApiError sur HTTP 500 (après retries)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({ status: 500, ok: false, text: async () => 'Internal Error' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      sourcerEntreprises({ curseur: '*', maxPages: 1 }),
    ).rejects.toBeInstanceOf(SireneApiError)
  }, 15_000)

  it('throw SireneApiError sur HTTP 401 (4xx auth) — permet fallback côté caller', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ status: 401, ok: false, text: async () => 'Unauthorized' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      sourcerEntreprises({ curseur: '*', maxPages: 1 }),
    ).rejects.toBeInstanceOf(SireneApiError)
  })

  it('throw SireneApiError sur HTTP 400 (bad request) — permet fallback côté caller', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ status: 400, ok: false, text: async () => 'Bad Request' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      sourcerEntreprises({ curseur: '*', maxPages: 1 }),
    ).rejects.toBeInstanceOf(SireneApiError)
  })

  it('retourne tableau vide + exhausted=true + universeEmpty=true sur HTTP 404 (1ère page)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ status: 404, ok: false }),
    )
    vi.stubGlobal('fetch', fetchMock)

    // Mono-chunk → 404 sur la seule page = univers vide. Cf. Cat. H pour le mode chunké
    // où un 404 sur chunk 0 fait simplement passer au chunk 1 sans déclarer universeEmpty.
    const result = await sourcerEntreprises({ curseur: '*', maxPages: 1, nafCodes: NAF_TEST_MONO_CHUNK })

    expect(result.etablissements).toEqual([])
    expect(result.exhausted).toBe(true)
    // Décision produit 2026-05-12 : un 404 sur la 1ère page = univers vide
    // (filtres trop restrictifs), distinct d'un curseur consommé.
    expect(result.universeEmpty).toBe(true)
  })

  it('throw SireneApiError quand le body JSON est invalide', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeBadJsonResponse(200))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      sourcerEntreprises({ curseur: '*', maxPages: 1 }),
    ).rejects.toBeInstanceOf(SireneApiError)
  })

  it('throw SireneApiError quand fetch jette une erreur réseau', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      sourcerEntreprises({ curseur: '*', maxPages: 1 }),
    ).rejects.toBeInstanceOf(SireneApiError)
  }, 15_000)
})

// ============================================================
// CATÉGORIE E — Construction de la requête (Lucene)
// ============================================================

describe('sourcerEntreprises — construction de requête Lucene (Cat. E)', () => {
  it('inclut activitePrincipaleEtablissement:(NAF1 OR NAF2) avec nafCodes custom', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      nafCodes: ['10.11Z', '30.30Z'],
    })

    const url = decodeFetchUrl(getFetchedUrls(fetchMock)[0])
    expect(url).toContain('activitePrincipaleEtablissement:("1011Z" OR "3030Z")')
  })

  it('inclut codePostalEtablissement:[33000 TO 33999] avec codePostalRange', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      codePostalRange: ['33000', '33999'],
    })

    const url = decodeFetchUrl(getFetchedUrls(fetchMock)[0])
    expect(url).toContain('codePostalEtablissement:[33000 TO 33999]')
  })

  it('inclut trancheEffectifsEtablissement:(21 OR 22) avec effectifTranches custom', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      effectifTranches: ['21', '22'],
    })

    const url = decodeFetchUrl(getFetchedUrls(fetchMock)[0])
    expect(url).toContain('trancheEffectifsEtablissement:("21" OR "22")')
  })

  it('inclut etatAdministratifEtablissement:"A" par défaut (token quoté défensivement)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
    })

    const url = decodeFetchUrl(getFetchedUrls(fetchMock)[0])
    expect(url).toContain('etatAdministratifEtablissement:"A"')
  })

  it('passe le curseur dans la query string', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page2),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprises({
      curseur: 'c2',
      maxPages: 1,
    })

    const url = getFetchedUrls(fetchMock)[0]
    // URLSearchParams encode pas 'c2' (alphanum), donc on attend curseur=c2
    expect(url).toContain('curseur=c2')
  })

  it('passe l\'API key dans les headers', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprises({ curseur: '*', maxPages: 1 })

    const headers = fetchMock.mock.calls[0][1] as RequestInit
    const headerRecord = headers.headers as Record<string, string>
    expect(headerRecord['X-INSEE-Api-Key-Integration']).toBe('test-api-key')
  })

  it('n\'ajoute pas le filtre NAF si nafCodes est vide', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    const params: SourcerEntreprisesParams = {
      curseur: '*',
      maxPages: 1,
      nafCodes: [],
    }
    await sourcerEntreprises(params)

    const url = decodeFetchUrl(getFetchedUrls(fetchMock)[0])
    expect(url).not.toContain('activitePrincipaleEtablissement:(')
  })
})

// ============================================================
// CATÉGORIE F — universeEmpty vs exhausted (décision 2026-05-12)
// Distinction sémantique : 404 1ère page = univers vide ≠ pagination terminée.
// ============================================================

describe('sourcerEntreprises — universeEmpty (Cat. F)', () => {
  it('universeEmpty=true sur 404 dès la 1ère page (filtres → aucun match)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ status: 404, ok: false }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await sourcerEntreprises({
      nafCodes: ['01.21Z'],
      curseur: '*',
      maxPages: 1,
    })

    expect(result.universeEmpty).toBe(true)
    expect(result.exhausted).toBe(true)
    expect(result.etablissements).toEqual([])
  })

  it('universeEmpty=false quand Sirene répond 200 avec total>0 mais page vide (curseur terminale)', async () => {
    // L'univers existe (header.total = 5) mais la page courante ne renvoie aucun
    // établissement (par exemple : tous filtrés via excludeSirens, ou page de fin).
    // → exhausted=true mais universeEmpty=false.
    const terminalEmpty = buildSirenePage({
      curseur: '*',
      curseurSuivant: '*', // page terminale
      count: 0,
      total: 5,
    })
    const fetchMock = vi.fn().mockResolvedValueOnce(makeJsonResponse(terminalEmpty))
    vi.stubGlobal('fetch', fetchMock)

    const result = await sourcerEntreprises({
      nafCodes: ['01.21Z'],
      curseur: '*',
      maxPages: 1,
    })

    expect(result.universeEmpty).toBe(false)
    expect(result.totalAvailable).toBe(5)
    expect(result.exhausted).toBe(true)
  })

  it('universeEmpty=false sur page nominale (200, etablissements présents)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await sourcerEntreprises({ curseur: '*', maxPages: 1, nafCodes: NAF_TEST_MONO_CHUNK })

    expect(result.universeEmpty).toBe(false)
    expect(result.etablissements.length).toBeGreaterThan(0)
  })

  it('universeEmpty=false sur 404 reçu sur une page > 1 (fin de pagination, pas univers vide)', async () => {
    // Page 1 OK avec curseurSuivant différent → on continue. Page 2 → 404.
    // Au final exhausted=true mais universeEmpty doit rester false (l'univers
    // existait, la pagination est juste épuisée).
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(makeJsonResponse(sireneCursorSequence.page1))
        .mockResolvedValueOnce(makeResponse({ status: 404, ok: false }))
      vi.stubGlobal('fetch', fetchMock)

      const promise = sourcerEntreprises({ curseur: '*', maxPages: 2, pageSize: 100, nafCodes: NAF_TEST_MONO_CHUNK })
      await vi.advanceTimersByTimeAsync(3_000)
      const result = await promise

      expect(result.universeEmpty).toBe(false)
      expect(result.exhausted).toBe(true)
      expect(result.pagesLoaded).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

// ============================================================
// CATÉGORIE G — sourcerEntreprisesFallback (Recherche Entreprises)
// Décision 2026-05-12 : departements=[] = France entière (PAS de param departement).
// ============================================================

describe('sourcerEntreprisesFallback — paramètres URL', () => {
  it('omet le param departement quand departements=[] (France entière)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeJsonResponse({ results: [] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprisesFallback({
      nafCodes: ['49.41A'],
      departements: [],
      effectifTranches: ['41'],
      maxResults: 25,
    })

    expect(fetchMock).toHaveBeenCalled()
    const calledUrl = String(fetchMock.mock.calls[0][0])
    expect(calledUrl).not.toContain('departement=')
    expect(calledUrl).toContain('tranche_effectif_salarie=41')
    expect(calledUrl).toContain('activite_principale=49.41A')
  })

  it('omet le param departement quand departements absent (défaut implicite France entière)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeJsonResponse({ results: [] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprisesFallback({
      nafCodes: ['49.41A'],
      effectifTranches: ['41'],
      maxResults: 25,
    })

    const calledUrl = String(fetchMock.mock.calls[0][0])
    expect(calledUrl).not.toContain('departement=')
  })

  it('inclut le param departement quand departements=["75","33"]', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeJsonResponse({ results: [] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprisesFallback({
      nafCodes: ['49.41A'],
      departements: ['75', '33'],
      effectifTranches: ['21', '22'],
      maxResults: 25,
    })

    const calledUrl = String(fetchMock.mock.calls[0][0])
    // L'URL est encodée → "," devient "%2C"
    expect(calledUrl).toMatch(/departement=75(%2C|,)33/)
    expect(calledUrl).toMatch(/tranche_effectif_salarie=21(%2C|,)22/)
  })

  it('passe effectifTranches custom (au lieu du défaut 50+)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeJsonResponse({ results: [] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprisesFallback({
      nafCodes: ['49.41A'],
      departements: ['33'],
      effectifTranches: ['11', '12'], // 10-49 salariés (cible non-BEGES)
      maxResults: 25,
    })

    const calledUrl = String(fetchMock.mock.calls[0][0])
    expect(calledUrl).toMatch(/tranche_effectif_salarie=11(%2C|,)12/)
    // Vérifier qu'on n'a PAS le défaut legacy (50+)
    expect(calledUrl).not.toContain('21%2C22%2C31')
  })
})

// ============================================================
// CATÉGORIE H — Chunking NAF (Sirene Solr boolean-clauses limit)
// Régression du bug prod 2026-05-12 : 41 codes NAF + 5 tranches → HTTP 400
// "Erreur de syntaxe dans le paramètre q". On chunke à 20 NAF max et on
// expose un curseur composite `chunk:<index>|<rawCursor>`.
// ============================================================

describe('chunkNafCodes (Cat. H — helper unitaire)', () => {
  it('retourne un seul chunk vide pour une liste vide', () => {
    expect(chunkNafCodes([])).toEqual([[]])
  })

  it('retourne un seul chunk pour ≤ 20 NAF', () => {
    const naf = Array.from({ length: 15 }, (_, i) => `${String(i).padStart(2, '0')}.00Z`)
    const chunks = chunkNafCodes(naf)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toHaveLength(15)
  })

  it('découpe en chunks de 20 max — 41 NAF → 3 chunks (20+20+1)', () => {
    const naf = Array.from({ length: 41 }, (_, i) => `${String(i).padStart(2, '0')}.00Z`)
    const chunks = chunkNafCodes(naf)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(20)
    expect(chunks[1]).toHaveLength(20)
    expect(chunks[2]).toHaveLength(1)
  })

  it('respecte un chunkSize custom', () => {
    const naf = Array.from({ length: 50 }, (_, i) => `${i}`)
    const chunks = chunkNafCodes(naf, 25)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toHaveLength(25)
    expect(chunks[1]).toHaveLength(25)
  })

  it('préserve l\'ordre d\'entrée (stabilité de la signature)', () => {
    const naf = ['Z', 'A', 'M', 'B', 'Y']
    expect(chunkNafCodes(naf, 2)).toEqual([['Z', 'A'], ['M', 'B'], ['Y']])
  })
})

describe('parseCompositeCursor (Cat. H — helper unitaire)', () => {
  it('parse un curseur raw legacy "*" comme chunk 0', () => {
    expect(parseCompositeCursor('*')).toEqual({ chunkIndex: 0, rawCursor: '*' })
  })

  it('parse un curseur raw legacy "abc123" comme chunk 0', () => {
    expect(parseCompositeCursor('abc123')).toEqual({ chunkIndex: 0, rawCursor: 'abc123' })
  })

  it('parse un curseur composite "chunk:0|*"', () => {
    expect(parseCompositeCursor('chunk:0|*')).toEqual({ chunkIndex: 0, rawCursor: '*' })
  })

  it('parse un curseur composite "chunk:2|abc123"', () => {
    expect(parseCompositeCursor('chunk:2|abc123')).toEqual({ chunkIndex: 2, rawCursor: 'abc123' })
  })

  it('parse un curseur composite avec rawCursor contenant "|"', () => {
    // Le séparateur est le PREMIER `|` rencontré → tout le reste fait partie du rawCursor.
    expect(parseCompositeCursor('chunk:1|raw|with|pipes')).toEqual({
      chunkIndex: 1,
      rawCursor: 'raw|with|pipes',
    })
  })

  it('tolère un préfixe malformé → fallback chunk 0', () => {
    expect(parseCompositeCursor('chunk:abc|*')).toEqual({ chunkIndex: 0, rawCursor: 'chunk:abc|*' })
  })
})

describe('sourcerEntreprises — chunking NAF (Cat. H — régression bug prod 2026-05-12)', () => {
  it('ne chunke PAS quand nafCodes ≤ 20 (1 seul appel fetch, curseur raw legacy)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    const naf = Array.from({ length: 15 }, (_, i) => `${String(i + 10).padStart(2, '0')}.00Z`)
    const result = await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      pageSize: 100,
      nafCodes: naf,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Le curseurSuivant reste raw (rétrocompat des callers qui persistent en DB).
    expect(result.curseurSuivant).toBe('c2')
    expect(result.curseurSuivant).not.toContain('chunk:')
  })

  it('chunke à 20 NAF max — query ne contient JAMAIS plus de 20 codes NAF (bug 2026-05-12)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    // Reproduit le scénario du bug prod : 41 NAF (naf_prioritaires_default).
    const naf = [
      '01.21Z', '01.22Z', '30.30Z', '52.10B', '52.29A',
      '10.11Z', '10.13A', '10.32Z', '10.51A', '10.71A',
      '46.17B', '49.41A', '49.41B', '52.21Z',
      '20.11Z', '20.14Z', '20.15Z', '23.11Z', '23.13Z',
      '24.10Z', '24.20Z', '25.11Z', '25.29Z', '28.11Z', '28.15Z',
      '35.11Z', '35.14Z', '38.11Z', '38.21Z',
      '41.20A', '41.20B', '42.11Z', '42.13A', '43.21A', '43.22A',
      '46.71Z', '46.72Z', '47.30Z', '55.10Z', '56.10A', '86.10Z',
    ]
    await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      pageSize: 100,
      nafCodes: naf,
      effectifTranches: ['41', '42', '51', '52', '53'],
      codePostalRange: ['00000', '99999'],
    })

    const url = decodeFetchUrl(getFetchedUrls(fetchMock)[0])
    const nafClauseMatch = url.match(/activitePrincipaleEtablissement:\(([^)]+)\)/)
    expect(nafClauseMatch).not.toBeNull()
    // Les NAF sont désormais quotés ("0121Z") pour défense Solr — on strip les guillemets ici.
    const nafsInQuery = nafClauseMatch![1].split(' OR ').map((t) => t.replace(/^"|"$/g, ''))
    expect(nafsInQuery.length).toBeLessThanOrEqual(20)
    // Vérifier qu'on a bien envoyé le chunk 0 (= 20 premiers NAF) en premier.
    expect(nafsInQuery[0]).toBe('0121Z')
    expect(nafsInQuery).toHaveLength(20)
  })

  it('expose un curseurSuivant composite "chunk:0|<raw>" en mode chunké', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    const naf = Array.from({ length: 41 }, (_, i) => `${String((i % 99) + 1).padStart(2, '0')}.${String(i).padStart(2, '0')}Z`)
    const result = await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      nafCodes: naf,
    })

    // Chunk 0 a renvoyé curseurSuivant='c2' (non terminal) → composite chunk:0|c2.
    expect(result.curseurSuivant).toBe('chunk:0|c2')
    expect(result.exhausted).toBe(false)
  })

  it('reprend correctement un curseur composite "chunk:1|*" → cible chunk 1 NAFs', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    // 25 NAF générés → 2 chunks (20 + 5). Reprise sur chunk 1 doit cibler les 5 derniers.
    const naf = Array.from({ length: 25 }, (_, i) => `${String(Math.floor(i / 5) + 10).padStart(2, '0')}.${String(i).padStart(2, '0')}Z`)
    await sourcerEntreprises({
      curseur: 'chunk:1|*',
      maxPages: 1,
      nafCodes: naf,
    })

    const url = decodeFetchUrl(getFetchedUrls(fetchMock)[0])
    const nafClauseMatch = url.match(/activitePrincipaleEtablissement:\(([^)]+)\)/)
    const nafsInQuery = nafClauseMatch![1].split(' OR ')
    // Chunk 1 = NAFs index 20-24 (5 codes seulement, le reste).
    expect(nafsInQuery).toHaveLength(5)
    // Et le curseur passé doit être '*' (le rawCursor du composite chunk:1|*).
    expect(url).toContain('curseur=*')
  })

  it('passe au chunk suivant quand le chunk courant est épuisé (curseurSuivant === curseur)', async () => {
    // Chunk 0 retourne curseurSuivant=== curseur (épuisé) → on doit basculer sur chunk 1.
    // Avec maxPages=2, on doit voir 2 fetchs : un pour chunk 0, un pour chunk 1.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const terminalChunk0 = buildSirenePage({
        curseur: '*',
        curseurSuivant: '*', // chunk 0 épuisé
        count: 10,
        total: 10,
        sirenStart: 100_000_000,
      })
      const chunk1Page = buildSirenePage({
        curseur: '*',
        curseurSuivant: 'c2', // chunk 1 a une suite
        count: 30,
        total: 100,
        sirenStart: 100_001_000,
      })
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(makeJsonResponse(terminalChunk0))
        .mockResolvedValueOnce(makeJsonResponse(chunk1Page))
      vi.stubGlobal('fetch', fetchMock)

      const naf = Array.from({ length: 25 }, (_, i) => `${String(i % 99).padStart(2, '0')}.${String(i).padStart(2, '0')}Z`)
      const promise = sourcerEntreprises({
        curseur: '*',
        maxPages: 2,
        pageSize: 100,
        nafCodes: naf,
      })
      await vi.advanceTimersByTimeAsync(3_000)
      const result = await promise

      expect(fetchMock).toHaveBeenCalledTimes(2)
      // 10 du chunk 0 + 30 du chunk 1
      expect(result.etablissements).toHaveLength(40)
      // Le curseurSuivant final est composite — chunk 1 a curseurSuivant='c2'.
      expect(result.curseurSuivant).toBe('chunk:1|c2')
      expect(result.exhausted).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('marque exhausted=true quand TOUS les chunks sont épuisés (mode composite)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      // 25 NAF → 2 chunks. Chaque chunk se termine en 1 page.
      const terminal0 = buildSirenePage({
        curseur: '*',
        curseurSuivant: '*',
        count: 5,
        total: 5,
        sirenStart: 100_000_000,
      })
      const terminal1 = buildSirenePage({
        curseur: '*',
        curseurSuivant: '*',
        count: 3,
        total: 3,
        sirenStart: 100_001_000,
      })
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(makeJsonResponse(terminal0))
        .mockResolvedValueOnce(makeJsonResponse(terminal1))
      vi.stubGlobal('fetch', fetchMock)

      const naf = Array.from({ length: 25 }, (_, i) => `${String(i % 99).padStart(2, '0')}.${String(i).padStart(2, '0')}Z`)
      const promise = sourcerEntreprises({
        curseur: '*',
        maxPages: 5,
        nafCodes: naf,
      })
      await vi.advanceTimersByTimeAsync(10_000)
      const result = await promise

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(result.etablissements).toHaveLength(8)
      expect(result.exhausted).toBe(true)
      // Convention : exhausted ↔ curseurSuivant === curseur d'entrée.
      expect(result.curseurSuivant).toBe('*')
    } finally {
      vi.useRealTimers()
    }
  })

  it('passe au chunk suivant sur 404 d\'un chunk intermédiaire (sans déclarer universeEmpty)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      // 25 NAF → 2 chunks. Chunk 0 → 404. Chunk 1 → résultats.
      const chunk1Page = buildSirenePage({
        curseur: '*',
        curseurSuivant: '*',
        count: 7,
        total: 7,
        sirenStart: 100_001_000,
      })
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(makeResponse({ status: 404, ok: false }))
        .mockResolvedValueOnce(makeJsonResponse(chunk1Page))
      vi.stubGlobal('fetch', fetchMock)

      const naf = Array.from({ length: 25 }, (_, i) => `${String(i % 99).padStart(2, '0')}.${String(i).padStart(2, '0')}Z`)
      const promise = sourcerEntreprises({
        curseur: '*',
        maxPages: 3,
        nafCodes: naf,
      })
      await vi.advanceTimersByTimeAsync(10_000)
      const result = await promise

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(result.etablissements).toHaveLength(7)
      // 404 sur chunk 0 puis succès sur chunk 1 → univers PAS vide.
      expect(result.universeEmpty).toBe(false)
      expect(result.exhausted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('throw SireneApiError 400 propagée (bug 2026-05-12 — fallback Recherche Entreprises déclenché)', async () => {
    // Reproduit le 400 prod : "Erreur de syntaxe dans le paramètre q". Même avec le chunking,
    // si Sirene rejette un chunk (auth, syntaxe résiduelle, etc.) on doit propager pour permettre
    // au caller `runAdaptiveSourcing` de basculer sur Recherche Entreprises.
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({
        status: 400,
        ok: false,
        text: async () => '{"header":{"statut":400,"message":"Erreur de syntaxe dans le paramètre q"}}',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const naf = Array.from({ length: 41 }, (_, i) => `${String(i % 99).padStart(2, '0')}.${String(i).padStart(2, '0')}Z`)
    await expect(
      sourcerEntreprises({
        curseur: '*',
        maxPages: 1,
        nafCodes: naf,
        effectifTranches: ['41', '42', '51', '52', '53'],
        codePostalRange: ['00000', '99999'],
      }),
    ).rejects.toBeInstanceOf(SireneApiError)
  })

  it('rétrocompat : 0 NAF passé → mode mono-chunk vide, pas de filtre activite', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      nafCodes: [],
    })

    const url = decodeFetchUrl(getFetchedUrls(fetchMock)[0])
    expect(url).not.toContain('activitePrincipaleEtablissement:(')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('déduplique les NAF en entrée avant chunking (stabilité curseur)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    // NAF dupliqués → doivent être dédupliqués → 1 seul chunk.
    const naf = ['01.21Z', '01.21Z', '01.22Z', '01.21Z', '30.30Z']
    await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      nafCodes: naf,
    })

    const url = decodeFetchUrl(getFetchedUrls(fetchMock)[0])
    const nafClauseMatch = url.match(/activitePrincipaleEtablissement:\(([^)]+)\)/)
    // Strip les guillemets de quoting Solr ajoutés depuis 2026-05-17.
    const nafsInQuery = nafClauseMatch![1].split(' OR ').map((t) => t.replace(/^"|"$/g, ''))
    expect(nafsInQuery).toEqual(['0121Z', '0122Z', '3030Z'])
  })
})
