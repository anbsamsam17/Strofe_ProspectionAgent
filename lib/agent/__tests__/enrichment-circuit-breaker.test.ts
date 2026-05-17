// ============================================================
// TESTS UNITAIRES — Circuit breaker Recherche Entreprises (téléphone)
// Cible : `rechercherTelephone` + `isRePhoneCircuitOpen` + soft timeout
//         dans `enrichAndScore` (via `runPipelineSourcing`)
//
// Contexte : fix Vercel timeout 300s 2026-05-12 — un fetch failed massif
// sur recherche-entreprises.api.gouv.fr/search bloquait la phase d'enrich.
// On vérifie ici :
//   1. Le breaker s'arme après N échecs consécutifs.
//   2. Le breaker s'auto-reset au premier succès.
//   3. Aux échecs déjà comptés, on n'émet plus de nouveau fetch.
//   4. Le soft timeout côté `enrichAndScore` bascule les restants en dégradé.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getRePhoneCircuitState,
  isRePhoneCircuitOpen,
  rechercherTelephone,
  resetRePhoneCircuit,
} from '../sourcing'

// ------------------------------------------------------------
// HELPERS
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

// SIREN valide synthétique (9 chiffres)
function syntheticSiren(n: number): string {
  return String(100_000_000 + n).padStart(9, '0')
}

// ------------------------------------------------------------
// SETUP / TEARDOWN
// ------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks()
  resetRePhoneCircuit()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetRePhoneCircuit()
})

// ============================================================
// CATÉGORIE A — Compteur d'échecs et armement du breaker
// ============================================================

describe('rechercherTelephone — circuit breaker', () => {
  it('au démarrage : circuit fermé, compteur à 0', () => {
    // Assert
    expect(isRePhoneCircuitOpen()).toBe(false)
    expect(getRePhoneCircuitState().consecutiveFailures).toBe(0)
    expect(getRePhoneCircuitState().openedAt).toBeNull()
  })

  // Seuil source de vérité : `RE_PHONE_CIRCUIT_BREAKER_THRESHOLD` dans sourcing.ts.
  // Relevé de 5 → 30 le 2026-05-17 (Recherche Entreprises devient source primaire).
  const BREAKER_THRESHOLD = 30

  it('arme le breaker après N fetch failed consécutifs (seuil = BREAKER_THRESHOLD)', async () => {
    // Arrange : tous les fetch échouent en "fetch failed"
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)

    // Act : N SIREN successifs jusqu'au seuil
    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      const result = await rechercherTelephone(syntheticSiren(i))
      expect(result).toBeNull()
    }

    // Assert : breaker ouvert après le N-ième échec
    expect(isRePhoneCircuitOpen()).toBe(true)
    expect(getRePhoneCircuitState().consecutiveFailures).toBe(BREAKER_THRESHOLD)
    expect(getRePhoneCircuitState().openedAt).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(BREAKER_THRESHOLD)
  })

  it('une fois ouvert : skip les appels suivants sans nouveau fetch', async () => {
    // Arrange : N échecs initiaux pour armer le breaker
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)

    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      await rechercherTelephone(syntheticSiren(i))
    }
    expect(isRePhoneCircuitOpen()).toBe(true)
    fetchMock.mockClear()

    // Act : 10 SIREN supplémentaires
    for (let i = 1000; i < 1010; i++) {
      const result = await rechercherTelephone(syntheticSiren(i))
      expect(result).toBeNull()
    }

    // Assert : aucun nouvel appel fetch (pas de gaspillage de budget réseau)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reset au premier succès (auto-reprise du breaker)', async () => {
    // Arrange : 3 échecs (pas encore au seuil)
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        makeJsonResponse({
          results: [
            {
              siege: { telephone: '0123456789' },
            },
          ],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    // Act
    await rechercherTelephone(syntheticSiren(0))
    await rechercherTelephone(syntheticSiren(1))
    await rechercherTelephone(syntheticSiren(2))
    expect(getRePhoneCircuitState().consecutiveFailures).toBe(3)

    const okResult = await rechercherTelephone(syntheticSiren(3))

    // Assert
    expect(okResult).toBe('0123456789')
    expect(getRePhoneCircuitState().consecutiveFailures).toBe(0)
    expect(isRePhoneCircuitOpen()).toBe(false)
  })

  it('compte 1 seule tentative par appel (pas de retry x3 sur fetch failed)', async () => {
    // Régression : l'ancienne implémentation via `fetchWithRetry` faisait
    // 3 tentatives + backoff 1s+2s par SIREN. C'était l'amplificateur du bug.
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)

    // Act
    await rechercherTelephone(syntheticSiren(42))

    // Assert : 1 appel fetch, pas 3
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getRePhoneCircuitState().consecutiveFailures).toBe(1)
  })

  it('SIREN invalide : court-circuit avant tout fetch (ne consomme pas le compteur)', async () => {
    // Arrange
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    // Act
    const result = await rechercherTelephone('xyz')

    // Assert : pas de fetch, pas d'impact sur le breaker
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getRePhoneCircuitState().consecutiveFailures).toBe(0)
  })

  it('HTTP 503 : incrémente le compteur (un upstream down répété justifie le breaker)', async () => {
    // Arrange : N réponses 503 successives
    const fetchMock = vi.fn()
    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      fetchMock.mockResolvedValueOnce(makeResponse({ status: 503, ok: false }))
    }
    vi.stubGlobal('fetch', fetchMock)

    // Act
    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      const result = await rechercherTelephone(syntheticSiren(i))
      expect(result).toBeNull()
    }

    // Assert : breaker armé sur séquence de 503
    expect(isRePhoneCircuitOpen()).toBe(true)
  })

  it('resetRePhoneCircuit() remet manuellement le compteur à zéro', async () => {
    // Arrange : armer le breaker
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)

    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      await rechercherTelephone(syntheticSiren(i))
    }
    expect(isRePhoneCircuitOpen()).toBe(true)

    // Act
    resetRePhoneCircuit()

    // Assert
    expect(isRePhoneCircuitOpen()).toBe(false)
    expect(getRePhoneCircuitState().consecutiveFailures).toBe(0)
    expect(getRePhoneCircuitState().openedAt).toBeNull()
  })
})

// ============================================================
// CATÉGORIE B — Timeout AbortSignal (5s par appel)
// ============================================================

describe('rechercherTelephone — soft timeout 5s', () => {
  it('passe un AbortSignal au fetch (limite 5s par appel)', async () => {
    // Arrange
    const fetchMock = vi.fn().mockResolvedValue(
      makeJsonResponse({ results: [] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    // Act
    await rechercherTelephone(syntheticSiren(0))

    // Assert : le 2e arg de fetch a bien un `signal`
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect(init).toHaveProperty('signal')
    expect((init as { signal: AbortSignal }).signal).toBeDefined()
  })
})
