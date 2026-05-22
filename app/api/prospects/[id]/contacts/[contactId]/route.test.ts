// ============================================================
// TESTS — /api/prospects/[id]/contacts/[contactId] (PATCH + DELETE)
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

// Imports APRÈS vi.mock — l'import déclenche le hoist du mock.
import { PATCH, DELETE } from './route'
import { NextRequest } from 'next/server'

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

const VALID_USER_ID = '11111111-1111-1111-1111-111111111111'
const VALID_PROSPECT_ID = '22222222-2222-4222-a222-222222222222'
const VALID_CONTACT_ID = '33333333-3333-4333-a333-333333333333'

function makePatchRequest(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/prospects/${VALID_PROSPECT_ID}/contacts/${VALID_CONTACT_ID}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

function makeDeleteRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/prospects/${VALID_PROSPECT_ID}/contacts/${VALID_CONTACT_ID}`,
    { method: 'DELETE' },
  )
}

const params = Promise.resolve({
  id: VALID_PROSPECT_ID,
  contactId: VALID_CONTACT_ID,
})

/**
 * Helper mock complet : ownership OK + update capturable.
 */
async function setupSuccessfulPatch(opts?: {
  updatedRow?: Record<string, unknown>
  updateError?: { message: string } | null
  /** Si fourni, override la valeur retournée par le SELECT initial (ownership). */
  contactRow?: { id: string; prospect_id: string } | null
  contactError?: { message: string } | null
}) {
  const captured: { updatePayload?: Record<string, unknown> } = {}

  const { createClient } = await import('@/lib/supabase/server')
  ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      // SELECT ownership (.eq('id', ...).maybeSingle())
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data:
              opts?.contactRow === null
                ? null
                : opts?.contactRow ?? {
                    id: VALID_CONTACT_ID,
                    prospect_id: VALID_PROSPECT_ID,
                  },
            error: opts?.contactError ?? null,
          }),
        })),
      })),
      // UPDATE -> capture payload
      update: vi.fn((payload: Record<string, unknown>) => {
        captured.updatePayload = payload
        return {
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data:
                  opts?.updatedRow ?? { id: VALID_CONTACT_ID, ...payload },
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
  contactRow?: { id: string; prospect_id: string } | null
}) {
  const captured: { deleted: boolean } = { deleted: false }
  const { createClient } = await import('@/lib/supabase/server')
  ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data:
              opts?.contactRow === null
                ? null
                : opts?.contactRow ?? {
                    id: VALID_CONTACT_ID,
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
// PATCH — Auth & ownership
// ============================================================

describe('PATCH /api/prospects/[id]/contacts/[contactId] — auth', () => {
  it('retourne 401 sans session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await PATCH(makePatchRequest({ nom: 'X' }), { params })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('UNAUTHENTICATED')
  })

  it('retourne 400 si id prospect invalide', async () => {
    const badParams = Promise.resolve({
      id: 'not-uuid',
      contactId: VALID_CONTACT_ID,
    })
    const res = await PATCH(makePatchRequest({ nom: 'X' }), { params: badParams })
    expect(res.status).toBe(400)
  })

  it('retourne 400 si contactId invalide', async () => {
    const badParams = Promise.resolve({
      id: VALID_PROSPECT_ID,
      contactId: 'not-uuid',
    })
    const res = await PATCH(makePatchRequest({ nom: 'X' }), { params: badParams })
    expect(res.status).toBe(400)
  })

  it('retourne 404 si le contact n\'existe pas', async () => {
    await setupSuccessfulPatch({ contactRow: null })
    const res = await PATCH(makePatchRequest({ nom: 'X' }), { params })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('NOT_FOUND')
  })

  it('retourne 404 si le contact appartient à un autre prospect', async () => {
    await setupSuccessfulPatch({
      contactRow: {
        id: VALID_CONTACT_ID,
        prospect_id: '99999999-9999-4999-a999-999999999999',
      },
    })
    const res = await PATCH(makePatchRequest({ nom: 'X' }), { params })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('NOT_FOUND')
  })
})

describe('PATCH /api/prospects/[id]/contacts/[contactId] — validation', () => {
  it('retourne 400 si JSON malformé', async () => {
    await setupSuccessfulPatch()
    const badReq = new NextRequest(
      `http://localhost/api/prospects/${VALID_PROSPECT_ID}/contacts/${VALID_CONTACT_ID}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      },
    )
    const res = await PATCH(badReq, { params })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })

  it('retourne 400 si email invalide', async () => {
    await setupSuccessfulPatch()
    const res = await PATCH(makePatchRequest({ email: 'pas-email' }), { params })
    expect(res.status).toBe(400)
  })

  it('retourne 400 si linkedin pas URL http(s)', async () => {
    await setupSuccessfulPatch()
    const res = await PATCH(makePatchRequest({ linkedin: 'pas-url' }), { params })
    expect(res.status).toBe(400)
  })

  it('retourne 400 si telephone contient caractères invalides', async () => {
    await setupSuccessfulPatch()
    const res = await PATCH(makePatchRequest({ telephone: 'abc<>' }), { params })
    expect(res.status).toBe(400)
  })

  it('retourne 400 si body vide (aucun champ)', async () => {
    await setupSuccessfulPatch()
    const res = await PATCH(makePatchRequest({}), { params })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('INVALID_INPUT')
  })
})

describe('PATCH /api/prospects/[id]/contacts/[contactId] — update OK', () => {
  it('met à jour les champs fournis (200)', async () => {
    const captured = await setupSuccessfulPatch({
      updatedRow: {
        id: VALID_CONTACT_ID,
        nom: 'NOUVEAU',
        telephone: '06 12 34 56 78',
      },
    })
    const res = await PATCH(
      makePatchRequest({ nom: 'NOUVEAU', telephone: '06 12 34 56 78' }),
      { params },
    )
    expect(res.status).toBe(200)
    expect(captured.updatePayload?.nom).toBe('NOUVEAU')
    expect(captured.updatePayload?.telephone).toBe('06 12 34 56 78')
    const body = (await res.json()) as { data?: { nom?: string } }
    expect(body.data?.nom).toBe('NOUVEAU')
  })

  it('normalise une chaîne vide en null', async () => {
    const captured = await setupSuccessfulPatch()
    const res = await PATCH(
      makePatchRequest({ email: '', linkedin: '' }),
      { params },
    )
    expect(res.status).toBe(200)
    expect(captured.updatePayload?.email).toBeNull()
    expect(captured.updatePayload?.linkedin).toBeNull()
  })

  it('retourne 500 si update échoue', async () => {
    await setupSuccessfulPatch({
      updateError: { message: 'fail' },
    })
    const res = await PATCH(makePatchRequest({ nom: 'X' }), { params })
    expect(res.status).toBe(500)
  })
})

// ============================================================
// DELETE
// ============================================================

describe('DELETE /api/prospects/[id]/contacts/[contactId]', () => {
  it('retourne 401 sans session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await DELETE(makeDeleteRequest(), { params })
    expect(res.status).toBe(401)
  })

  it('retourne 404 si contact introuvable', async () => {
    await setupSuccessfulDelete({ contactRow: null })
    const res = await DELETE(makeDeleteRequest(), { params })
    expect(res.status).toBe(404)
  })

  it('supprime le contact (200, deleted=true)', async () => {
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
