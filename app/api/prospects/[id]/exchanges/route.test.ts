// ============================================================
// TESTS — /api/prospects/[id]/exchanges (GET + POST)
// Mock complet du client Supabase SSR (pas d'appel réel).
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// ------------------------------------------------------------
// MOCK Supabase SSR — DOIT être fait AVANT l'import de la route.
// ------------------------------------------------------------

const mockGetUser = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    })),
  })),
}))

// Imports APRÈS vi.mock.
import { GET, POST } from './route'
import { NextRequest } from 'next/server'

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

const VALID_USER_ID = '11111111-1111-1111-1111-111111111111'
const VALID_PROSPECT_ID = '22222222-2222-4222-a222-222222222222'

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/prospects/' + VALID_PROSPECT_ID + '/exchanges',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

function makeGetRequest(): NextRequest {
  return new NextRequest(
    'http://localhost/api/prospects/' + VALID_PROSPECT_ID + '/exchanges',
    { method: 'GET' },
  )
}

const params = Promise.resolve({ id: VALID_PROSPECT_ID })

/**
 * Helper de mock complet : prospect trouvé + insert capturable.
 */
async function setupSuccessfulPost(opts?: {
  insertedRow?: Record<string, unknown>
  insertError?: { message: string } | null
}) {
  const captured: { insertPayload?: Record<string, unknown> } = {}

  const { createClient } = await import('@/lib/supabase/server')
  ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => {
      if (table === 'prospects') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: { id: VALID_PROSPECT_ID }, error: null }),
            })),
          })),
        }
      }
      // table === 'prospect_exchanges'
      return {
        insert: vi.fn((payload: Record<string, unknown>) => {
          captured.insertPayload = payload
          return {
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: opts?.insertedRow ?? { id: 'exchange-uuid', ...payload },
                error: opts?.insertError ?? null,
              }),
            })),
          }
        }),
      }
    }),
  }))

  return captured
}

beforeEach(() => {
  mockGetUser.mockResolvedValue({
    data: { user: { id: VALID_USER_ID } },
    error: null,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

// ============================================================
// GET — Auth & listing
// ============================================================

describe('GET /api/prospects/[id]/exchanges — auth', () => {
  it('retourne 401 sans session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await GET(makeGetRequest(), { params })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('UNAUTHENTICATED')
  })

  it('retourne 400 si l\'id n\'est pas un UUID', async () => {
    const badParams = Promise.resolve({ id: 'not-uuid' })
    const res = await GET(makeGetRequest(), { params: badParams })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })
})

describe('GET /api/prospects/[id]/exchanges — listing', () => {
  it('retourne un tableau d\'échanges (200)', async () => {
    const rows = [
      {
        id: 'e1',
        prospect_id: VALID_PROSPECT_ID,
        type: 'appel',
        occurred_at: '2026-05-12T10:00:00Z',
      },
      {
        id: 'e2',
        prospect_id: VALID_PROSPECT_ID,
        type: 'email',
        occurred_at: '2026-05-10T10:00:00Z',
      },
    ]
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({ data: rows, error: null }),
          })),
        })),
      })),
    }))

    const res = await GET(makeGetRequest(), { params })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data?: unknown[] }
    expect(body.data).toEqual(rows)
  })

  it('retourne data:[] si Supabase retourne null', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
      })),
    }))

    const res = await GET(makeGetRequest(), { params })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data?: unknown[] }
    expect(body.data).toEqual([])
  })

  it('retourne 500 sur erreur Supabase', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'fail' },
            }),
          })),
        })),
      })),
    }))

    const res = await GET(makeGetRequest(), { params })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('DB_ERROR')
  })
})

// ============================================================
// POST — Auth & validation
// ============================================================

describe('POST /api/prospects/[id]/exchanges — auth & UUID', () => {
  it('retourne 401 sans session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await POST(makePostRequest({ type: 'appel' }), { params })
    expect(res.status).toBe(401)
  })

  it('retourne 400 si l\'id n\'est pas un UUID', async () => {
    const badParams = Promise.resolve({ id: 'not-uuid' })
    const res = await POST(makePostRequest({ type: 'appel' }), { params: badParams })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })
})

describe('POST /api/prospects/[id]/exchanges — validation', () => {
  it('retourne 400 si type est absent', async () => {
    await setupSuccessfulPost()
    const res = await POST(makePostRequest({}), { params })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })

  it('retourne 400 si type invalide (hors enum)', async () => {
    await setupSuccessfulPost()
    const res = await POST(makePostRequest({ type: 'sms' }), { params })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })

  it('retourne 400 si occurred_at n\'est pas un datetime ISO', async () => {
    await setupSuccessfulPost()
    const res = await POST(
      makePostRequest({ type: 'appel', occurred_at: '12/05/2026' }),
      { params },
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })

  it('retourne 400 si callback_date n\'est pas un datetime ISO', async () => {
    await setupSuccessfulPost()
    const res = await POST(
      makePostRequest({ type: 'appel', callback_date: 'demain' }),
      { params },
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })

  it('retourne 400 si notes dépasse 4000 caractères', async () => {
    await setupSuccessfulPost()
    const res = await POST(
      makePostRequest({ type: 'appel', notes: 'a'.repeat(4001) }),
      { params },
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })

  it('retourne 400 si JSON malformé', async () => {
    await setupSuccessfulPost()
    const badReq = new NextRequest(
      'http://localhost/api/prospects/' + VALID_PROSPECT_ID + '/exchanges',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      },
    )
    const res = await POST(badReq, { params })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })
})

// ============================================================
// POST — Logique métier (insertion)
// ============================================================

describe('POST /api/prospects/[id]/exchanges — création', () => {
  it('insère un échange avec user_id, prospect_id, type', async () => {
    const captured = await setupSuccessfulPost()
    const res = await POST(
      makePostRequest({
        type: 'appel',
        result: 'positif',
        notes: 'Bon contact',
      }),
      { params },
    )
    expect(res.status).toBe(201)
    expect(captured.insertPayload?.user_id).toBe(VALID_USER_ID)
    expect(captured.insertPayload?.prospect_id).toBe(VALID_PROSPECT_ID)
    expect(captured.insertPayload?.type).toBe('appel')
    expect(captured.insertPayload?.result).toBe('positif')
    expect(captured.insertPayload?.notes).toBe('Bon contact')
  })

  it('utilise now() pour occurred_at si non fourni', async () => {
    const captured = await setupSuccessfulPost()
    const before = Date.now()
    const res = await POST(makePostRequest({ type: 'email' }), { params })
    const after = Date.now()
    expect(res.status).toBe(201)
    expect(captured.insertPayload?.occurred_at).toBeDefined()
    const occurred = new Date(captured.insertPayload?.occurred_at as string).getTime()
    expect(occurred).toBeGreaterThanOrEqual(before)
    expect(occurred).toBeLessThanOrEqual(after)
  })

  it('respecte occurred_at fourni par le body', async () => {
    const captured = await setupSuccessfulPost()
    const iso = '2026-05-01T10:00:00+00:00'
    const res = await POST(
      makePostRequest({ type: 'appel', occurred_at: iso }),
      { params },
    )
    expect(res.status).toBe(201)
    expect(captured.insertPayload?.occurred_at).toBe(iso)
  })

  it('défaut callback_date=null, result=null, notes=null si non fournis', async () => {
    const captured = await setupSuccessfulPost()
    const res = await POST(makePostRequest({ type: 'appel' }), { params })
    expect(res.status).toBe(201)
    expect(captured.insertPayload?.callback_date).toBeNull()
    expect(captured.insertPayload?.result).toBeNull()
    expect(captured.insertPayload?.notes).toBeNull()
  })

  it('accepte tous les types de l\'enum (appel|email|linkedin|rdv|autre)', async () => {
    for (const type of ['appel', 'email', 'linkedin', 'rdv', 'autre'] as const) {
      const captured = await setupSuccessfulPost()
      const res = await POST(makePostRequest({ type }), { params })
      expect(res.status).toBe(201)
      expect(captured.insertPayload?.type).toBe(type)
    }
  })

  it('retourne 404 si le prospect n\'existe pas', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'prospects') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: null, error: null }),
              })),
            })),
          }
        }
        return {}
      }),
    }))
    const res = await POST(makePostRequest({ type: 'appel' }), { params })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('NOT_FOUND')
  })

  it('retourne 500 si la lookup prospect échoue', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'prospects') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: null, error: { message: 'oops' } }),
              })),
            })),
          }
        }
        return {}
      }),
    }))
    const res = await POST(makePostRequest({ type: 'appel' }), { params })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('DB_ERROR')
  })

  it('retourne 500 si l\'insert échoue', async () => {
    await setupSuccessfulPost({
      insertError: { message: 'fk violation' },
    })
    const res = await POST(makePostRequest({ type: 'appel' }), { params })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('DB_ERROR')
  })

  it('retourne l\'échange créé en data (201)', async () => {
    await setupSuccessfulPost({
      insertedRow: {
        id: 'exchange-uuid',
        type: 'appel',
        prospect_id: VALID_PROSPECT_ID,
      },
    })
    const res = await POST(makePostRequest({ type: 'appel' }), { params })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      data?: { id?: string; type?: string }
    }
    expect(body.data?.id).toBe('exchange-uuid')
    expect(body.data?.type).toBe('appel')
  })
})
