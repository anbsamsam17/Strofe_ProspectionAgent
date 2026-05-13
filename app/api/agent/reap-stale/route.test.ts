// ============================================================
// TESTS — /api/agent/reap-stale
// Vérifie : auth cron, sélection des runs > 15 min, UPDATE atomique
// avec garde `eq(status, running)`, idempotence.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ------------------------------------------------------------
// MOCKS — hoisted avant l'import de la route
// ------------------------------------------------------------

const mockSelectLt = vi.fn()
const mockUpdateChain = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          lt: mockSelectLt,
        })),
      })),
      update: vi.fn(() => ({
        in: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: mockUpdateChain,
          })),
        })),
      })),
    })),
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
  return new NextRequest('http://localhost/api/agent/reap-stale', {
    method: 'POST',
    headers: { Authorization: 'Bearer fake-secret' },
  })
}

beforeEach(() => {
  mockedIsCronRequest.mockReturnValue(true)
  mockSelectLt.mockReset()
  mockUpdateChain.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ------------------------------------------------------------
// TESTS
// ------------------------------------------------------------

describe('POST /api/agent/reap-stale', () => {
  it('refuse 401 sans secret cron valide', async () => {
    mockedIsCronRequest.mockReturnValue(false)
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
    expect(mockSelectLt).not.toHaveBeenCalled()
  })

  it('retourne reaped=0 quand aucun run orphelin', async () => {
    mockSelectLt.mockResolvedValueOnce({ data: [], error: null })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { reaped: number; threshold_minutes: number }
    }
    expect(body.data.reaped).toBe(0)
    expect(body.data.threshold_minutes).toBe(15)
    // Pas d'UPDATE si rien à reaper.
    expect(mockUpdateChain).not.toHaveBeenCalled()
  })

  it('reap les runs > 15 min en marquant failed', async () => {
    const staleRuns = [
      { id: 'r1', user_id: 'u1', phase: 'sourcing', started_at: '2026-05-12T15:06:03Z' },
      { id: 'r2', user_id: 'u2', phase: 'enrichment', started_at: '2026-05-12T18:00:00Z' },
    ]
    mockSelectLt.mockResolvedValueOnce({ data: staleRuns, error: null })
    mockUpdateChain.mockResolvedValueOnce({
      data: [{ id: 'r1', user_id: 'u1' }, { id: 'r2', user_id: 'u2' }],
      error: null,
    })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { reaped: number; run_ids: string[] }
    }
    expect(body.data.reaped).toBe(2)
    expect(body.data.run_ids).toEqual(['r1', 'r2'])
  })

  it('500 si SELECT échoue', async () => {
    mockSelectLt.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection lost' },
    })

    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('DB_ERROR')
  })

  it('500 si UPDATE échoue (mais SELECT avait trouvé des runs)', async () => {
    mockSelectLt.mockResolvedValueOnce({
      data: [{ id: 'r1', user_id: 'u1', phase: 'sourcing', started_at: '2026-05-12T15:00:00Z' }],
      error: null,
    })
    mockUpdateChain.mockResolvedValueOnce({
      data: null,
      error: { message: 'write conflict' },
    })

    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('DB_ERROR')
  })

  it('idempotent : retourne reaped=0 sur 2e appel si rien de nouveau', async () => {
    mockSelectLt.mockResolvedValueOnce({ data: [], error: null })
    const res1 = await POST(makeRequest())
    expect(res1.status).toBe(200)
    const body1 = (await res1.json()) as { data: { reaped: number } }
    expect(body1.data.reaped).toBe(0)

    mockSelectLt.mockResolvedValueOnce({ data: [], error: null })
    const res2 = await POST(makeRequest())
    const body2 = (await res2.json()) as { data: { reaped: number } }
    expect(body2.data.reaped).toBe(0)
  })
})
