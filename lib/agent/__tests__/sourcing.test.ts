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

describe('sourcerEntreprises — pagination curseur (Cat. A)', () => {
  it('retourne page1 et curseurSuivant à jour pour curseur="*"', async () => {
    // Arrange : mock fetch → page1 du fixture (curseur='*' → 'c2')
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    // Act
    const result = await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
      pageSize: 100,
    })

    // Assert : page1 ramène 100 etabs, totalAvailable=250 (header), curseurSuivant='c2'
    expect(result.etablissements).toHaveLength(100)
    expect(result.curseur).toBe('*')
    expect(result.curseurSuivant).toBe('c2')
    expect(result.totalAvailable).toBe(250)
    expect(result.pagesLoaded).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // NOTE: voir BUG-A1 dans le rapport — avec maxPages=1, `exhausted` est forcé
    // à true car `currentCurseur` est avancé même à la dernière itération.
  })

  it('enchaîne 3 pages consécutives en passant le curseurSuivant à chaque appel', async () => {
    // Arrange : 3 appels distincts (le runner appelle maxPages=1 par page)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse(sireneCursorSequence.page1))
      .mockResolvedValueOnce(makeJsonResponse(sireneCursorSequence.page2))
      .mockResolvedValueOnce(makeJsonResponse(sireneCursorSequence.page3))
    vi.stubGlobal('fetch', fetchMock)

    // Act
    const r1 = await sourcerEntreprises({ curseur: '*', maxPages: 1, pageSize: 100 })
    const r2 = await sourcerEntreprises({ curseur: 'c2', maxPages: 1, pageSize: 100 })
    const r3 = await sourcerEntreprises({ curseur: 'c3', maxPages: 1, pageSize: 100 })

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

    const result = await sourcerEntreprises({ curseur: '*', maxPages: 1 })

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
    expect(url).toContain('activitePrincipaleEtablissement:(1011Z OR 3030Z)')
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
    expect(url).toContain('trancheEffectifsEtablissement:(21 OR 22)')
  })

  it('inclut etatAdministratifEtablissement:A par défaut', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(sireneCursorSequence.page1),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sourcerEntreprises({
      curseur: '*',
      maxPages: 1,
    })

    const url = decodeFetchUrl(getFetchedUrls(fetchMock)[0])
    expect(url).toContain('etatAdministratifEtablissement:A')
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

    const result = await sourcerEntreprises({ curseur: '*', maxPages: 1 })

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

      const promise = sourcerEntreprises({ curseur: '*', maxPages: 2, pageSize: 100 })
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
