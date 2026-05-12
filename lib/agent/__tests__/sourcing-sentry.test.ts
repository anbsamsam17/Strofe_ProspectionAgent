// ============================================================
// TESTS — Capture Sentry depuis sourcing.ts
//
// Vérifie que `captureWithContext` est invoqué AVANT le throw de
// `SireneApiError` sur les chemins d'erreur (4xx, 5xx, parse, fetch failed).
// Cf. observability bug A 2026-05-12 : "Erreur de syntaxe dans le paramètre q"
// passée inaperçue en prod faute d'alerting Sentry.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock du module d'observabilité AVANT import de sourcing.ts pour intercepter
// les appels à captureWithContext.
vi.mock('@/lib/observability/sentry-helpers', () => ({
  captureWithContext: vi.fn(),
}))

import { captureWithContext } from '@/lib/observability/sentry-helpers'
import { SireneApiError, sourcerEntreprises } from '../sourcing'

const mockedCapture = captureWithContext as unknown as ReturnType<typeof vi.fn>

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

const ORIGINAL_INSEE_API_KEY = process.env.INSEE_API_KEY

beforeEach(() => {
  process.env.INSEE_API_KEY = 'test-api-key'
  vi.clearAllMocks()
})

afterEach(() => {
  if (ORIGINAL_INSEE_API_KEY === undefined) {
    delete process.env.INSEE_API_KEY
  } else {
    process.env.INSEE_API_KEY = ORIGINAL_INSEE_API_KEY
  }
  vi.unstubAllGlobals()
})

describe('sourcerEntreprises — capture Sentry sur erreurs (observabilité)', () => {
  it('appelle captureWithContext sur HTTP 400 (bug "Erreur de syntaxe")', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({
        status: 400,
        ok: false,
        text: async () => 'Erreur de syntaxe dans le paramètre q',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      sourcerEntreprises({ curseur: '*', maxPages: 1 }),
    ).rejects.toBeInstanceOf(SireneApiError)

    expect(mockedCapture).toHaveBeenCalledTimes(1)
    const [errArg, ctxArg] = mockedCapture.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(errArg).toBeInstanceOf(SireneApiError)
    expect(ctxArg.pipeline_phase).toBe('sourcing')
    expect(ctxArg.api).toBe('sirene')
    expect(ctxArg.http_status).toBe(400)
    expect((ctxArg.extra as { body_preview: string }).body_preview).toContain(
      'Erreur de syntaxe',
    )
  })

  it('appelle captureWithContext sur HTTP 401 (clé INSEE invalide)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ status: 401, ok: false, text: async () => 'Unauthorized' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      sourcerEntreprises({ curseur: '*', maxPages: 1 }),
    ).rejects.toBeInstanceOf(SireneApiError)

    expect(mockedCapture).toHaveBeenCalledTimes(1)
    const [, ctxArg] = mockedCapture.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(ctxArg.http_status).toBe(401)
  })

  it('appelle captureWithContext sur HTTP 500 après retries', async () => {
    // fetchWithRetry retry sur 5xx — il faut 3 réponses 500 pour épuiser les retries
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({ status: 500, ok: false, text: async () => 'Internal Error' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      sourcerEntreprises({ curseur: '*', maxPages: 1 }),
    ).rejects.toBeInstanceOf(SireneApiError)

    expect(mockedCapture).toHaveBeenCalledTimes(1)
    const [, ctxArg] = mockedCapture.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(ctxArg.http_status).toBe(500)
    expect(ctxArg.pipeline_phase).toBe('sourcing')
    expect(ctxArg.api).toBe('sirene')
  }, 15_000)

  it('appelle captureWithContext sur erreur réseau (fetch rejected)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      sourcerEntreprises({ curseur: '*', maxPages: 1 }),
    ).rejects.toBeInstanceOf(SireneApiError)

    expect(mockedCapture).toHaveBeenCalledTimes(1)
    const [, ctxArg] = mockedCapture.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(ctxArg.pipeline_phase).toBe('sourcing')
    expect(ctxArg.api).toBe('sirene')
  }, 15_000)

  it("N'appelle PAS captureWithContext sur HTTP 404 (univers vide — pas une erreur)", async () => {
    // Avec NAF_PRIORITAIRES (41 codes) chunké à 20, on a 3 chunks. Chacun renvoie
    // 404 → univers réellement vide. `mockResolvedValue` (pas `Once`) couvre les
    // 3 appels sans que le 2e tombe sur `undefined` (qui déclencherait `fetch failed`).
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({ status: 404, ok: false }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await sourcerEntreprises({ curseur: '*', maxPages: 1 })
    expect(result.universeEmpty).toBe(true)
    expect(mockedCapture).not.toHaveBeenCalled()
  })
})
