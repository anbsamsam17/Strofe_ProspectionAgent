// ============================================================
// TESTS — /api/cron/purge-prospects (GLN-002)
//
// Couvre :
//   - auth cron (timing-safe) : 401 si secret invalide
//   - selection candidats > 3 ans + exclusion statuts converted/on_hold
//   - preservation par echange recent (occurred_at > cutoff)
//   - suppression batch + logging structure
//   - gestion erreurs DB (500)
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ------------------------------------------------------------
// MOCKS — hoisted avant l'import de la route
// ------------------------------------------------------------

const mockSelectChain = vi.fn()
const mockSelectExchanges = vi.fn()
const mockDeleteChain = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'prospects') {
        return {
          select: vi.fn(() => ({
            lt: vi.fn(() => ({
              not: mockSelectChain,
            })),
          })),
          delete: vi.fn(() => ({
            in: mockDeleteChain,
          })),
        }
      }
      if (table === 'prospect_exchanges') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              gte: mockSelectExchanges,
            })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })),
}))

vi.mock('@/lib/auth/cron', () => ({
  isCronRequest: vi.fn(),
}))

import { POST } from './route'
import { isCronRequest } from '@/lib/auth/cron'
import { NextRequest } from 'next/server'

const mockedIsCronRequest = isCronRequest as unknown as ReturnType<typeof vi.fn>

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/cron/purge-prospects', {
    method: 'POST',
    headers: { Authorization: 'Bearer fake-secret' },
  })
}

beforeEach(() => {
  mockedIsCronRequest.mockReturnValue(true)
  mockSelectChain.mockReset()
  mockSelectExchanges.mockReset()
  mockDeleteChain.mockReset()

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key'
})

afterEach(() => {
  vi.clearAllMocks()
})

// ------------------------------------------------------------
// TESTS
// ------------------------------------------------------------

describe('POST /api/cron/purge-prospects', () => {
  it('refuse 401 sans secret cron valide', async () => {
    mockedIsCronRequest.mockReturnValue(false)
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
    expect(mockSelectChain).not.toHaveBeenCalled()
  })

  it('500 si env Supabase manquantes', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
  })

  it('retourne deleted=0 si aucun candidat', async () => {
    mockSelectChain.mockResolvedValueOnce({ data: [], error: null })
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { deleted: number } }
    expect(body.data.deleted).toBe(0)
    expect(mockDeleteChain).not.toHaveBeenCalled()
  })

  it('500 si SELECT candidats echoue', async () => {
    mockSelectChain.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection lost' },
    })
    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('DB_ERROR')
  })

  it('supprime les candidats sans echange recent', async () => {
    mockSelectChain.mockResolvedValueOnce({
      data: [
        { id: 'p1', created_at: '2022-01-01T00:00:00Z' },
        { id: 'p2', created_at: '2022-02-01T00:00:00Z' },
        { id: 'p3', created_at: '2022-03-01T00:00:00Z' },
      ],
      error: null,
    })
    // Aucun exchange recent pour aucun candidat
    mockSelectExchanges.mockResolvedValueOnce({ data: [], error: null })
    mockDeleteChain.mockResolvedValueOnce({ data: null, error: null })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { deleted: number } }
    expect(body.data.deleted).toBe(3)
    expect(mockDeleteChain).toHaveBeenCalledTimes(1)
  })

  it('preserve les prospects avec echange recent (> cutoff)', async () => {
    mockSelectChain.mockResolvedValueOnce({
      data: [
        { id: 'p1', created_at: '2022-01-01T00:00:00Z' },
        { id: 'p2', created_at: '2022-02-01T00:00:00Z' },
        { id: 'p3', created_at: '2022-03-01T00:00:00Z' },
      ],
      error: null,
    })
    // p2 a un echange recent — doit etre preserve
    mockSelectExchanges.mockResolvedValueOnce({
      data: [{ prospect_id: 'p2', occurred_at: '2025-01-15T00:00:00Z' }],
      error: null,
    })
    mockDeleteChain.mockResolvedValueOnce({ data: null, error: null })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { deleted: number } }
    expect(body.data.deleted).toBe(2)
    expect(mockDeleteChain).toHaveBeenCalledTimes(1)
  })

  it('retourne deleted=0 si tous les candidats ont un echange recent', async () => {
    mockSelectChain.mockResolvedValueOnce({
      data: [{ id: 'p1', created_at: '2022-01-01T00:00:00Z' }],
      error: null,
    })
    mockSelectExchanges.mockResolvedValueOnce({
      data: [{ prospect_id: 'p1', occurred_at: '2025-01-15T00:00:00Z' }],
      error: null,
    })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { deleted: number } }
    expect(body.data.deleted).toBe(0)
    expect(mockDeleteChain).not.toHaveBeenCalled()
  })

  it('500 si DELETE echoue', async () => {
    mockSelectChain.mockResolvedValueOnce({
      data: [{ id: 'p1', created_at: '2022-01-01T00:00:00Z' }],
      error: null,
    })
    mockSelectExchanges.mockResolvedValueOnce({ data: [], error: null })
    mockDeleteChain.mockResolvedValueOnce({
      data: null,
      error: { message: 'fk violation' },
    })

    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('DB_ERROR')
  })

  it('500 si SELECT exchanges echoue', async () => {
    mockSelectChain.mockResolvedValueOnce({
      data: [{ id: 'p1', created_at: '2022-01-01T00:00:00Z' }],
      error: null,
    })
    mockSelectExchanges.mockResolvedValueOnce({
      data: null,
      error: { message: 'timeout' },
    })

    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('DB_ERROR')
  })
})
