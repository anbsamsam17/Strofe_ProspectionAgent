// ============================================================
// TESTS — /api/prospects/[id]/priority (PATCH)
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
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
      })),
    })),
  })),
}))

// Imports APRÈS vi.mock.
import { PATCH } from './route'
import { NextRequest } from 'next/server'

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

const VALID_USER_ID = '11111111-1111-1111-1111-111111111111'
const VALID_PROSPECT_ID = '22222222-2222-4222-a222-222222222222'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/prospects/' + VALID_PROSPECT_ID + '/priority',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

const params = Promise.resolve({ id: VALID_PROSPECT_ID })

/**
 * Helper de mock complet pour PATCH : capture le payload d'update et
 * l'id ciblé par `.eq('id', ...)`.
 */
async function setupSuccessfulPatch(opts?: {
  updatedRow?: Record<string, unknown> | null
  updateError?: { message: string } | null
}) {
  const captured: {
    updatePayload?: Record<string, unknown>
    eqColumn?: string
    eqValue?: unknown
  } = {}

  const { createClient } = await import('@/lib/supabase/server')
  ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      update: vi.fn((payload: Record<string, unknown>) => {
        captured.updatePayload = payload
        return {
          eq: vi.fn((column: string, value: unknown) => {
            captured.eqColumn = column
            captured.eqValue = value
            return {
              select: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data:
                    opts?.updatedRow === undefined
                      ? {
                          id: VALID_PROSPECT_ID,
                          priorite: (payload.priorite as string) ?? 'moyenne',
                        }
                      : opts.updatedRow,
                  error: opts?.updateError ?? null,
                }),
              })),
            }
          }),
        }
      }),
    })),
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
// PATCH — Auth & UUID
// ============================================================

describe('PATCH /api/prospects/[id]/priority — auth', () => {
  it('retourne 401 sans session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await PATCH(makeRequest({ priorite: 'haute' }), { params })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('UNAUTHENTICATED')
  })

  it('retourne 400 si id n\'est pas un UUID', async () => {
    const badParams = Promise.resolve({ id: 'not-uuid' })
    const res = await PATCH(makeRequest({ priorite: 'haute' }), { params: badParams })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })
})

// ============================================================
// PATCH — Validation Zod
// ============================================================

describe('PATCH /api/prospects/[id]/priority — validation', () => {
  it('retourne 400 si body sans priorite', async () => {
    await setupSuccessfulPatch()
    const res = await PATCH(makeRequest({}), { params })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })

  it('retourne 400 si priorite hors enum', async () => {
    await setupSuccessfulPatch()
    const res = await PATCH(makeRequest({ priorite: 'urgent' }), { params })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })

  it('retourne 400 si priorite null', async () => {
    await setupSuccessfulPatch()
    const res = await PATCH(makeRequest({ priorite: null }), { params })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })

  it('retourne 400 si JSON malformé', async () => {
    await setupSuccessfulPatch()
    const badReq = new NextRequest(
      'http://localhost/api/prospects/' + VALID_PROSPECT_ID + '/priority',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'pas-du-json',
      },
    )
    const res = await PATCH(badReq, { params })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })
})

// ============================================================
// PATCH — Logique métier
// ============================================================

describe('PATCH /api/prospects/[id]/priority — mise à jour', () => {
  it('accepte priorite "haute" et met à jour le bon prospect', async () => {
    const captured = await setupSuccessfulPatch()
    const res = await PATCH(makeRequest({ priorite: 'haute' }), { params })
    expect(res.status).toBe(200)
    expect(captured.updatePayload?.priorite).toBe('haute')
    expect(captured.eqColumn).toBe('id')
    expect(captured.eqValue).toBe(VALID_PROSPECT_ID)
  })

  it('accepte priorite "moyenne"', async () => {
    const captured = await setupSuccessfulPatch()
    const res = await PATCH(makeRequest({ priorite: 'moyenne' }), { params })
    expect(res.status).toBe(200)
    expect(captured.updatePayload?.priorite).toBe('moyenne')
  })

  it('accepte priorite "basse"', async () => {
    const captured = await setupSuccessfulPatch()
    const res = await PATCH(makeRequest({ priorite: 'basse' }), { params })
    expect(res.status).toBe(200)
    expect(captured.updatePayload?.priorite).toBe('basse')
  })

  it('renvoie le row mis à jour en data (id + priorite)', async () => {
    await setupSuccessfulPatch({
      updatedRow: { id: VALID_PROSPECT_ID, priorite: 'haute' },
    })
    const res = await PATCH(makeRequest({ priorite: 'haute' }), { params })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data?: { id?: string; priorite?: string }
    }
    expect(body.data?.id).toBe(VALID_PROSPECT_ID)
    expect(body.data?.priorite).toBe('haute')
  })

  it('retourne 404 si aucun row n\'a matché (prospect introuvable / pas du user)', async () => {
    await setupSuccessfulPatch({ updatedRow: null })
    const res = await PATCH(makeRequest({ priorite: 'haute' }), { params })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('NOT_FOUND')
  })

  it('retourne 500 si Supabase renvoie une erreur sur l\'update', async () => {
    await setupSuccessfulPatch({
      updateError: { message: 'check constraint violation' },
      updatedRow: null,
    })
    const res = await PATCH(makeRequest({ priorite: 'haute' }), { params })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('DB_ERROR')
  })

  it('le payload d\'update ne contient PAS de filter user_id côté code (RLS implicite)', async () => {
    // L'update est censé filtrer uniquement par id ; RLS sécurise le user_id.
    const captured = await setupSuccessfulPatch()
    const res = await PATCH(makeRequest({ priorite: 'haute' }), { params })
    expect(res.status).toBe(200)
    expect(captured.updatePayload).not.toHaveProperty('user_id')
    // Le seul filter posé doit être sur 'id'.
    expect(captured.eqColumn).toBe('id')
  })
})
