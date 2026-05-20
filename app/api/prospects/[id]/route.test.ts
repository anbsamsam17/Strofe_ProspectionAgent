// ============================================================
// TESTS — /api/prospects/[id] (PATCH archive/notes + DELETE règles)
// Mock complet du client Supabase SSR (pas d'appel réel).
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// ------------------------------------------------------------
// MOCK Supabase SSR — DOIT être fait AVANT l'import de la route.
// ------------------------------------------------------------

const mockGetUser = vi.fn()
const mockMaybeSingleSelect = vi.fn() // pour le pré-check DELETE (.select.eq.eq.maybeSingle)
const mockMaybeSingleUpdate = vi.fn() // pour le PATCH (.update.eq.eq.select.maybeSingle)
const mockDelete = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: mockMaybeSingleSelect,
          })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: mockMaybeSingleUpdate,
            })),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: mockDelete,
        })),
      })),
    })),
  })),
}))

// Imports APRÈS vi.mock — l'import déclenche le hoist du mock.
import { PATCH, DELETE } from './route'
import { NextRequest } from 'next/server'

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

const VALID_USER_ID = '11111111-1111-1111-1111-111111111111'
const VALID_PROSPECT_ID = '22222222-2222-4222-a222-222222222222'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/prospects/' + VALID_PROSPECT_ID, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeDeleteRequest(): NextRequest {
  return new NextRequest('http://localhost/api/prospects/' + VALID_PROSPECT_ID, {
    method: 'DELETE',
  })
}

const params = Promise.resolve({ id: VALID_PROSPECT_ID })

beforeEach(() => {
  mockGetUser.mockResolvedValue({
    data: { user: { id: VALID_USER_ID } },
    error: null,
  })
  mockMaybeSingleSelect.mockReset()
  mockMaybeSingleUpdate.mockReset()
  mockDelete.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ------------------------------------------------------------
// PATCH — archive
// ------------------------------------------------------------

describe('PATCH /api/prospects/[id] — archive', () => {
  it('transforme archived:true en archived_at ISO timestamp', async () => {
    let capturedUpdate: Record<string, unknown> | undefined

    // On reconfigure le mock from() pour capturer ce qui est passé à update().
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        update: vi.fn((payload: Record<string, unknown>) => {
          capturedUpdate = payload
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: VALID_PROSPECT_ID, archived_at: '2026-05-12T00:00:00Z' },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }),
      })),
    }))

    const res = await PATCH(makeRequest({ archived: true }), { params })

    expect(res.status).toBe(200)
    expect(capturedUpdate).toBeDefined()
    expect(capturedUpdate).toHaveProperty('archived_at')
    expect(typeof (capturedUpdate as Record<string, unknown>).archived_at).toBe('string')
    expect((capturedUpdate as Record<string, unknown>).archived_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    )
    // `archived` ne doit pas être propagé tel quel à la DB
    expect(capturedUpdate).not.toHaveProperty('archived')
  })

  it('transforme archived:false en archived_at:null (désarchivage)', async () => {
    let capturedUpdate: Record<string, unknown> | undefined

    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        update: vi.fn((payload: Record<string, unknown>) => {
          capturedUpdate = payload
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: VALID_PROSPECT_ID, archived_at: null },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }),
      })),
    }))

    const res = await PATCH(makeRequest({ archived: false }), { params })

    expect(res.status).toBe(200)
    expect(capturedUpdate).toBeDefined()
    expect((capturedUpdate as Record<string, unknown>).archived_at).toBeNull()
  })
})

// ------------------------------------------------------------
// PATCH — notes
// ------------------------------------------------------------

describe('PATCH /api/prospects/[id] — notes', () => {
  it('accepte une string de notes <= 4000 caractères', async () => {
    let capturedUpdate: Record<string, unknown> | undefined

    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        update: vi.fn((payload: Record<string, unknown>) => {
          capturedUpdate = payload
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: VALID_PROSPECT_ID, notes: 'Hello' },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }),
      })),
    }))

    const res = await PATCH(makeRequest({ notes: 'Hello' }), { params })
    expect(res.status).toBe(200)
    expect((capturedUpdate as Record<string, unknown>).notes).toBe('Hello')
  })

  it('accepte notes:null (effacement)', async () => {
    let capturedUpdate: Record<string, unknown> | undefined

    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        update: vi.fn((payload: Record<string, unknown>) => {
          capturedUpdate = payload
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: VALID_PROSPECT_ID, notes: null },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }),
      })),
    }))

    const res = await PATCH(makeRequest({ notes: null }), { params })
    expect(res.status).toBe(200)
    expect((capturedUpdate as Record<string, unknown>).notes).toBeNull()
  })

  it('rejette des notes > 4000 caractères avec 400', async () => {
    const longNotes = 'a'.repeat(4001)
    const res = await PATCH(makeRequest({ notes: longNotes }), { params })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('VALIDATION_ERROR')
  })
})

// ------------------------------------------------------------
// PATCH — deal_value + deal_probability (GLN-041)
// ------------------------------------------------------------

describe('PATCH /api/prospects/[id] — deal_value / deal_probability', () => {
  it('accepte deal_value:number et deal_probability:int 0-100', async () => {
    let capturedUpdate: Record<string, unknown> | undefined

    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        update: vi.fn((payload: Record<string, unknown>) => {
          capturedUpdate = payload
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: VALID_PROSPECT_ID,
                      deal_value: 12500,
                      deal_probability: 50,
                    },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }),
      })),
    }))

    const res = await PATCH(
      makeRequest({ deal_value: 12500, deal_probability: 50 }),
      { params },
    )
    expect(res.status).toBe(200)
    expect(capturedUpdate).toBeDefined()
    expect((capturedUpdate as Record<string, unknown>).deal_value).toBe(12500)
    expect((capturedUpdate as Record<string, unknown>).deal_probability).toBe(50)
  })

  it('accepte deal_value:null et deal_probability:null (effacement)', async () => {
    let capturedUpdate: Record<string, unknown> | undefined

    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        update: vi.fn((payload: Record<string, unknown>) => {
          capturedUpdate = payload
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: VALID_PROSPECT_ID,
                      deal_value: null,
                      deal_probability: null,
                    },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }),
      })),
    }))

    const res = await PATCH(
      makeRequest({ deal_value: null, deal_probability: null }),
      { params },
    )
    expect(res.status).toBe(200)
    expect((capturedUpdate as Record<string, unknown>).deal_value).toBeNull()
    expect((capturedUpdate as Record<string, unknown>).deal_probability).toBeNull()
  })

  it('rejette deal_value négatif avec 400', async () => {
    const res = await PATCH(makeRequest({ deal_value: -100 }), { params })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('VALIDATION_ERROR')
  })

  it('rejette deal_value > 99 999 999.99 avec 400', async () => {
    const res = await PATCH(makeRequest({ deal_value: 100_000_000 }), { params })
    expect(res.status).toBe(400)
  })

  it('rejette deal_probability hors 0-100 avec 400', async () => {
    const res1 = await PATCH(makeRequest({ deal_probability: 150 }), { params })
    expect(res1.status).toBe(400)
    const res2 = await PATCH(makeRequest({ deal_probability: -5 }), { params })
    expect(res2.status).toBe(400)
  })

  it('rejette deal_probability non entier avec 400', async () => {
    const res = await PATCH(makeRequest({ deal_probability: 50.5 }), { params })
    expect(res.status).toBe(400)
  })
})

// ------------------------------------------------------------
// PATCH — auth + body vide
// ------------------------------------------------------------

describe('PATCH /api/prospects/[id] — sécurité', () => {
  it('retourne 401 sans session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await PATCH(makeRequest({ notes: 'x' }), { params })
    expect(res.status).toBe(401)
  })

  it('retourne 400 si body vide', async () => {
    const res = await PATCH(makeRequest({}), { params })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('EMPTY_UPDATE')
  })
})

// ------------------------------------------------------------
// DELETE — règle métier "statut protégé"
// ------------------------------------------------------------

describe('DELETE /api/prospects/[id] — règles métier', () => {
  it('refuse la suppression d’un prospect "interested" non archivé (409)', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: VALID_PROSPECT_ID, statut: 'interested', archived_at: null },
                error: null,
              }),
            })),
          })),
        })),
      })),
    }))

    const res = await DELETE(makeDeleteRequest(), { params })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('DELETE_FORBIDDEN')
  })

  it('refuse la suppression d’un prospect "converted" non archivé (409)', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: VALID_PROSPECT_ID, statut: 'converted', archived_at: null },
                error: null,
              }),
            })),
          })),
        })),
      })),
    }))

    const res = await DELETE(makeDeleteRequest(), { params })
    expect(res.status).toBe(409)
  })

  it('autorise la suppression d’un prospect "interested" archivé', async () => {
    let deleteCalled = false
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: VALID_PROSPECT_ID,
                  statut: 'interested',
                  archived_at: '2026-05-01T00:00:00Z',
                },
                error: null,
              }),
            })),
          })),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => {
              deleteCalled = true
              return { error: null }
            }),
          })),
        })),
      })),
    }))

    const res = await DELETE(makeDeleteRequest(), { params })
    expect(res.status).toBe(200)
    expect(deleteCalled).toBe(true)
    const body = (await res.json()) as { data?: { deleted?: boolean } }
    expect(body.data?.deleted).toBe(true)
  })

  it('autorise la suppression d’un statut non protégé (sourced)', async () => {
    let deleteCalled = false
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: VALID_PROSPECT_ID, statut: 'sourced', archived_at: null },
                error: null,
              }),
            })),
          })),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => {
              deleteCalled = true
              return { error: null }
            }),
          })),
        })),
      })),
    }))

    const res = await DELETE(makeDeleteRequest(), { params })
    expect(res.status).toBe(200)
    expect(deleteCalled).toBe(true)
  })

  it('retourne 404 si le prospect n’existe pas', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          })),
        })),
      })),
    }))

    const res = await DELETE(makeDeleteRequest(), { params })
    expect(res.status).toBe(404)
  })

  it('retourne 401 sans session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await DELETE(makeDeleteRequest(), { params })
    expect(res.status).toBe(401)
  })
})
