// ============================================================
// TESTS — lib/agent/sources/recherche-entreprises-dirigeants.ts
// Mock systématique de fetch global, fixtures JSON adjacentes.
// ============================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fetchRechercheEntreprisesData,
  sortDirigeants,
  type Dirigeant,
} from '../recherche-entreprises-dirigeants'

// ------------------------------------------------------------
// FIXTURES
// ------------------------------------------------------------

const FIXTURE_DIR = join(__dirname, '__fixtures__', 'recherche-entreprises')

function loadFixture(name: string): unknown {
  const path = join(FIXTURE_DIR, name)
  return JSON.parse(readFileSync(path, 'utf-8'))
}

const FIXTURE_NOMINAL = loadFixture('nominal.json')
const FIXTURE_PAS_DE_DIRIGEANTS = loadFixture('pas-de-dirigeants.json')
const FIXTURE_SIREN_INCONNU = loadFixture('siren-inconnu.json')

// ------------------------------------------------------------
// HELPERS MOCK FETCH
// ------------------------------------------------------------

function makeJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function makeBrokenJsonResponse(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    text: async () => '<<not-json>>',
  } as unknown as Response
}

// ------------------------------------------------------------
// SETUP
// ------------------------------------------------------------

const VALID_SIREN = '552032534'

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ------------------------------------------------------------
// fetchRechercheEntreprisesData
// ------------------------------------------------------------

describe('fetchRechercheEntreprisesData', () => {
  it('cas nominal : retourne le président en dirigeantPrincipal', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(makeJsonResponse(FIXTURE_NOMINAL))

    const result = await fetchRechercheEntreprisesData(VALID_SIREN)

    expect(result).not.toBeNull()
    expect(result?.siren).toBe(VALID_SIREN)
    expect(result?.raisonSociale).toBe('ACME INDUSTRIES')
    // 4 dirigeants au total (3 physiques + 1 morale)
    expect(result?.dirigeants).toHaveLength(4)
    expect(result?.dirigeantPrincipal).not.toBeNull()
    expect(result?.dirigeantPrincipal?.nom).toBe('DUPONT')
    expect(result?.dirigeantPrincipal?.qualite.toLowerCase()).toContain('président')
    // Le siège est correctement mappé
    expect(result?.siege.adresse).toBe('12 RUE DE LA PAIX')
    expect(result?.siege.codePostal).toBe('75002')
    expect(result?.siege.commune).toBe('PARIS')
    // Pas exposé par cette API
    expect(result?.siege.telephone).toBeNull()
    expect(result?.siege.email).toBeNull()
    expect(result?.siege.siteWeb).toBeNull()
  })

  it('exclut les personnes morales du dirigeantPrincipal', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(makeJsonResponse(FIXTURE_NOMINAL))

    const result = await fetchRechercheEntreprisesData(VALID_SIREN)

    expect(result?.dirigeantPrincipal?.type).toBe('physique')
    // La personne morale "HOLDING INVEST" est conservée dans la liste mais
    // jamais sélectionnée comme principal.
    const moralePresente = result?.dirigeants.some((d) => d.type === 'morale')
    expect(moralePresente).toBe(true)
    expect(result?.dirigeantPrincipal?.nom).not.toBe('HOLDING INVEST')
  })

  it('cas entreprise sans dirigeants : dirigeants=[] et dirigeantPrincipal=null', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(makeJsonResponse(FIXTURE_PAS_DE_DIRIGEANTS))

    const result = await fetchRechercheEntreprisesData('123456789')

    expect(result).not.toBeNull()
    expect(result?.dirigeants).toEqual([])
    expect(result?.dirigeantPrincipal).toBeNull()
    expect(result?.siege.adresse).toBe('1 PLACE DU MARCHE')
  })

  it('SIREN inconnu (results vides) : retourne null', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(makeJsonResponse(FIXTURE_SIREN_INCONNU))

    const result = await fetchRechercheEntreprisesData('999999999')

    expect(result).toBeNull()
  })

  it('SIREN invalide (format) : retourne null sans appeler fetch', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')

    const result = await fetchRechercheEntreprisesData('abc')

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('timeout réseau : retourne null', async () => {
    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'
    vi.spyOn(global, 'fetch').mockRejectedValue(abortError)

    const result = await fetchRechercheEntreprisesData(VALID_SIREN, { timeoutMs: 50 })

    expect(result).toBeNull()
  })

  it('HTTP 500 : retourne null', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(makeJsonResponse({ error: 'boom' }, 500))

    const result = await fetchRechercheEntreprisesData(VALID_SIREN)

    expect(result).toBeNull()
  })

  it('JSON mal formé (parse impossible) : retourne null', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(makeBrokenJsonResponse(200))

    const result = await fetchRechercheEntreprisesData(VALID_SIREN)

    expect(result).toBeNull()
  })

  it('JSON valide mais sans champ results : retourne null (Zod safeparse fallback)', async () => {
    // Le schema tolère l'absence de `results` mais le résultat est null faute d'entreprise.
    vi.spyOn(global, 'fetch').mockResolvedValue(makeJsonResponse({ unrelated: true }))

    const result = await fetchRechercheEntreprisesData(VALID_SIREN)

    expect(result).toBeNull()
  })

  it('respecte le timeout custom passé en option', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(makeJsonResponse(FIXTURE_NOMINAL))

    await fetchRechercheEntreprisesData(VALID_SIREN, { timeoutMs: 1234 })

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url] = fetchSpy.mock.calls[0]
    expect(String(url)).toContain('q=552032534')
    expect(String(url)).toContain('per_page=1')
  })
})

// ------------------------------------------------------------
// sortDirigeants
// ------------------------------------------------------------

describe('sortDirigeants', () => {
  function mk(qualite: string, nom = 'X', type: 'physique' | 'morale' = 'physique'): Dirigeant {
    return { nom, prenoms: '', qualite, type }
  }

  it('président > DG > gérant > administrateur', () => {
    const input = [
      mk('Administrateur', 'A'),
      mk('Gérant', 'G'),
      mk('Directeur Général', 'D'),
      mk('Président', 'P'),
    ]

    const out = sortDirigeants(input)

    expect(out.map((d) => d.nom)).toEqual(['P', 'D', 'G', 'A'])
  })

  it('tolère les variantes sans accent (gerant, president)', () => {
    const input = [mk('gerant', 'G'), mk('president', 'P')]

    const out = sortDirigeants(input)

    expect(out.map((d) => d.nom)).toEqual(['P', 'G'])
  })

  it('place les personnes morales en fin de liste', () => {
    const input = [
      mk('Membre', 'M', 'morale'),
      mk('Administrateur', 'A'),
      mk('Président', 'P'),
    ]

    const out = sortDirigeants(input)

    expect(out.map((d) => d.nom)).toEqual(['P', 'A', 'M'])
  })

  it('préserve l\'ordre d\'origine pour les qualités équivalentes (stabilité)', () => {
    const input = [
      mk('Président', 'P1'),
      mk('Président du conseil', 'P2'),
      mk('Président directeur général', 'P3'),
    ]

    const out = sortDirigeants(input)

    expect(out.map((d) => d.nom)).toEqual(['P1', 'P2', 'P3'])
  })

  it('liste vide : retourne []', () => {
    expect(sortDirigeants([])).toEqual([])
  })
})
