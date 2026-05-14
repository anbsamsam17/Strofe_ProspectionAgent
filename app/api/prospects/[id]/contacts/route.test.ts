// ============================================================
// TESTS — /api/prospects/[id]/contacts (GET + POST)
// Mock complet du client Supabase SSR (pas d'appel réel).
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// ------------------------------------------------------------
// MOCK Supabase SSR — DOIT être fait AVANT l'import de la route.
// ------------------------------------------------------------

const mockGetUser = vi.fn()

// Mock par défaut : tout chainable, on remplace via mockImplementationOnce
// au cas par cas pour capturer les payloads d'insert/select.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
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

// Imports APRÈS vi.mock — l'import déclenche le hoist du mock.
import { GET, POST } from './route'
import { NextRequest } from 'next/server'

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

const VALID_USER_ID = '11111111-1111-1111-1111-111111111111'
const VALID_PROSPECT_ID = '22222222-2222-4222-a222-222222222222'

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/prospects/' + VALID_PROSPECT_ID + '/contacts',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

function makeGetRequest(): NextRequest {
  return new NextRequest(
    'http://localhost/api/prospects/' + VALID_PROSPECT_ID + '/contacts',
    { method: 'GET' },
  )
}

const params = Promise.resolve({ id: VALID_PROSPECT_ID })

/**
 * Helper de mock complet : prospect trouvé, insert capturable.
 * Permet d'asserter sur le payload passé à `.insert()`.
 */
async function setupSuccessfulPost(opts?: {
  insertedRow?: Record<string, unknown>
  insertError?: { message: string } | null
}) {
  const captured: { insertPayload?: Record<string, unknown>; fromCalls: string[] } = {
    fromCalls: [],
  }

  const { createClient } = await import('@/lib/supabase/server')
  ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => {
      captured.fromCalls.push(table)
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
      // table === 'prospect_contacts'
      return {
        insert: vi.fn((payload: Record<string, unknown>) => {
          captured.insertPayload = payload
          return {
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: opts?.insertedRow ?? { id: 'contact-uuid', ...payload },
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

describe('GET /api/prospects/[id]/contacts — auth', () => {
  it('retourne 401 sans session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await GET(makeGetRequest(), { params })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('UNAUTHENTICATED')
  })

  it('retourne 400 si l\'id n\'est pas un UUID', async () => {
    const badParams = Promise.resolve({ id: 'not-a-uuid' })
    const res = await GET(makeGetRequest(), { params: badParams })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })
})

describe('GET /api/prospects/[id]/contacts — listing', () => {
  it('retourne un tableau de contacts (200)', async () => {
    const rows = [
      { id: 'c1', prospect_id: VALID_PROSPECT_ID, nom: 'Dupont', is_primary: true },
      { id: 'c2', prospect_id: VALID_PROSPECT_ID, nom: 'Martin', is_primary: false },
    ]
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: rows, error: null }),
            })),
          })),
        })),
      })),
    }))

    const res = await GET(makeGetRequest(), { params })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data?: unknown[] }
    expect(body.data).toEqual(rows)
  })

  it('retourne un tableau vide si aucun contact (200, data=[])', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          })),
        })),
      })),
    }))

    const res = await GET(makeGetRequest(), { params })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data?: unknown[] }
    expect(body.data).toEqual([])
  })

  it('retourne 500 si Supabase renvoie une erreur', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'boom' },
              }),
            })),
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

describe('POST /api/prospects/[id]/contacts — auth & UUID', () => {
  it('retourne 401 sans session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await POST(makePostRequest({ nom: 'Dupont' }), { params })
    expect(res.status).toBe(401)
  })

  it('retourne 400 si l\'id n\'est pas un UUID', async () => {
    const badParams = Promise.resolve({ id: 'invalid' })
    const res = await POST(makePostRequest({ nom: 'Dupont' }), { params: badParams })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })
})

describe('POST /api/prospects/[id]/contacts — validation', () => {
  it('retourne 400 si tous les champs identifiants sont absents (INVALID_INPUT)', async () => {
    await setupSuccessfulPost()
    const res = await POST(makePostRequest({}), { params })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })

  it('retourne 400 si email invalide', async () => {
    await setupSuccessfulPost()
    const res = await POST(makePostRequest({ email: 'pas-un-email' }), { params })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })

  it('retourne 400 si linkedin n\'est pas une URL http(s)', async () => {
    await setupSuccessfulPost()
    const res = await POST(makePostRequest({ linkedin: 'pas-une-url' }), { params })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })

  it('retourne 400 si téléphone contient des caractères invalides', async () => {
    await setupSuccessfulPost()
    const res = await POST(makePostRequest({ telephone: 'abc<script>' }), { params })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })

  it('retourne 400 si JSON malformé', async () => {
    const badReq = new NextRequest(
      'http://localhost/api/prospects/' + VALID_PROSPECT_ID + '/contacts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      },
    )
    // On doit aussi pré-mocker l'auth + le prospect lookup pour atteindre le parse JSON.
    await setupSuccessfulPost()
    const res = await POST(badReq, { params })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })
})

// ============================================================
// POST — Logique métier (insertion)
// ============================================================

describe('POST /api/prospects/[id]/contacts — création', () => {
  it('insère un contact avec user_id, prospect_id, is_primary=false par défaut', async () => {
    const captured = await setupSuccessfulPost()
    const res = await POST(
      makePostRequest({
        nom: 'Dupont',
        prenom: 'Jean',
        poste: 'Directeur RSE',
      }),
      { params },
    )
    expect(res.status).toBe(201)
    expect(captured.insertPayload).toBeDefined()
    expect(captured.insertPayload?.user_id).toBe(VALID_USER_ID)
    expect(captured.insertPayload?.prospect_id).toBe(VALID_PROSPECT_ID)
    expect(captured.insertPayload?.nom).toBe('Dupont')
    expect(captured.insertPayload?.prenom).toBe('Jean')
    expect(captured.insertPayload?.poste).toBe('Directeur RSE')
    expect(captured.insertPayload?.is_primary).toBe(false)
    // Défaut source='manual'
    expect(captured.insertPayload?.source).toBe('manual')
  })

  it('insère is_primary=true si fourni explicitement', async () => {
    const captured = await setupSuccessfulPost()
    const res = await POST(
      makePostRequest({ nom: 'Dupont', is_primary: true }),
      { params },
    )
    expect(res.status).toBe(201)
    expect(captured.insertPayload?.is_primary).toBe(true)
  })

  it('normalise une chaîne vide en null pour les champs optionnels', async () => {
    const captured = await setupSuccessfulPost()
    const res = await POST(
      makePostRequest({
        nom: 'Dupont',
        prenom: '   ',
        email: '',
        telephone: '',
        linkedin: '',
      }),
      { params },
    )
    expect(res.status).toBe(201)
    // Le helper nullableString trim et transforme '' en null
    expect(captured.insertPayload?.prenom).toBeNull()
    expect(captured.insertPayload?.email).toBeNull()
    expect(captured.insertPayload?.telephone).toBeNull()
    expect(captured.insertPayload?.linkedin).toBeNull()
  })

  it('retourne 404 si le prospect n\'existe pas pour cet utilisateur', async () => {
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
    const res = await POST(makePostRequest({ nom: 'Dupont' }), { params })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('NOT_FOUND')
  })

  it('retourne 500 si Supabase renvoie une erreur sur la lookup prospect', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'prospects') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'kaboom' },
                }),
              })),
            })),
          }
        }
        return {}
      }),
    }))
    const res = await POST(makePostRequest({ nom: 'Dupont' }), { params })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('DB_ERROR')
  })

  it('retourne 500 si l\'insert échoue (DB_ERROR)', async () => {
    await setupSuccessfulPost({
      insertError: { message: 'unique violation' },
    })
    const res = await POST(makePostRequest({ nom: 'Dupont' }), { params })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('DB_ERROR')
  })

  it('retourne le contact créé en data (201)', async () => {
    await setupSuccessfulPost({
      insertedRow: {
        id: 'contact-uuid',
        nom: 'Dupont',
        is_primary: false,
        prospect_id: VALID_PROSPECT_ID,
      },
    })
    const res = await POST(makePostRequest({ nom: 'Dupont' }), { params })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      data?: { id?: string; nom?: string }
    }
    expect(body.data?.id).toBe('contact-uuid')
    expect(body.data?.nom).toBe('Dupont')
  })
})
