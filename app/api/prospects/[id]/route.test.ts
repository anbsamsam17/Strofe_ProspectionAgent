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
