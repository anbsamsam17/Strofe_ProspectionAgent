// ============================================================
// TESTS UNITAIRES — /api/admin/sirene-import
//
// Cas couverts :
//   1. Auth invalide (pas de header, header tronqué) → 401
//   2. Auth valide → 200 + message d'instructions + current_status
//   3. DB error sur la lecture de la vue → 500
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ------------------------------------------------------------
// MOCKS — hoistés avant l'import de la route
// ------------------------------------------------------------

let selectResult: {
  data: {
    total_size: string | null
    total_bytes: number | null
    active_count: number | null
    last_import_at: string | null
  } | null
  error: { message: string } | null
} = { data: null, error: null }

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve(selectResult)),
      })),
    })),
  })),
}))

vi.mock('@/lib/auth/cron', () => ({
  isCronRequest: vi.fn(),
}))

// ------------------------------------------------------------
// IMPORTS APRÈS MOCKS
// ------------------------------------------------------------

import { POST } from './route'
import { isCronRequest } from '@/lib/auth/cron'

const mockedIsCronRequest = isCronRequest as unknown as ReturnType<typeof vi.fn>

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function makeRequest(authHeader: string | null = 'Bearer fake-secret'): NextRequest {
  const headers = new Headers()
  if (authHeader) headers.set('authorization', authHeader)
  return new NextRequest('http://localhost/api/admin/sirene-import', {
    method: 'POST',
    headers,
  })
}

beforeEach(() => {
  mockedIsCronRequest.mockReset()
  mockedIsCronRequest.mockReturnValue(true)
  selectResult = {
    data: {
      total_size: '42 MB',
      total_bytes: 44_040_192,
      active_count: 1_500_000,
      last_import_at: '2026-05-15T03:00:00Z',
    },
    error: null,
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

// ------------------------------------------------------------
// TESTS
// ------------------------------------------------------------

describe('POST /api/admin/sirene-import', () => {
  it('refuse 401 sans token cron valide', async () => {
    mockedIsCronRequest.mockReturnValue(false)

    const res = await POST(makeRequest(null))
    const body = (await res.json()) as { error: { code: string } }

    expect(res.status).toBe(401)
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('refuse 401 avec un Bearer incorrect', async () => {
    mockedIsCronRequest.mockReturnValue(false)

    const res = await POST(makeRequest('Bearer mauvais-secret'))

    expect(res.status).toBe(401)
  })

  it('200 avec token valide : retourne message d\'instructions + current_status', async () => {
    mockedIsCronRequest.mockReturnValue(true)

    const res = await POST(makeRequest())
    const body = (await res.json()) as {
      data: {
        message: string
        current_status: {
          total_size: string | null
          total_bytes: number | null
          active_count: number | null
          last_import_at: string | null
        }
        command_local: string
        command_gh_actions: string
      }
    }

    expect(res.status).toBe(200)
    expect(body.data.message).toMatch(/GitHub Actions|local/i)
    expect(body.data.command_local).toBe('npm run import-sirene')
    expect(body.data.command_gh_actions).toBe('gh workflow run sirene-import.yml')
    expect(body.data.current_status).toEqual({
      total_size: '42 MB',
      total_bytes: 44_040_192,
      active_count: 1_500_000,
      last_import_at: '2026-05-15T03:00:00Z',
    })
  })

  it('500 si la lecture de la vue sirene_cache_size échoue', async () => {
    mockedIsCronRequest.mockReturnValue(true)
    selectResult = { data: null, error: { message: 'view not found' } }

    const res = await POST(makeRequest())
    const body = (await res.json()) as { error: { code: string; message: string } }

    expect(res.status).toBe(500)
    expect(body.error.code).toBe('DB_ERROR')
    expect(body.error.message).toBe('view not found')
  })
})
