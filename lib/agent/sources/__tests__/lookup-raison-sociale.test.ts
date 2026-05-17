// ============================================================
// TESTS — lib/agent/sources/lookup-raison-sociale.ts
//
// Mock systématique de fetchRechercheEntreprisesData.
// Fake timers pour vérifier le throttle entre groupes.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock du module AVANT l'import de la fonction testée.
vi.mock('../recherche-entreprises-dirigeants', () => ({
  fetchRechercheEntreprisesData: vi.fn(),
}))

import { fetchRaisonSocialesBatch } from '../lookup-raison-sociale'
import { fetchRechercheEntreprisesData } from '../recherche-entreprises-dirigeants'

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

const mockFetch = fetchRechercheEntreprisesData as ReturnType<typeof vi.fn>

function makeResult(siren: string, raisonSociale: string) {
  return {
    siren,
    raisonSociale,
    dirigeants: [],
    dirigeantPrincipal: null,
    siege: { adresse: null, codePostal: null, commune: null, telephone: null, email: null, siteWeb: null },
  }
}

const SIREN_RESOLU = '552032534'
const SIREN_NULL = '999999999'
const SIREN_THROW = '111111111'

// ------------------------------------------------------------
// SETUP
// ------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// ------------------------------------------------------------
// TESTS
// ------------------------------------------------------------

describe('fetchRaisonSocialesBatch', () => {
  it('liste vide : retourne Map vide sans appeler fetchRechercheEntreprisesData', async () => {
    const result = await fetchRaisonSocialesBatch([])

    expect(result.size).toBe(0)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('cas nominal : Map contient uniquement le SIREN résolu', async () => {
    mockFetch.mockImplementation(async (siren: string) => {
      if (siren === SIREN_RESOLU) return makeResult(siren, 'ACME INDUSTRIES')
      if (siren === SIREN_NULL) return null
      if (siren === SIREN_THROW) throw new Error('réseau KO')
      return null
    })

    // On désactive le throttle pour éviter l'attente en test.
    const resultPromise = fetchRaisonSocialesBatch(
      [SIREN_RESOLU, SIREN_NULL, SIREN_THROW],
      { parallelism: 3, throttleMs: 0 },
    )

    // Advance timers pour résoudre le throttle (même si 0ms, pour la cohérence).
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result.size).toBe(1)
    expect(result.get(SIREN_RESOLU)).toBe('ACME INDUSTRIES')
    expect(result.has(SIREN_NULL)).toBe(false)
    expect(result.has(SIREN_THROW)).toBe(false)
  })

  it('un appel qui throw est isolé : ne casse pas le groupe, les autres SIREN sont traités', async () => {
    const SIREN_B = '234567890'
    mockFetch.mockImplementation(async (siren: string) => {
      if (siren === SIREN_THROW) throw new Error('timeout simulé')
      return makeResult(siren, `Entreprise ${siren}`)
    })

    const resultPromise = fetchRaisonSocialesBatch(
      [SIREN_THROW, SIREN_B],
      { parallelism: 2, throttleMs: 0 },
    )
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result.has(SIREN_THROW)).toBe(false)
    expect(result.get(SIREN_B)).toBe(`Entreprise ${SIREN_B}`)
  })

  it('throttle entre groupes : setTimeout appelé entre les groupes, pas après le dernier', async () => {
    // 3 SIREN avec parallelism=1 → 3 groupes d'1. Throttle entre groupe 1→2 et 2→3, pas après 3.
    const sirens = ['111222333', '444555666', '777888999']
    mockFetch.mockResolvedValue(null)

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

    const resultPromise = fetchRaisonSocialesBatch(sirens, {
      parallelism: 1,
      throttleMs: 500,
    })

    await vi.runAllTimersAsync()
    await resultPromise

    // setTimeout est appelé exactement 2 fois (entre groupe 0→1 et 1→2,
    // pas après le dernier groupe 2).
    const throttleCalls = setTimeoutSpy.mock.calls.filter(([, ms]) => ms === 500)
    expect(throttleCalls.length).toBe(2)
  })

  it('AbortSignal déjà aborté : sort avant de traiter le premier groupe', async () => {
    mockFetch.mockResolvedValue(makeResult(SIREN_RESOLU, 'ACME INDUSTRIES'))

    const controller = new AbortController()
    controller.abort()

    const result = await fetchRaisonSocialesBatch([SIREN_RESOLU], {
      parallelism: 7,
      throttleMs: 0,
      signal: controller.signal,
    })

    // Aucun appel réseau ne doit avoir été effectué.
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.size).toBe(0)
  })

  it('AbortSignal déclenché entre 2 groupes : les groupes suivants sont skippés', async () => {
    const controller = new AbortController()
    const SIREN_G1 = '100000001'
    const SIREN_G2 = '200000002'

    // Premier groupe résout normalement, puis on abort avant le throttle.
    let callCount = 0
    mockFetch.mockImplementation(async (siren: string) => {
      callCount++
      if (siren === SIREN_G1) {
        // Abort pendant le traitement du groupe 1 pour que le groupe 2 soit skip.
        controller.abort()
        return makeResult(siren, 'Groupe Un')
      }
      return makeResult(siren, 'Groupe Deux')
    })

    const resultPromise = fetchRaisonSocialesBatch(
      [SIREN_G1, SIREN_G2],
      { parallelism: 1, throttleMs: 100, signal: controller.signal },
    )
    await vi.runAllTimersAsync()
    const result = await resultPromise

    // Groupe 1 traité, groupe 2 skippé.
    expect(result.get(SIREN_G1)).toBe('Groupe Un')
    expect(result.has(SIREN_G2)).toBe(false)
    expect(callCount).toBe(1)
  })

  it('raisonSociale avec espaces superflus est trimmée', async () => {
    mockFetch.mockResolvedValue(makeResult(SIREN_RESOLU, '  ACME INDUSTRIES  '))

    const resultPromise = fetchRaisonSocialesBatch([SIREN_RESOLU], { throttleMs: 0 })
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result.get(SIREN_RESOLU)).toBe('ACME INDUSTRIES')
  })

  it('raisonSociale vide ou whitespace uniquement : SIREN exclu de la Map', async () => {
    mockFetch.mockResolvedValue(makeResult(SIREN_RESOLU, '   '))

    const resultPromise = fetchRaisonSocialesBatch([SIREN_RESOLU], { throttleMs: 0 })
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result.has(SIREN_RESOLU)).toBe(false)
  })
})
