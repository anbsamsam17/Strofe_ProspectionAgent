// ============================================================
// TESTS UNITAIRES — inpi.ts
//
// Couvre :
//   - Nominal : mandatairePrincipal = président, mandataires bien normalisés
//   - Empty : pouvoirs vide → mandataires: []
//   - 401 sur /companies → refresh token + retry → succès
//   - 404 → null
//   - Timeout → null
//   - INPI_USERNAME absent → throw avec message clair
//   - RGPD : date de naissance complète absente du résultat (année only)
//   - Cache token : 2 appels successifs n'invoquent qu'un seul login
//
// Mocks : vi.spyOn(global, 'fetch') (pas d'appel réseau réel).
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import inpiNominal from './__fixtures__/inpi/inpi-nominal.json'
import inpiEmpty from './__fixtures__/inpi/inpi-empty.json'
import inpi404 from './__fixtures__/inpi/inpi-404.json'
import { _resetInpiTokenCache, fetchInpiData } from '../inpi'

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function loginResponse(token = 'jwt-test-token-abcdef'): Response {
  return jsonResponse({ token }, 200)
}

const VALID_SIREN = '552120222'

// ------------------------------------------------------------
// SETUP
// ------------------------------------------------------------

beforeEach(() => {
  _resetInpiTokenCache()
  process.env.INPI_USERNAME = 'test@example.com'
  process.env.INPI_PASSWORD = 'super-secret'
})

afterEach(() => {
  vi.restoreAllMocks()
  _resetInpiTokenCache()
})

// ------------------------------------------------------------
// NOMINAL
// ------------------------------------------------------------

describe('fetchInpiData — nominal', () => {
  it('retourne mandataires normalisés et président comme principal', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(jsonResponse(inpiNominal, 200))

    const result = await fetchInpiData(VALID_SIREN)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).not.toBeNull()
    expect(result?.siren).toBe(VALID_SIREN)
    expect(result?.mandataires).toHaveLength(3)

    // Président retourné comme principal
    expect(result?.mandatairePrincipal?.qualite).toBe('Président')
    expect(result?.mandatairePrincipal?.nom).toBe('DUPONT')
    expect(result?.mandatairePrincipal?.prenoms).toBe('Jean Pierre')
    expect(result?.mandatairePrincipal?.anneeNaissance).toBe(1972)
  })

  it('utilise correctement les Bearer + Authorization headers', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(loginResponse('my-jwt-123'))
      .mockResolvedValueOnce(jsonResponse(inpiNominal, 200))

    await fetchInpiData(VALID_SIREN)

    const companyCall = fetchMock.mock.calls[1]
    const init = companyCall[1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer my-jwt-123')
  })
})

// ------------------------------------------------------------
// EMPTY
// ------------------------------------------------------------

describe('fetchInpiData — empty pouvoirs', () => {
  it('retourne mandataires: [] et mandatairePrincipal: null', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(jsonResponse(inpiEmpty, 200))

    const result = await fetchInpiData('552120999')

    expect(result).not.toBeNull()
    expect(result?.mandataires).toEqual([])
    expect(result?.mandatairePrincipal).toBeNull()
  })
})

// ------------------------------------------------------------
// 401 → REFRESH + RETRY
// ------------------------------------------------------------

describe('fetchInpiData — 401 retry', () => {
  it('refresh le token et retry une fois sur 401', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(loginResponse('token-v1-aaaaaaaaaa'))
      .mockResolvedValueOnce(jsonResponse({ error: 'expired' }, 401))
      .mockResolvedValueOnce(loginResponse('token-v2-bbbbbbbbbb'))
      .mockResolvedValueOnce(jsonResponse(inpiNominal, 200))

    const result = await fetchInpiData(VALID_SIREN)

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(result).not.toBeNull()
    expect(result?.mandataires).toHaveLength(3)

    // 2ᵉ requête /companies → utilise le token rafraîchi
    const retryCall = fetchMock.mock.calls[3]
    const init = retryCall[1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer token-v2-bbbbbbbbbb')
  })
})

// ------------------------------------------------------------
// 404
// ------------------------------------------------------------

describe('fetchInpiData — 404', () => {
  it('retourne null si SIREN inconnu', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(jsonResponse(inpi404, 404))

    const result = await fetchInpiData('000000000')
    expect(result).toBeNull()
  })
})

// ------------------------------------------------------------
// TIMEOUT
// ------------------------------------------------------------

describe('fetchInpiData — timeout', () => {
  it('retourne null sur timeout réseau', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(loginResponse())
      .mockRejectedValueOnce(new DOMException('aborted', 'TimeoutError'))

    const result = await fetchInpiData(VALID_SIREN)
    expect(result).toBeNull()
  })
})

// ------------------------------------------------------------
// CONFIG ABSENTE
// ------------------------------------------------------------

describe('fetchInpiData — config absente', () => {
  it('throw si INPI_USERNAME absent', async () => {
    delete process.env.INPI_USERNAME

    await expect(fetchInpiData(VALID_SIREN)).rejects.toThrow(
      /INPI_USERNAME et INPI_PASSWORD/,
    )
  })

  it('throw si INPI_PASSWORD absent', async () => {
    delete process.env.INPI_PASSWORD

    await expect(fetchInpiData(VALID_SIREN)).rejects.toThrow(
      /INPI_USERNAME et INPI_PASSWORD/,
    )
  })
})

// ------------------------------------------------------------
// SIREN INVALIDE
// ------------------------------------------------------------

describe('fetchInpiData — SIREN invalide', () => {
  it('retourne null sans appel réseau si SIREN mal formé', async () => {
    const fetchMock = vi.spyOn(global, 'fetch')

    const result = await fetchInpiData('12345')

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------
// RGPD : date de naissance complète absente
// ------------------------------------------------------------

describe('fetchInpiData — RGPD', () => {
  it('le résultat ne contient JAMAIS la date de naissance complète (jour/mois)', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(jsonResponse(inpiNominal, 200))

    const result = await fetchInpiData(VALID_SIREN)
    // On sérialise uniquement les données personnelles (mandataires) —
    // dateMaj est une metadata du dossier RNE, légitime à conserver.
    const personal = JSON.stringify({
      mandataires: result?.mandataires,
      mandatairePrincipal: result?.mandatairePrincipal,
    })

    // Aucune date complète au format YYYY-MM-DD
    expect(personal).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    // Aucune date partielle YYYY-MM (le négatif lookahead évite l'année seule)
    expect(personal).not.toMatch(/\d{4}-\d{2}(?!\d)/)
    // Vérifications spécifiques : pas de "1972-04-18" ni "1972-04"
    expect(personal).not.toContain('1972-04-18')
    expect(personal).not.toContain('1972-04')
    expect(personal).not.toContain('1980-11')

    // Année seule présente
    expect(result?.mandatairePrincipal?.anneeNaissance).toBe(1972)
  })

  it("ne retourne JAMAIS les bénéficiaires effectifs (RBE — adresses personnelles)", async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(jsonResponse(inpiNominal, 200))

    const result = await fetchInpiData(VALID_SIREN)
    const serialized = JSON.stringify(result)

    // Pas de mention d'adresse de domicile (RBE)
    expect(serialized).not.toContain('adresseDomicile')
    expect(serialized).not.toContain('RUE DE LA PAIX')
    expect(serialized).not.toContain('beneficiaire')

    // Aucune clé `beneficiairesEffectifs` exposée
    expect(Object.keys(result ?? {})).not.toContain('beneficiairesEffectifs')
  })
})

// ------------------------------------------------------------
// CACHE TOKEN
// ------------------------------------------------------------

describe('fetchInpiData — cache token', () => {
  it('2 appels successifs n\'invoquent qu\'un seul login', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(jsonResponse(inpiNominal, 200))
      .mockResolvedValueOnce(jsonResponse(inpiNominal, 200))

    const r1 = await fetchInpiData(VALID_SIREN)
    const r2 = await fetchInpiData(VALID_SIREN)

    expect(r1).not.toBeNull()
    expect(r2).not.toBeNull()

    // 1 login + 2 GET /companies = 3 appels
    expect(fetchMock).toHaveBeenCalledTimes(3)

    // Le 1ᵉʳ appel est le login
    const loginCall = fetchMock.mock.calls[0]
    expect(String(loginCall[0])).toContain('/api/sso/login')

    // Les 2 suivants sont les GET companies
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/companies/')
    expect(String(fetchMock.mock.calls[2][0])).toContain('/api/companies/')
  })

  it('_resetInpiTokenCache force un nouveau login', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(loginResponse('t1-xxxxxxxxxxxx'))
      .mockResolvedValueOnce(jsonResponse(inpiNominal, 200))
      .mockResolvedValueOnce(loginResponse('t2-yyyyyyyyyyyy'))
      .mockResolvedValueOnce(jsonResponse(inpiNominal, 200))

    await fetchInpiData(VALID_SIREN)
    _resetInpiTokenCache()
    await fetchInpiData(VALID_SIREN)

    // 2 logins + 2 GET = 4 appels
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/sso/login')
    expect(String(fetchMock.mock.calls[2][0])).toContain('/api/sso/login')
  })
})
