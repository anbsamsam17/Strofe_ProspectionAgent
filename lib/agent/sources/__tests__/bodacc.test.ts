// ============================================================
// TESTS UNITAIRES — bodacc.ts + route /api/cron/bodacc-changes
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import bodaccChangesFixture from './__fixtures__/bodacc/bodacc-changes.json'
import bodaccEmptyFixture from './__fixtures__/bodacc/bodacc-empty.json'

import {
  extractDirigeantChanges,
  fetchBodaccChanges,
} from '../bodacc'

// ------------------------------------------------------------
// MOCK HELPERS
// ------------------------------------------------------------

function makeResponse(init: {
  status?: number
  ok?: boolean
  json?: () => Promise<unknown>
}): Response {
  const status = init.status ?? 200
  const ok = init.ok ?? (status >= 200 && status < 300)
  return {
    status,
    ok,
    json: init.json ?? (async () => ({})),
  } as unknown as Response
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

// ------------------------------------------------------------
// extractDirigeantChanges
// ------------------------------------------------------------

describe('extractDirigeantChanges', () => {
  it('garde uniquement les changements de dirigeants surveillés', () => {
    const result = extractDirigeantChanges(bodaccChangesFixture.results)
    // 3 records utiles (Président, Gérant, Directeur général) ; 2 ignorés (Capital, Adresse)
    expect(result).toHaveLength(3)

    const fonctions = result.map((r) => r.personne?.fonction)
    expect(fonctions).toContain('Président')
    expect(fonctions).toContain('Gérant')
    expect(fonctions).toContain('Directeur général')
    expect(fonctions).not.toContain('Capital')
    expect(fonctions).not.toContain('Adresse')
  })

  it('extrait correctement le SIREN depuis registre[]', () => {
    const result = extractDirigeantChanges(bodaccChangesFixture.results)
    const sirens = result.map((r) => r.siren).sort()
    expect(sirens).toEqual(['123456789', '555666777', '987654321'])
  })

  it('retourne [] sur input vide', () => {
    expect(extractDirigeantChanges([])).toEqual([])
    expect(extractDirigeantChanges(bodaccEmptyFixture.results)).toEqual([])
  })

  it('ignore les records mal formés', () => {
    const malformed = [
      { foo: 'bar' },
      null,
      undefined,
      { registre: 'not-an-array', personne_fonction: 'Président' },
      { registre: ['123456789'], personne_fonction: 'Président' }, // valide
    ]
    const result = extractDirigeantChanges(malformed)
    expect(result).toHaveLength(1)
    expect(result[0].siren).toBe('123456789')
  })

  it('ignore les fonctions hors whitelist', () => {
    const records = [
      {
        registre: ['123456789'],
        personne_fonction: 'Commissaire aux comptes',
        personne_nom: 'X',
        personne_prenom: 'Y',
      },
    ]
    expect(extractDirigeantChanges(records)).toEqual([])
  })
})

// ------------------------------------------------------------
// fetchBodaccChanges
// ------------------------------------------------------------

describe('fetchBodaccChanges', () => {
  const since = new Date('2026-05-01T00:00:00Z')

  it('retourne [] sur liste SIREN vide', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchBodaccChanges([], { since })
    expect(result).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('filtre les SIREN invalides (non 9 chiffres)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({ json: async () => bodaccEmptyFixture }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchBodaccChanges(['abc', '12345', '999'], { since })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('appelle BODACC et retourne les changements dirigeants', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({ json: async () => bodaccChangesFixture }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchBodaccChanges(
      ['123456789', '987654321', '555666777'],
      { since },
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(3)
  })

  it('inclut Accept + User-Agent dans les headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({ json: async () => bodaccEmptyFixture }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchBodaccChanges(['123456789'], { since })
    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers['Accept']).toBe('application/json')
    expect(headers['User-Agent']).toMatch(/prospection-agent/)
  })

  it('paginatione via offset jusqu\'à page partielle', async () => {
    // Page 1 : 100 records "Président" → paginera ; Page 2 : 5 records → stop.
    const fullPage = {
      results: Array.from({ length: 100 }, (_, i) => ({
        registre: [String(100000000 + i).padStart(9, '0')],
        dateparution: '2026-05-10',
        typeavis_lib: 'Modification',
        personne_nom: 'X',
        personne_prenom: 'Y',
        personne_fonction: 'Président',
      })),
    }
    const partialPage = {
      results: Array.from({ length: 5 }, (_, i) => ({
        registre: [String(200000000 + i).padStart(9, '0')],
        dateparution: '2026-05-10',
        typeavis_lib: 'Modification',
        personne_nom: 'X',
        personne_prenom: 'Y',
        personne_fonction: 'Gérant',
      })),
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse({ json: async () => fullPage }))
      .mockResolvedValueOnce(makeResponse({ json: async () => partialPage }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchBodaccChanges(['123456789'], { since })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(105)

    // Vérifier que offset=100 a été envoyé au 2e appel
    const url2 = String(fetchMock.mock.calls[1][0])
    expect(url2).toContain('offset=100')
  })

  it('retourne [] sur timeout (fetch throws)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('AbortError'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchBodaccChanges(['123456789'], { since })
    expect(result).toEqual([])
  })

  it('retourne [] sur HTTP 500', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchBodaccChanges(['123456789'], { since })
    expect(result).toEqual([])
  })

  it('retourne [] sur HTTP 4xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ status: 400 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchBodaccChanges(['123456789'], { since })
    expect(result).toEqual([])
  })

  it('retourne [] sur JSON malformé', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({
        json: async () => {
          throw new Error('Unexpected token')
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchBodaccChanges(['123456789'], { since })
    expect(result).toEqual([])
  })

  it('retourne [] si la réponse JSON ne matche pas le schema', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({ json: async () => ({ results: 'not-an-array' }) }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchBodaccChanges(['123456789'], { since })
    expect(result).toEqual([])
  })

  it('construit une URL ciblant le domaine BODACC officiel', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({ json: async () => bodaccEmptyFixture }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchBodaccChanges(['123456789'], { since })
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('bodacc-datadila.opendatasoft.com')
    expect(url).toContain('annonces-commerciales')
  })
})

// ------------------------------------------------------------
// Route /api/cron/bodacc-changes
// ------------------------------------------------------------

const mockSelectChain = vi.fn()
const mockUpdateEqUser = vi.fn()
const mockUpdateEqSiren = vi.fn(() => ({ eq: mockUpdateEqUser }))
const mockUpdate = vi.fn(() => ({ eq: mockUpdateEqSiren }))
const mockFrom = vi.fn(() => ({
  select: vi.fn(() => ({
    is: vi.fn(() => ({ not: mockSelectChain })),
  })),
  update: mockUpdate,
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('@/lib/auth/cron', () => ({
  isCronRequest: vi.fn(),
}))

import { POST } from '@/app/api/cron/bodacc-changes/route'
import { isCronRequest } from '@/lib/auth/cron'
import { NextRequest } from 'next/server'

const mockedIsCronRequest = isCronRequest as unknown as ReturnType<typeof vi.fn>

function makeCronRequest(): NextRequest {
  return new NextRequest('http://localhost/api/cron/bodacc-changes', {
    method: 'POST',
    headers: { Authorization: 'Bearer fake-secret' },
  })
}

describe('POST /api/cron/bodacc-changes', () => {
  beforeEach(() => {
    mockedIsCronRequest.mockReturnValue(true)
    mockSelectChain.mockReset()
    mockUpdateEqUser.mockReset()
    mockUpdateEqUser.mockResolvedValue({ error: null })
  })

  it('refuse 401 sans secret cron valide', async () => {
    mockedIsCronRequest.mockReturnValue(false)
    const res = await POST(makeCronRequest())
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('retourne 0 changes si aucun prospect actif', async () => {
    mockSelectChain.mockResolvedValueOnce({ data: [], error: null })

    const res = await POST(makeCronRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { changes: number } }
    expect(body.data.changes).toBe(0)
  })

  it('500 si SELECT prospects échoue', async () => {
    mockSelectChain.mockResolvedValueOnce({
      data: null,
      error: { message: 'db down' },
    })

    const res = await POST(makeCronRequest())
    expect(res.status).toBe(500)
  })

  it('marque contact_outdated_at quand BODACC renvoie un changement', async () => {
    mockSelectChain.mockResolvedValueOnce({
      data: [
        { id: 'p1', siren: '123456789', user_id: 'u1' },
        { id: 'p2', siren: '987654321', user_id: 'u1' },
      ],
      error: null,
    })

    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({ json: async () => bodaccChangesFixture }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeCronRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { changes: number; prospects_updated: number }
    }
    // Le fixture contient 3 changements dirigeants (123456789, 987654321, 555666777)
    // mais seuls 123456789 et 987654321 sont dans nos prospects → 2 updates
    expect(body.data.changes).toBe(3)
    expect(mockUpdate).toHaveBeenCalled()
    expect(body.data.prospects_updated).toBe(2)
  })

  it('ne logue jamais les noms de dirigeants (RGPD)', async () => {
    mockSelectChain.mockResolvedValueOnce({
      data: [{ id: 'p1', siren: '123456789', user_id: 'u1' }],
      error: null,
    })
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({ json: async () => bodaccChangesFixture }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await POST(makeCronRequest())

    const allLogs = logSpy.mock.calls.flat().join(' ')
    expect(allLogs).not.toContain('MARTIN')
    expect(allLogs).not.toContain('DURAND')
    expect(allLogs).not.toContain('BERNARD')
    logSpy.mockRestore()
  })
})
