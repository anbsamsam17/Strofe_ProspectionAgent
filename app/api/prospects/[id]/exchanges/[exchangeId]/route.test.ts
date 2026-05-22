// ============================================================
// TESTS — /api/prospects/[id]/exchanges/[exchangeId] (PATCH + DELETE)
// Mock complet du client Supabase SSR (pas d'appel réel).
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const mockGetUser = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })),
    })),
  })),
}))

import { PATCH, DELETE } from './route'
import { NextRequest } from 'next/server'

const VALID_USER_ID = '11111111-1111-1111-1111-111111111111'
const VALID_PROSPECT_ID = '22222222-2222-4222-a222-222222222222'
const VALID_EXCHANGE_ID = '44444444-4444-4444-a444-444444444444'

function makePatchRequest(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/prospects/${VALID_PROSPECT_ID}/exchanges/${VALID_EXCHANGE_ID}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

function makeDeleteRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/prospects/${VALID_PROSPECT_ID}/exchanges/${VALID_EXCHANGE_ID}`,
    { method: 'DELETE' },
  )
}

const params = Promise.resolve({
  id: VALID_PROSPECT_ID,
  exchangeId: VALID_EXCHANGE_ID,
})

async function setupSuccessfulPatch(opts?: {
  updatedRow?: Record<string, unknown>
  updateError?: { message: string } | null
  exchangeRow?: { id: string; prospect_id: string } | null
}) {
  const captured: { updatePayload?: Record<string, unknown> } = {}

  const { createClient } = await import('@/lib/supabase/server')
  ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data:
              opts?.exchangeRow === null
                ? null
                : opts?.exchangeRow ?? {
                    id: VALID_EXCHANGE_ID,
                    prospect_id: VALID_PROSPECT_ID,
                  },
            error: null,
          }),
        })),
      })),
      update: vi.fn((payload: Record<string, unknown>) => {
        captured.updatePayload = payload
        return {
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data:
                  opts?.updatedRow ?? { id: VALID_EXCHANGE_ID, ...payload },
                error: opts?.updateError ?? null,
              }),
            })),
          })),
        }
      }),
      delete: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })),
    })),
  }))

  return captured
}

async function setupSuccessfulDelete(opts?: {
  deleteError?: { message: string } | null
  exchangeRow?: { id: string; prospect_id: string } | null
}) {
  const captured = { deleted: false }
  const { createClient } = await import('@/lib/supabase/server')
  ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data:
              opts?.exchangeRow === null
                ? null
                : opts?.exchangeRow ?? {
                    id: VALID_EXCHANGE_ID,
                    prospect_id: VALID_PROSPECT_ID,
                  },
            error: null,
          }),
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn().mockImplementation(async () => {
          captured.deleted = true
          return { error: opts?.deleteError ?? null }
        }),
      })),
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
// PATCH
// ============================================================

describe('PATCH /api/prospects/[id]/exchanges/[exchangeId] — auth', () => {
  it('retourne 401 sans session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await PATCH(makePatchRequest({ notes: 'X' }), { params })
    expect(res.status).toBe(401)
  })

  it('retourne 400 si UUID invalide', async () => {
    const badParams = Promise.resolve({
      id: VALID_PROSPECT_ID,
      exchangeId: 'not-uuid',
    })
    const res = await PATCH(makePatchRequest({ notes: 'X' }), { params: badParams })
    expect(res.status).toBe(400)
  })

  it('retourne 404 si échange inexistant', async () => {
    await setupSuccessfulPatch({ exchangeRow: null })
    const res = await PATCH(makePatchRequest({ notes: 'X' }), { params })
    expect(res.status).toBe(404)
  })

  it('retourne 404 si échange appartient à un autre prospect', async () => {
    await setupSuccessfulPatch({
      exchangeRow: {
        id: VALID_EXCHANGE_ID,
        prospect_id: '99999999-9999-4999-a999-999999999999',
      },
    })
    const res = await PATCH(makePatchRequest({ notes: 'X' }), { params })
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/prospects/[id]/exchanges/[exchangeId] — validation', () => {
  it('retourne 400 si JSON malformé', async () => {
    await setupSuccessfulPatch()
    const badReq = new NextRequest(
      `http://localhost/api/prospects/${VALID_PROSPECT_ID}/exchanges/${VALID_EXCHANGE_ID}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      },
    )
    const res = await PATCH(badReq, { params })
    expect(res.status).toBe(400)
  })

  it('retourne 400 si type invalide', async () => {
    await setupSuccessfulPatch()
    const res = await PATCH(makePatchRequest({ type: 'sms' }), { params })
    expect(res.status).toBe(400)
  })

  it('retourne 400 si occurred_at pas ISO', async () => {
    await setupSuccessfulPatch()
    const res = await PATCH(
      makePatchRequest({ occurred_at: 'hier' }),
      { params },
    )
    expect(res.status).toBe(400)
  })

  it('retourne 400 si callback_date pas ISO', async () => {
    await setupSuccessfulPatch()
    const res = await PATCH(
      makePatchRequest({ callback_date: 'demain' }),
      { params },
    )
    expect(res.status).toBe(400)
  })

  it('retourne 400 si notes > 4000 caractères', async () => {
    await setupSuccessfulPatch()
    const res = await PATCH(
      makePatchRequest({ notes: 'a'.repeat(4001) }),
      { params },
    )
    expect(res.status).toBe(400)
  })

  it('retourne 400 si body vide', async () => {
    await setupSuccessfulPatch()
    const res = await PATCH(makePatchRequest({}), { params })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/prospects/[id]/exchanges/[exchangeId] — update OK', () => {
  it('met à jour les champs fournis (200)', async () => {
    const captured = await setupSuccessfulPatch()
    const res = await PATCH(
      makePatchRequest({
        type: 'email',
        result: 'callback',
        notes: 'Note maj',
      }),
      { params },
    )
    expect(res.status).toBe(200)
    expect(captured.updatePayload?.type).toBe('email')
    expect(captured.updatePayload?.result).toBe('callback')
    expect(captured.updatePayload?.notes).toBe('Note maj')
  })

  it('callback_done bool est accepté', async () => {
    const captured = await setupSuccessfulPatch()
    const res = await PATCH(
      makePatchRequest({ callback_done: true }),
      { params },
    )
    expect(res.status).toBe(200)
    expect(captured.updatePayload?.callback_done).toBe(true)
  })

  it('normalise notes vide en null', async () => {
    const captured = await setupSuccessfulPatch()
    const res = await PATCH(
      makePatchRequest({ notes: '   ' }),
      { params },
    )
    expect(res.status).toBe(200)
    expect(captured.updatePayload?.notes).toBeNull()
  })

  it('retourne 500 si update échoue', async () => {
    await setupSuccessfulPatch({
      updateError: { message: 'fail' },
    })
    const res = await PATCH(makePatchRequest({ notes: 'X' }), { params })
    expect(res.status).toBe(500)
  })
})

// ============================================================
// DELETE
// ============================================================

describe('DELETE /api/prospects/[id]/exchanges/[exchangeId]', () => {
  it('retourne 401 sans session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await DELETE(makeDeleteRequest(), { params })
    expect(res.status).toBe(401)
  })

  it('retourne 404 si échange inexistant', async () => {
    await setupSuccessfulDelete({ exchangeRow: null })
    const res = await DELETE(makeDeleteRequest(), { params })
    expect(res.status).toBe(404)
  })

  it('supprime l\'échange (200, deleted=true)', async () => {
    const captured = await setupSuccessfulDelete()
    const res = await DELETE(makeDeleteRequest(), { params })
    expect(res.status).toBe(200)
    expect(captured.deleted).toBe(true)
    const body = (await res.json()) as { data?: { deleted?: boolean } }
    expect(body.data?.deleted).toBe(true)
  })

  it('retourne 500 si delete échoue', async () => {
    await setupSuccessfulDelete({
      deleteError: { message: 'fk' },
    })
    const res = await DELETE(makeDeleteRequest(), { params })
    expect(res.status).toBe(500)
  })
})
