// ============================================================
// TESTS — /api/contacts/[id]/verify (POST)
// ------------------------------------------------------------
// Mock complet de Supabase SSR + hunter-verifier + quotas (pas d'appel réel).
// Couvre :
//   - 401 sans session
//   - 400 id invalide
//   - 404 contact introuvable
//   - 400 contact sans email
//   - 429 quota Hunter (consumeQuota refuse)
//   - 429 quota Hunter (HunterQuotaExhaustedError côté provider)
//   - 502 Hunter auth error
//   - 200 succès → persiste status + score + verified_at
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// ------------------------------------------------------------
// MOCKS — hoist avant import de la route
// ------------------------------------------------------------

const { mockGetUser, mockContactMaybeSingle, mockUpdateMaybeSingle } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockContactMaybeSingle: vi.fn(),
  mockUpdateMaybeSingle: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: mockContactMaybeSingle,
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            maybeSingle: mockUpdateMaybeSingle,
          })),
        })),
      })),
    })),
  })),
}))

// Hoisted helpers — accessibles depuis les vi.mock factories (qui sont hoist
// par Vitest, comme jest). On NE peut PAS référencer des vi.fn() au top sans ça.
const { mockVerifyEmail, mockConsumeQuota, mockRefundQuota } = vi.hoisted(() => ({
  mockVerifyEmail: vi.fn(),
  mockConsumeQuota: vi.fn(),
  mockRefundQuota: vi.fn(),
}))

vi.mock('@/lib/agent/hunter-verifier', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent/hunter-verifier')>(
    '@/lib/agent/hunter-verifier',
  )
  return {
    ...actual,
    verifyEmail: mockVerifyEmail,
  }
})

vi.mock('@/lib/agent/quotas', () => ({
  consumeQuota: mockConsumeQuota,
  refundQuota: mockRefundQuota,
}))

// Imports APRÈS les vi.mock pour bénéficier du hoist.
import { POST } from './route'
import { NextRequest } from 'next/server'
import {
  HunterAuthError,
  HunterQuotaExhaustedError,
} from '@/lib/agent/hunter-verifier'

// ------------------------------------------------------------
// FIXTURES
// ------------------------------------------------------------

const VALID_USER_ID = '11111111-1111-1111-1111-111111111111'
const VALID_CONTACT_ID = '22222222-2222-4222-a222-222222222222'

function makeRequest(): NextRequest {
  return new NextRequest(
    'http://localhost/api/contacts/' + VALID_CONTACT_ID + '/verify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  )
}

const params = Promise.resolve({ id: VALID_CONTACT_ID })

// ------------------------------------------------------------
// SETUP / TEARDOWN
// ------------------------------------------------------------

beforeEach(() => {
  mockGetUser.mockResolvedValue({
    data: { user: { id: VALID_USER_ID } },
    error: null,
  })
  mockContactMaybeSingle.mockReset()
  mockUpdateMaybeSingle.mockReset()
  mockVerifyEmail.mockReset()
  mockConsumeQuota.mockResolvedValue({ ok: true, remaining: 24 })
  mockRefundQuota.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

// ------------------------------------------------------------
// TESTS
// ------------------------------------------------------------

describe('POST /api/contacts/[id]/verify — auth', () => {
  it('retourne 401 sans session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('UNAUTHENTICATED')
  })
})

describe('POST /api/contacts/[id]/verify — validation', () => {
  it('retourne 400 si id non UUID', async () => {
    const badParams = Promise.resolve({ id: 'pas-un-uuid' })
    const res = await POST(makeRequest(), { params: badParams })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })

  it('retourne 404 si contact introuvable', async () => {
    mockContactMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('NOT_FOUND')
  })

  it('retourne 400 si contact sans email', async () => {
    mockContactMaybeSingle.mockResolvedValueOnce({
      data: { id: VALID_CONTACT_ID, email: null, user_id: VALID_USER_ID },
      error: null,
    })
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })
})

describe('POST /api/contacts/[id]/verify — quota', () => {
  it('retourne 429 si consumeQuota refuse (quota local épuisé)', async () => {
    mockContactMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_CONTACT_ID,
        email: 'john@acme.com',
        user_id: VALID_USER_ID,
      },
      error: null,
    })
    mockConsumeQuota.mockResolvedValueOnce({ ok: false, remaining: 0 })

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('RATE_LIMITED')
    expect(mockVerifyEmail).not.toHaveBeenCalled()
  })

  it('retourne 429 + refund si HunterQuotaExhaustedError côté Hunter', async () => {
    mockContactMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_CONTACT_ID,
        email: 'john@acme.com',
        user_id: VALID_USER_ID,
      },
      error: null,
    })
    mockVerifyEmail.mockRejectedValueOnce(new HunterQuotaExhaustedError())

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(429)
    expect(mockRefundQuota).toHaveBeenCalledOnce()
  })
})

describe('POST /api/contacts/[id]/verify — erreurs Hunter', () => {
  it('retourne 502 + refund sur HunterAuthError', async () => {
    mockContactMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_CONTACT_ID,
        email: 'john@acme.com',
        user_id: VALID_USER_ID,
      },
      error: null,
    })
    mockVerifyEmail.mockRejectedValueOnce(new HunterAuthError())

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('EXTERNAL_API_ERROR')
    expect(mockRefundQuota).toHaveBeenCalledOnce()
  })

  it('retourne 502 + refund sur erreur réseau générique', async () => {
    mockContactMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_CONTACT_ID,
        email: 'john@acme.com',
        user_id: VALID_USER_ID,
      },
      error: null,
    })
    mockVerifyEmail.mockRejectedValueOnce(new Error('ECONNRESET'))

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(502)
    expect(mockRefundQuota).toHaveBeenCalledOnce()
  })
})

describe('POST /api/contacts/[id]/verify — succès', () => {
  it('persiste status + score + verified_at et renvoie 200', async () => {
    mockContactMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_CONTACT_ID,
        email: 'john@acme.com',
        user_id: VALID_USER_ID,
      },
      error: null,
    })
    mockVerifyEmail.mockResolvedValueOnce({ status: 'valid', score: 92 })
    mockUpdateMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_CONTACT_ID,
        email_status: 'valid',
        email_confidence: 92,
        email_verified_at: '2026-05-20T10:00:00Z',
      },
      error: null,
    })

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data?: {
        email_status?: string
        email_score?: number
        email_verified_at?: string
      }
    }
    expect(body.data?.email_status).toBe('valid')
    expect(body.data?.email_score).toBe(92)
    expect(body.data?.email_verified_at).toBeTruthy()
    expect(mockRefundQuota).not.toHaveBeenCalled()
  })

  it('passe l\'email exact à verifyEmail', async () => {
    mockContactMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_CONTACT_ID,
        email: 'pierre.martin@acme.fr',
        user_id: VALID_USER_ID,
      },
      error: null,
    })
    mockVerifyEmail.mockResolvedValueOnce({ status: 'accept_all', score: 65 })
    mockUpdateMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_CONTACT_ID,
        email_status: 'accept_all',
        email_confidence: 65,
        email_verified_at: '2026-05-20T10:00:00Z',
      },
      error: null,
    })

    await POST(makeRequest(), { params })
    expect(mockVerifyEmail).toHaveBeenCalledWith('pierre.martin@acme.fr')
  })

  it('refuse l\'accès à un contact d\'un autre user (defense-in-depth)', async () => {
    mockContactMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_CONTACT_ID,
        email: 'x@y.fr',
        user_id: 'autre-user-id',
      },
      error: null,
    })
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(404)
    expect(mockConsumeQuota).not.toHaveBeenCalled()
    expect(mockVerifyEmail).not.toHaveBeenCalled()
  })
})

// Évite l'unused import warning sur Mock — utilisé pour les types implicites.
type _UnusedMockType = Mock
