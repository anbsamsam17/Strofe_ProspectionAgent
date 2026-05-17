// ============================================================
// TESTS — lib/observability/sirene-health.ts
//
// Couvre :
//   - trackSireneFailure : breadcrumb à chaque KO, pas d'alerte avant le seuil
//   - trackSireneFailure : alerte Sentry au seuil avec tags corrects
//   - trackSireneFailure : alerte rejouée au-delà du seuil (pas de bloquage)
//   - trackSireneSuccess : reset compteur + breadcrumb recovery si N > 0
//   - getSireneHealthStats : valeurs cohérentes (compteur + flag dégradation)
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock du SDK Sentry AVANT import du module testé (sinon addBreadcrumb /
// captureException sont déjà bound à la vraie impl. au moment de l'évaluation).
vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}))

import { addBreadcrumb, captureException } from '@sentry/nextjs'
import {
  _resetSireneHealthForTests,
  getSireneHealthStats,
  trackSireneFailure,
  trackSireneSuccess,
  type SireneFailureContext,
} from '../sirene-health'

const mockedAddBreadcrumb = addBreadcrumb as unknown as ReturnType<typeof vi.fn>
const mockedCaptureException = captureException as unknown as ReturnType<typeof vi.fn>

const SAMPLE_CTX: SireneFailureContext = {
  status: 503,
  body: 'Service Unavailable',
  page: 2,
  chunk_index: 0,
  curseur: '*',
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetSireneHealthForTests()
  // Silence le console.warn structuré pour ne pas polluer la sortie de test.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ------------------------------------------------------------
// trackSireneFailure — comportement avant le seuil
// ------------------------------------------------------------

describe('trackSireneFailure — avant le seuil', () => {
  it('pose un breadcrumb sur le 1er échec mais ne déclenche pas captureException', () => {
    trackSireneFailure(SAMPLE_CTX)

    expect(mockedAddBreadcrumb).toHaveBeenCalledTimes(1)
    expect(mockedAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'sirene',
        message: 'KO',
        level: 'warning',
        data: expect.objectContaining({
          status: 503,
          page: 2,
          chunk_index: 0,
          curseur: '*',
          consecutive_failures: 1,
        }),
      }),
    )
    expect(mockedCaptureException).not.toHaveBeenCalled()
  })

  it('ne déclenche pas d\'alerte à 2 échecs consécutifs', () => {
    trackSireneFailure(SAMPLE_CTX)
    trackSireneFailure(SAMPLE_CTX)

    expect(mockedAddBreadcrumb).toHaveBeenCalledTimes(2)
    expect(mockedCaptureException).not.toHaveBeenCalled()
    expect(getSireneHealthStats().is_degraded).toBe(false)
  })
})

// ------------------------------------------------------------
// trackSireneFailure — au seuil
// ------------------------------------------------------------

describe('trackSireneFailure — au seuil (3 KO)', () => {
  it('déclenche captureException avec tags sirene.degraded et consecutive_failures', () => {
    trackSireneFailure(SAMPLE_CTX)
    trackSireneFailure(SAMPLE_CTX)
    trackSireneFailure(SAMPLE_CTX)

    expect(mockedCaptureException).toHaveBeenCalledTimes(1)
    const [err, hint] = mockedCaptureException.mock.calls[0] as [
      Error,
      { tags: Record<string, string>; extra: Record<string, unknown> },
    ]
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('Sirene degradation critical')
    expect(hint.tags).toEqual({
      'sirene.degraded': 'true',
      'sirene.consecutive_failures': '3',
    })
    expect(hint.extra).toEqual(
      expect.objectContaining({
        status: 503,
        page: 2,
        chunk_index: 0,
        curseur: '*',
        consecutive_failures: 3,
      }),
    )
  })

  it('émet un log warn JSON structuré "CRITICAL DEGRADATION" au seuil', () => {
    const warnSpy = vi.spyOn(console, 'warn')
    trackSireneFailure(SAMPLE_CTX)
    trackSireneFailure(SAMPLE_CTX)
    trackSireneFailure(SAMPLE_CTX)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(warnSpy.mock.calls[0]?.[0] as string)
    expect(payload).toEqual({
      level: 'warn',
      module: 'sirene-health',
      msg: 'CRITICAL DEGRADATION',
      consecutive_failures: 3,
    })
  })
})

// ------------------------------------------------------------
// trackSireneFailure — au-delà du seuil
// ------------------------------------------------------------

describe('trackSireneFailure — au-delà du seuil', () => {
  it('rejoue captureException sur la 4e et 5e occurrence (pas de doublon explosif, mais visibilité maintenue)', () => {
    for (let i = 0; i < 5; i++) trackSireneFailure(SAMPLE_CTX)

    // 3e, 4e, 5e → captureException × 3 (les 2 premières ne déclenchent pas).
    expect(mockedCaptureException).toHaveBeenCalledTimes(3)

    // Le tag consecutive_failures suit la progression.
    const calls = mockedCaptureException.mock.calls as Array<
      [Error, { tags: Record<string, string> }]
    >
    expect(calls[0]?.[1].tags['sirene.consecutive_failures']).toBe('3')
    expect(calls[1]?.[1].tags['sirene.consecutive_failures']).toBe('4')
    expect(calls[2]?.[1].tags['sirene.consecutive_failures']).toBe('5')
  })
})

// ------------------------------------------------------------
// trackSireneSuccess — reset + recovery breadcrumb
// ------------------------------------------------------------

describe('trackSireneSuccess', () => {
  it('reset le compteur à 0 et pose un breadcrumb recovery si N > 0', () => {
    trackSireneFailure(SAMPLE_CTX)
    trackSireneFailure(SAMPLE_CTX)
    trackSireneFailure(SAMPLE_CTX)
    expect(getSireneHealthStats().consecutive_failures).toBe(3)

    mockedAddBreadcrumb.mockClear()
    trackSireneSuccess()

    expect(getSireneHealthStats().consecutive_failures).toBe(0)
    expect(getSireneHealthStats().is_degraded).toBe(false)
    expect(mockedAddBreadcrumb).toHaveBeenCalledTimes(1)
    expect(mockedAddBreadcrumb).toHaveBeenCalledWith({
      category: 'sirene',
      message: 'OK after 3 failures',
      level: 'info',
    })
  })

  it('ne pose pas de breadcrumb recovery si aucun échec préalable (N = 0)', () => {
    trackSireneSuccess()

    expect(getSireneHealthStats().consecutive_failures).toBe(0)
    expect(mockedAddBreadcrumb).not.toHaveBeenCalled()
  })

  it('permet une nouvelle alerte après reset par un succès (cycle KO/OK/KO)', () => {
    // Première vague d'échecs jusqu'au seuil.
    for (let i = 0; i < 3; i++) trackSireneFailure(SAMPLE_CTX)
    expect(mockedCaptureException).toHaveBeenCalledTimes(1)

    // Récupération.
    trackSireneSuccess()
    expect(getSireneHealthStats().consecutive_failures).toBe(0)

    // Nouvelle vague — pas d'alerte avant le seuil.
    trackSireneFailure(SAMPLE_CTX)
    trackSireneFailure(SAMPLE_CTX)
    expect(mockedCaptureException).toHaveBeenCalledTimes(1)

    // Re-déclenche à 3.
    trackSireneFailure(SAMPLE_CTX)
    expect(mockedCaptureException).toHaveBeenCalledTimes(2)
  })
})

// ------------------------------------------------------------
// getSireneHealthStats
// ------------------------------------------------------------

describe('getSireneHealthStats', () => {
  it('retourne consecutive_failures=0, threshold=3, is_degraded=false à l\'état initial', () => {
    expect(getSireneHealthStats()).toEqual({
      consecutive_failures: 0,
      threshold: 3,
      is_degraded: false,
    })
  })

  it('passe is_degraded à true exactement au seuil', () => {
    trackSireneFailure(SAMPLE_CTX)
    expect(getSireneHealthStats().is_degraded).toBe(false)
    trackSireneFailure(SAMPLE_CTX)
    expect(getSireneHealthStats().is_degraded).toBe(false)
    trackSireneFailure(SAMPLE_CTX)
    expect(getSireneHealthStats()).toEqual({
      consecutive_failures: 3,
      threshold: 3,
      is_degraded: true,
    })
  })
})
