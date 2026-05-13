// ============================================================
// TESTS UNITAIRES — linkedin-company.ts
// Couvre :
//   1. buildLinkedinSlug : normalisation accents, formes juridiques,
//      ponctuation, apostrophes
//   2. findLinkedinCompanyUrl : 200 → URL, 404 → null, 999 → null,
//      timeout → null
// Vitest — pattern AAA, mocks via vi.spyOn(global, 'fetch').
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildLinkedinSlug,
  findLinkedinCompanyUrl,
  headLinkedinCompany,
} from '../linkedin-company'

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

interface MockResponseInit {
  status?: number
}

function makeHeadResponse(init: MockResponseInit = {}): Response {
  const status = init.status ?? 200
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
  } as unknown as Response
}

// ------------------------------------------------------------
// buildLinkedinSlug
// ------------------------------------------------------------

describe('buildLinkedinSlug', () => {
  it('produit "foo-bar" pour "Foo Bar SAS"', () => {
    expect(buildLinkedinSlug('Foo Bar SAS')).toBe('foo-bar')
  })

  it('retire les apostrophes sans tiret intermédiaire : "L\'Oréal S.A." → "loreal"', () => {
    expect(buildLinkedinSlug("L'Oréal S.A.")).toBe('loreal')
  })

  it('retire les accents : "Société Générale" → "societe-generale"', () => {
    expect(buildLinkedinSlug('Société Générale')).toBe('societe-generale')
  })

  it('remplace les esperluettes par un tiret : "Acme & Co" → "acme-co"', () => {
    expect(buildLinkedinSlug('Acme & Co')).toBe('acme-co')
  })

  it('retire les formes juridiques courantes : "Carrefour SA" → "carrefour"', () => {
    expect(buildLinkedinSlug('Carrefour SA')).toBe('carrefour')
  })

  it('retire SARL en queue : "Petite Entreprise SARL" → "petite-entreprise"', () => {
    expect(buildLinkedinSlug('Petite Entreprise SARL')).toBe('petite-entreprise')
  })

  it('gère apostrophe typographique : "L’Atelier" → "latelier"', () => {
    expect(buildLinkedinSlug('L’Atelier')).toBe('latelier')
  })

  it('retire SE (Societas Europaea) : "Airbus SE" → "airbus"', () => {
    expect(buildLinkedinSlug('Airbus SE')).toBe('airbus')
  })

  it('retourne null pour chaîne vide', () => {
    expect(buildLinkedinSlug('')).toBeNull()
  })

  it('retourne null pour entrée uniquement forme juridique', () => {
    expect(buildLinkedinSlug('SAS')).toBeNull()
  })

  it('retourne null pour entrée uniquement ponctuation', () => {
    expect(buildLinkedinSlug('!!!')).toBeNull()
  })

  it('retourne null pour entrée trop courte après nettoyage', () => {
    // "A SAS" → "a" (1 char) < SLUG_MIN_LENGTH=2
    expect(buildLinkedinSlug('A SAS')).toBeNull()
  })

  it('retourne null pour entrée extrêmement longue (> 80 chars)', () => {
    const tooLong = 'a'.repeat(100)
    expect(buildLinkedinSlug(tooLong)).toBeNull()
  })

  it('idempotent sur une saisie déjà propre : "carrefour" → "carrefour"', () => {
    expect(buildLinkedinSlug('carrefour')).toBe('carrefour')
  })

  it('compacte les espaces multiples en un seul tiret', () => {
    expect(buildLinkedinSlug('foo    bar')).toBe('foo-bar')
  })
})

// ------------------------------------------------------------
// headLinkedinCompany — accès direct au HEAD HTTP (mockable)
// ------------------------------------------------------------

describe('headLinkedinCompany', () => {
  // vi.fn() + vi.stubGlobal — convention du projet (cf. sourcing.test.ts).
  // Évite les frictions de typing avec vi.spyOn sur l'overload `fetch`.
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retourne exists=true pour HTTP 200', async () => {
    fetchSpy.mockResolvedValueOnce(makeHeadResponse({ status: 200 }))

    const result = await headLinkedinCompany('carrefour')

    expect(result.exists).toBe(true)
    expect(result.status).toBe(200)
    expect(result.rateLimited).toBe(false)
  })

  it('retourne exists=true pour HTTP 301 (redirect vers URL canonique)', async () => {
    fetchSpy.mockResolvedValueOnce(makeHeadResponse({ status: 301 }))

    const result = await headLinkedinCompany('carrefour')

    expect(result.exists).toBe(true)
  })

  it('retourne exists=false pour HTTP 404', async () => {
    fetchSpy.mockResolvedValueOnce(makeHeadResponse({ status: 404 }))

    const result = await headLinkedinCompany('nexistepas')

    expect(result.exists).toBe(false)
    expect(result.status).toBe(404)
  })

  it('retourne rateLimited=true pour HTTP 999', async () => {
    fetchSpy.mockResolvedValueOnce(makeHeadResponse({ status: 999 }))

    const result = await headLinkedinCompany('foo')

    expect(result.rateLimited).toBe(true)
    expect(result.exists).toBe(false)
  })

  it('retourne status=0 et exists=false sur timeout réseau', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('AbortError: timeout'))

    const result = await headLinkedinCompany('foo')

    expect(result.status).toBe(0)
    expect(result.exists).toBe(false)
  })

  it('utilise la méthode HEAD (pas GET)', async () => {
    fetchSpy.mockResolvedValueOnce(makeHeadResponse({ status: 200 }))

    await headLinkedinCompany('carrefour')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const call = fetchSpy.mock.calls[0]
    const init = call[1] as RequestInit
    expect(init.method).toBe('HEAD')
  })

  it('cible bien le domaine www.linkedin.com (anti-SSRF)', async () => {
    fetchSpy.mockResolvedValueOnce(makeHeadResponse({ status: 200 }))

    await headLinkedinCompany('carrefour')

    const call = fetchSpy.mock.calls[0]
    const url = call[0] as string
    expect(url).toMatch(/^https:\/\/www\.linkedin\.com\/company\//)
  })
})

// ------------------------------------------------------------
// findLinkedinCompanyUrl — fonction publique cascade
// ------------------------------------------------------------

describe('findLinkedinCompanyUrl', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retourne l\'URL canonique sur HTTP 200', async () => {
    fetchSpy.mockResolvedValueOnce(makeHeadResponse({ status: 200 }))

    const url = await findLinkedinCompanyUrl('Carrefour SA')

    expect(url).toBe('https://www.linkedin.com/company/carrefour/')
  })

  it('retourne null sur HTTP 404 (page inexistante)', async () => {
    fetchSpy.mockResolvedValueOnce(makeHeadResponse({ status: 404 }))

    const url = await findLinkedinCompanyUrl('Entreprise Inconnue SAS')

    expect(url).toBeNull()
  })

  it('retourne null sur HTTP 999 (rate-limit LinkedIn)', async () => {
    fetchSpy.mockResolvedValueOnce(makeHeadResponse({ status: 999 }))

    const url = await findLinkedinCompanyUrl('Carrefour SA')

    expect(url).toBeNull()
  })

  it('retourne null sur slug non constructible (raison sociale vide)', async () => {
    const url = await findLinkedinCompanyUrl('')

    expect(url).toBeNull()
    // Aucun fetch ne doit avoir été tenté quand le slug est invalide
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('retourne null si raison sociale = uniquement forme juridique ("SAS")', async () => {
    const url = await findLinkedinCompanyUrl('SAS')

    expect(url).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('retourne null sur timeout réseau', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('timeout'))

    const url = await findLinkedinCompanyUrl('Carrefour SA')

    expect(url).toBeNull()
  })
})
