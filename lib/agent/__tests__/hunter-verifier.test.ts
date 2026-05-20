// ============================================================
// TESTS — Hunter Email Verifier
// ------------------------------------------------------------
// Mock complet de fetch — aucun appel réseau réel.
// Couvre :
//   - Mapping des statuts canoniques (valid/accept_all/webmail/disposable/invalid/unknown)
//   - Score clamping 0-100
//   - HTTP 429 → HunterQuotaExhaustedError
//   - HTTP 401 → HunterAuthError
//   - Code 192 dans le body → HunterQuotaExhaustedError
//   - HTTP 400 générique → Error standard
//   - Payload malformé → Error
//   - apiKey manquante → HunterAuthError
// ============================================================

import { describe, expect, it, vi } from 'vitest'

import {
  HunterAuthError,
  HunterQuotaExhaustedError,
  normalizeVerifierResult,
  verifyEmail,
} from '@/lib/agent/hunter-verifier'

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ------------------------------------------------------------
// normalizeVerifierResult
// ------------------------------------------------------------

describe('normalizeVerifierResult', () => {
  it('mappe valid → valid', () => {
    expect(normalizeVerifierResult({ status: 'valid', score: 92 })).toEqual({
      status: 'valid',
      score: 92,
    })
  })

  it('mappe accept_all → accept_all (catchall Hunter)', () => {
    expect(normalizeVerifierResult({ status: 'accept_all', score: 70 })).toEqual({
      status: 'accept_all',
      score: 70,
    })
  })

  it('mappe webmail → webmail (gmail/yahoo)', () => {
    expect(normalizeVerifierResult({ status: 'webmail', score: 50 })).toEqual({
      status: 'webmail',
      score: 50,
    })
  })

  it('mappe disposable → disposable', () => {
    expect(normalizeVerifierResult({ status: 'disposable', score: 0 })).toEqual({
      status: 'disposable',
      score: 0,
    })
  })

  it('mappe invalid → invalid', () => {
    expect(normalizeVerifierResult({ status: 'invalid', score: 5 })).toEqual({
      status: 'invalid',
      score: 5,
    })
  })

  it('mappe un statut inconnu → unknown (defensive)', () => {
    expect(normalizeVerifierResult({ status: 'something_new', score: 30 })).toEqual({
      status: 'unknown',
      score: 30,
    })
  })

  it('clamp score < 0 à 0', () => {
    expect(normalizeVerifierResult({ status: 'invalid', score: -10 })).toEqual({
      status: 'invalid',
      score: 0,
    })
  })

  it('clamp score > 100 à 100', () => {
    expect(normalizeVerifierResult({ status: 'valid', score: 150 })).toEqual({
      status: 'valid',
      score: 100,
    })
  })

  it('score absent ou null → 0', () => {
    expect(normalizeVerifierResult({ status: 'unknown', score: null })).toEqual({
      status: 'unknown',
      score: 0,
    })
    expect(normalizeVerifierResult({ status: 'unknown' })).toEqual({
      status: 'unknown',
      score: 0,
    })
  })
})

// ------------------------------------------------------------
// verifyEmail — chemin nominal
// ------------------------------------------------------------

describe('verifyEmail — chemin nominal', () => {
  it('renvoie status + score depuis une réponse 200 Hunter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: {
          status: 'valid',
          score: 88,
          result: 'deliverable',
        },
      }),
    )
    const result = await verifyEmail('john@acme.com', {
      apiKey: 'fake-key',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    expect(result).toEqual({ status: 'valid', score: 88 })
    expect(fetchMock).toHaveBeenCalledOnce()
    const calledUrl = String((fetchMock.mock.calls[0] ?? [])[0] ?? '')
    expect(calledUrl).toContain('api.hunter.io/v2/email-verifier')
    expect(calledUrl).toContain('email=john%40acme.com')
    expect(calledUrl).toContain('api_key=fake-key')
  })

  it('mappe accept_all sur catchall détecté côté API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: { status: 'accept_all', score: 60 },
      }),
    )
    const result = await verifyEmail('contact@catchall-corp.fr', {
      apiKey: 'fake-key',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    expect(result.status).toBe('accept_all')
    expect(result.score).toBe(60)
  })
})

// ------------------------------------------------------------
// verifyEmail — erreurs
// ------------------------------------------------------------

describe('verifyEmail — erreurs', () => {
  it('jette HunterAuthError si apiKey manquante', async () => {
    // On force process.env propre — le test ne doit jamais réussir un fallback env.
    const original = process.env.HUNTER_API_KEY
    delete process.env.HUNTER_API_KEY
    await expect(verifyEmail('x@y.fr', { fetchImpl: vi.fn() as unknown as typeof fetch })).rejects.toBeInstanceOf(HunterAuthError)
    if (original !== undefined) process.env.HUNTER_API_KEY = original
  })

  it('jette HunterAuthError sur 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(401, { errors: [{ id: 'auth', details: 'invalid key' }] }),
    )
    await expect(
      verifyEmail('x@y.fr', {
        apiKey: 'bad',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(HunterAuthError)
  })

  it('jette HunterQuotaExhaustedError sur 429', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(429, { errors: [{ id: 'too_many', details: 'rate limited' }] }),
    )
    await expect(
      verifyEmail('x@y.fr', {
        apiKey: 'k',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(HunterQuotaExhaustedError)
  })

  it('jette HunterQuotaExhaustedError si code 192 dans le body (4xx)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(400, { errors: [{ id: 'too_many', code: 192, details: 'quota' }] }),
    )
    await expect(
      verifyEmail('x@y.fr', {
        apiKey: 'k',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(HunterQuotaExhaustedError)
  })

  it('jette Error standard sur 400 sans code 192', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(400, { errors: [{ id: 'invalid_email', details: 'bad format' }] }),
    )
    await expect(
      verifyEmail('x@y.fr', {
        apiKey: 'k',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 400/)
  })

  it('jette Error si payload mal formé (Zod fail)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { data: { /* status manquant */ score: 50 } }),
    )
    await expect(
      verifyEmail('x@y.fr', {
        apiKey: 'k',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/payload inattendu/)
  })
})
