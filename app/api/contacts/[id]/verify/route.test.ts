// ============================================================
// TESTS — /api/contacts/[id]/verify (POST)
// ------------------------------------------------------------
// Mock complet de Supabase SSR + email-verifier-dns (pas d'appel réel).
// Couvre :
//   - 401 sans session
//   - 400 id invalide
//   - 404 contact introuvable / pas owné
//   - 400 contact sans email
//   - 200 succès → persiste status + score + verified_at
//   - 500 DB error (update fail)
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const { mockVerifyEmailViaDns } = vi.hoisted(() => ({
  mockVerifyEmailViaDns: vi.fn(),
}))

vi.mock('@/lib/agent/email-verifier-dns', () => ({
  verifyEmailViaDns: mockVerifyEmailViaDns,
}))

// Imports APRÈS les vi.mock pour bénéficier du hoist.
import { POST } from './route'
import { NextRequest } from 'next/server'

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
  // Defaults : session OK, contact OK, update OK, verifier renvoie accept_all.
  mockGetUser.mockResolvedValue({ data: { user: { id: VALID_USER_ID } }, error: null })
  mockContactMaybeSingle.mockResolvedValue({
    data: { id: VALID_CONTACT_ID, email: 'marie@acme.fr', user_id: VALID_USER_ID },
    error: null,
  })
  mockUpdateMaybeSingle.mockResolvedValue({
    data: {
      id: VALID_CONTACT_ID,
      email_status: 'accept_all',
      email_confidence: 65,
      email_verified_at: '2026-05-22T10:00:00.000Z',
    },
    error: null,
  })
  mockVerifyEmailViaDns.mockResolvedValue({
    status: 'accept_all',
    score: 65,
    reason: 'mx_present',
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

// ------------------------------------------------------------
// TESTS
// ------------------------------------------------------------

describe('POST /api/contacts/[id]/verify', () => {
  it('renvoie 401 sans session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(401)
  })

  it('renvoie 400 si id non UUID', async () => {
    const badParams = Promise.resolve({ id: 'not-a-uuid' })
    const res = await POST(makeRequest(), { params: badParams })
    expect(res.status).toBe(400)
  })

  it('renvoie 404 si contact introuvable', async () => {
    mockContactMaybeSingle.mockResolvedValue({ data: null, error: null })
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(404)
  })

  it("renvoie 404 si contact appartient à un autre user (defense-in-depth)", async () => {
    mockContactMaybeSingle.mockResolvedValue({
      data: { id: VALID_CONTACT_ID, email: 'x@y.fr', user_id: 'other-user-id' },
      error: null,
    })
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(404)
  })

  it('renvoie 400 si contact sans email', async () => {
    mockContactMaybeSingle.mockResolvedValue({
      data: { id: VALID_CONTACT_ID, email: null, user_id: VALID_USER_ID },
      error: null,
    })
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(400)
  })

  it("renvoie 200 + persiste status + score + verified_at en succès", async () => {
    mockVerifyEmailViaDns.mockResolvedValue({
      status: 'accept_all',
      score: 65,
      reason: 'mx_present',
    })
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.email_status).toBe('accept_all')
    expect(json.data.email_score).toBe(65)
    expect(json.data.email_verified_at).toBeTruthy()
    expect(mockVerifyEmailViaDns).toHaveBeenCalledWith('marie@acme.fr')
  })

  it("propage le status 'webmail' quand le domaine est gmail/etc", async () => {
    mockContactMaybeSingle.mockResolvedValue({
      data: { id: VALID_CONTACT_ID, email: 'marie@gmail.com', user_id: VALID_USER_ID },
      error: null,
    })
    mockVerifyEmailViaDns.mockResolvedValue({
      status: 'webmail',
      score: 30,
      reason: 'domain_webmail',
    })
    mockUpdateMaybeSingle.mockResolvedValue({
      data: {
        id: VALID_CONTACT_ID,
        email_status: 'webmail',
        email_confidence: 30,
        email_verified_at: '2026-05-22T10:00:00.000Z',
      },
      error: null,
    })
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.email_status).toBe('webmail')
  })

  it("propage le status 'invalid' quand le domaine n'a pas de MX", async () => {
    mockVerifyEmailViaDns.mockResolvedValue({
      status: 'invalid',
      score: 0,
      reason: 'mx_absent',
    })
    mockUpdateMaybeSingle.mockResolvedValue({
      data: {
        id: VALID_CONTACT_ID,
        email_status: 'invalid',
        email_confidence: 0,
        email_verified_at: '2026-05-22T10:00:00.000Z',
      },
      error: null,
    })
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.email_status).toBe('invalid')
  })

  it('renvoie 500 si update DB échoue', async () => {
    mockUpdateMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'DB connection lost' },
    })
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(500)
  })
})
