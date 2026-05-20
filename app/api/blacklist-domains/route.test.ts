// ============================================================
// TESTS — GET/POST /api/blacklist-domains (GLN-061)
// ------------------------------------------------------------
// Couvre :
//   - 401 si pas authentifié.
//   - 400 INVALID_JSON / INVALID_INPUT / INVALID_DOMAIN.
//   - 200 GET avec liste vide / liste peuplée.
//   - 201 POST avec normalisation domaine (lowercase, sans @).
//   - 409 DUPLICATE_DOMAIN si unique violation (code 23505).
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockInsert = vi.fn()

let listData: Array<{ id: string; domain: string; reason: string | null; created_at: string }> = []
let listError: { message: string } | null = null
let insertResult: {
  data: { id: string; domain: string; reason: string | null; created_at: string } | null
  error: { message: string; code?: string } | null
} = { data: null, error: null }

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn((_table: string) => ({
      select: vi.fn(() => ({
        order: vi.fn(() => Promise.resolve({ data: listData, error: listError })),
      })),
      insert: vi.fn((row: unknown) => {
        mockInsert(row)
        return {
          select: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve(insertResult)),
          })),
        }
      }),
    })),
  })),
}))

import { GET, POST } from './route'
import { NextRequest } from 'next/server'

const VALID_USER_ID = '11111111-1111-1111-1111-111111111111'

function makePostReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/blacklist-domains', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  mockGetUser.mockResolvedValue({
    data: { user: { id: VALID_USER_ID } },
    error: null,
  })
  mockInsert.mockClear()
  listData = []
  listError = null
  insertResult = { data: null, error: null }
})

afterEach(() => {
  vi.clearAllMocks()
})

// ── GET ──────────────────────────────────────────────────────────────────────

describe('GET /api/blacklist-domains', () => {
  it('renvoie 401 si pas de session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await GET()
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('renvoie 200 + tableau vide quand aucune entrée', async () => {
    listData = []
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual([])
  })

  it('renvoie 200 + entrées triées', async () => {
    listData = [
      {
        id: 'aaa',
        domain: 'greenly.earth',
        reason: 'Concurrent',
        created_at: '2026-05-19T10:00:00Z',
      },
      {
        id: 'bbb',
        domain: 'sweep.net',
        reason: null,
        created_at: '2026-05-18T10:00:00Z',
      },
    ]
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(2)
    expect(body.data[0].domain).toBe('greenly.earth')
  })

  it('renvoie 500 DB_ERROR si Supabase renvoie une erreur', async () => {
    listError = { message: 'pg connection lost' }
    const res = await GET()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.code).toBe('DB_ERROR')
  })
})

// ── POST ─────────────────────────────────────────────────────────────────────

describe('POST /api/blacklist-domains', () => {
  it('renvoie 401 si pas de session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await POST(makePostReq({ domain: 'greenly.earth' }))
    expect(res.status).toBe(401)
  })

  it('renvoie 400 INVALID_JSON si body non JSON', async () => {
    const req = new NextRequest('http://localhost/api/blacklist-domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'pas-du-json{',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_JSON')
  })

  it('renvoie 400 INVALID_INPUT si domain manquant', async () => {
    const res = await POST(makePostReq({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('renvoie 400 INVALID_DOMAIN si domaine invalide (sans TLD)', async () => {
    const res = await POST(makePostReq({ domain: 'pas-un-domaine' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_DOMAIN')
  })

  it('renvoie 400 INVALID_DOMAIN si TLD trop court', async () => {
    const res = await POST(makePostReq({ domain: 'foo.x' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_DOMAIN')
  })

  it('normalise un domaine en minuscules + retire @ initial', async () => {
    insertResult = {
      data: {
        id: 'newid',
        domain: 'greenly.earth',
        reason: null,
        created_at: '2026-05-20T12:00:00Z',
      },
      error: null,
    }
    const res = await POST(makePostReq({ domain: '@Greenly.Earth' }))
    expect(res.status).toBe(201)
    expect(mockInsert).toHaveBeenCalled()
    const inserted = mockInsert.mock.calls[0][0] as { domain: string; user_id: string }
    expect(inserted.domain).toBe('greenly.earth')
    expect(inserted.user_id).toBe(VALID_USER_ID)
  })

  it('persiste la raison quand fournie', async () => {
    insertResult = {
      data: {
        id: 'x',
        domain: 'sweep.net',
        reason: 'Concurrent direct',
        created_at: '2026-05-20T12:00:00Z',
      },
      error: null,
    }
    await POST(makePostReq({ domain: 'sweep.net', reason: 'Concurrent direct' }))
    expect(mockInsert).toHaveBeenCalled()
    const inserted = mockInsert.mock.calls[0][0] as { reason: string | null }
    expect(inserted.reason).toBe('Concurrent direct')
  })

  it('renvoie 409 DUPLICATE_DOMAIN si unique violation', async () => {
    insertResult = {
      data: null,
      error: { message: 'duplicate key value', code: '23505' },
    }
    const res = await POST(makePostReq({ domain: 'greenly.earth' }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('DUPLICATE_DOMAIN')
  })

  it('renvoie 500 DB_ERROR pour les autres erreurs DB', async () => {
    insertResult = {
      data: null,
      error: { message: 'pg connection lost', code: '08000' },
    }
    const res = await POST(makePostReq({ domain: 'greenly.earth' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.code).toBe('DB_ERROR')
  })
})
