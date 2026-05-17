// ============================================================
// TESTS UNITAIRES — /api/admin/sirene-status
//
// Cas couverts :
//   1. Sans auth (ni cron, ni session) → 401
//   2. Auth via CRON_SECRET → 200 + data complète
//   3. Auth via session user → 200 + data complète
//   4. DB error → 500
//   5. Freshness — fresh / aging / stale calculée correctement
//   6. Empty cache (active_count = 0) → is_empty: true + freshness: stale
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
    days_since_import: number | null
  } | null
  error: { message: string } | null
} = { data: null, error: null }

let sessionUser: { id: string } | null = null

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve(selectResult)),
      })),
    })),
  })),
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: vi.fn(() => Promise.resolve({ data: { user: sessionUser } })),
      },
    }),
  ),
}))

vi.mock('@/lib/auth/cron', () => ({
  isCronRequest: vi.fn(),
}))

// ------------------------------------------------------------
// IMPORTS APRÈS MOCKS
// ------------------------------------------------------------

import { GET } from './route'
import { isCronRequest } from '@/lib/auth/cron'

const mockedIsCronRequest = isCronRequest as unknown as ReturnType<typeof vi.fn>

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function makeRequest(authHeader: string | null = null): NextRequest {
  const headers = new Headers()
  if (authHeader) headers.set('authorization', authHeader)
  return new NextRequest('http://localhost/api/admin/sirene-status', {
    method: 'GET',
    headers,
  })
}

function defaultRow(overrides: Partial<NonNullable<typeof selectResult.data>> = {}) {
  return {
    total_size: '42 MB',
    total_bytes: 44_040_192,
    active_count: 1_500_000,
    last_import_at: '2026-05-15T03:00:00Z',
    days_since_import: 2,
    ...overrides,
  }
}

beforeEach(() => {
  mockedIsCronRequest.mockReset()
  mockedIsCronRequest.mockReturnValue(false)
  sessionUser = null
  selectResult = { data: defaultRow(), error: null }
})

afterEach(() => {
  vi.clearAllMocks()
})

// ------------------------------------------------------------
// TESTS
// ------------------------------------------------------------

describe('GET /api/admin/sirene-status — auth', () => {
  it('refuse 401 sans auth (ni cron, ni session)', async () => {
    mockedIsCronRequest.mockReturnValue(false)
    sessionUser = null

    const res = await GET(makeRequest())
    const body = (await res.json()) as { error: { code: string } }

    expect(res.status).toBe(401)
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('200 avec un Bearer CRON_SECRET valide (mode cron)', async () => {
    mockedIsCronRequest.mockReturnValue(true)
    sessionUser = null

    const res = await GET(makeRequest('Bearer fake-secret'))
    const body = (await res.json()) as { data: { active_count: number } }

    expect(res.status).toBe(200)
    expect(body.data.active_count).toBe(1_500_000)
  })

  it('200 avec une session user (mode UI)', async () => {
    mockedIsCronRequest.mockReturnValue(false)
    sessionUser = { id: 'user-123' }

    const res = await GET(makeRequest())
    const body = (await res.json()) as { data: { active_count: number } }

    expect(res.status).toBe(200)
    expect(body.data.active_count).toBe(1_500_000)
  })
})

describe('GET /api/admin/sirene-status — payload', () => {
  it('500 si la lecture de la vue échoue', async () => {
    mockedIsCronRequest.mockReturnValue(true)
    selectResult = { data: null, error: { message: 'view missing' } }

    const res = await GET(makeRequest('Bearer fake-secret'))
    const body = (await res.json()) as { error: { code: string; message: string } }

    expect(res.status).toBe(500)
    expect(body.error.code).toBe('DB_ERROR')
    expect(body.error.message).toBe('view missing')
  })

  it('retourne toutes les colonnes attendues', async () => {
    mockedIsCronRequest.mockReturnValue(true)
    selectResult = { data: defaultRow({ days_since_import: 12 }), error: null }

    const res = await GET(makeRequest('Bearer fake-secret'))
    const body = (await res.json()) as {
      data: {
        total_size: string | null
        total_bytes: number | null
        active_count: number | null
        last_import_at: string | null
        days_since_import: number | null
        freshness: string
        is_empty: boolean
      }
    }

    expect(res.status).toBe(200)
    expect(body.data.total_size).toBe('42 MB')
    expect(body.data.total_bytes).toBe(44_040_192)
    expect(body.data.active_count).toBe(1_500_000)
    expect(body.data.last_import_at).toBe('2026-05-15T03:00:00Z')
    expect(body.data.days_since_import).toBe(12)
  })
})

describe('GET /api/admin/sirene-status — freshness', () => {
  it('freshness=fresh quand days_since_import < 30', async () => {
    mockedIsCronRequest.mockReturnValue(true)
    selectResult = { data: defaultRow({ days_since_import: 5 }), error: null }

    const res = await GET(makeRequest('Bearer fake-secret'))
    const body = (await res.json()) as { data: { freshness: string } }

    expect(body.data.freshness).toBe('fresh')
  })

  it('freshness=fresh à la borne basse (0 jour)', async () => {
    mockedIsCronRequest.mockReturnValue(true)
    selectResult = { data: defaultRow({ days_since_import: 0 }), error: null }

    const res = await GET(makeRequest('Bearer fake-secret'))
    const body = (await res.json()) as { data: { freshness: string } }

    expect(body.data.freshness).toBe('fresh')
  })

  it('freshness=aging quand 30 <= days < 60', async () => {
    mockedIsCronRequest.mockReturnValue(true)
    selectResult = { data: defaultRow({ days_since_import: 30 }), error: null }

    const res = await GET(makeRequest('Bearer fake-secret'))
    const body = (await res.json()) as { data: { freshness: string } }

    expect(body.data.freshness).toBe('aging')
  })

  it('freshness=aging à 45 jours', async () => {
    mockedIsCronRequest.mockReturnValue(true)
    selectResult = { data: defaultRow({ days_since_import: 45 }), error: null }

    const res = await GET(makeRequest('Bearer fake-secret'))
    const body = (await res.json()) as { data: { freshness: string } }

    expect(body.data.freshness).toBe('aging')
  })

  it('freshness=stale quand days >= 60', async () => {
    mockedIsCronRequest.mockReturnValue(true)
    selectResult = { data: defaultRow({ days_since_import: 60 }), error: null }

    const res = await GET(makeRequest('Bearer fake-secret'))
    const body = (await res.json()) as { data: { freshness: string } }

    expect(body.data.freshness).toBe('stale')
  })

  it('freshness=stale quand days_since_import est NULL (cache jamais importé)', async () => {
    mockedIsCronRequest.mockReturnValue(true)
    selectResult = {
      data: defaultRow({ days_since_import: null, active_count: 0 }),
      error: null,
    }

    const res = await GET(makeRequest('Bearer fake-secret'))
    const body = (await res.json()) as { data: { freshness: string } }

    expect(body.data.freshness).toBe('stale')
  })
})

describe('GET /api/admin/sirene-status — empty cache', () => {
  it('is_empty=true quand active_count = 0', async () => {
    mockedIsCronRequest.mockReturnValue(true)
    selectResult = {
      data: defaultRow({ active_count: 0, days_since_import: null }),
      error: null,
    }

    const res = await GET(makeRequest('Bearer fake-secret'))
    const body = (await res.json()) as { data: { is_empty: boolean } }

    expect(body.data.is_empty).toBe(true)
  })

  it('is_empty=true quand active_count est NULL', async () => {
    mockedIsCronRequest.mockReturnValue(true)
    selectResult = {
      data: defaultRow({ active_count: null }),
      error: null,
    }

    const res = await GET(makeRequest('Bearer fake-secret'))
    const body = (await res.json()) as { data: { is_empty: boolean } }

    expect(body.data.is_empty).toBe(true)
  })

  it('is_empty=false quand active_count > 0', async () => {
    mockedIsCronRequest.mockReturnValue(true)
    selectResult = {
      data: defaultRow({ active_count: 1_500_000 }),
      error: null,
    }

    const res = await GET(makeRequest('Bearer fake-secret'))
    const body = (await res.json()) as { data: { is_empty: boolean } }

    expect(body.data.is_empty).toBe(false)
  })
})
