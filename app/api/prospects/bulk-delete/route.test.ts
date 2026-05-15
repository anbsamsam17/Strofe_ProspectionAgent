// ============================================================
// TESTS — POST /api/prospects/bulk-delete
// ------------------------------------------------------------
// Couvre :
//   - 401 si pas authentifié.
//   - 400 si body JSON invalide.
//   - 400 si Zod refuse le body (filters mal typés).
//   - 400 NO_FILTER si aucun filtre actif (garde-fou critique).
//   - 200 OK avec { data: { deleted: N } } si filtres valides.
//   - Chaque filtre est bien transmis à la chaîne Supabase.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mock Supabase SSR (avant l'import de la route) ───────────────────────────

const mockGetUser = vi.fn()
// Chainable builder mock — on enregistre chaque appel pour vérifier les filtres.
let chainCalls: Array<{ method: string; args: unknown[] }> = []
let chainCount = 0
let chainError: { message: string } | null = null

function makeChain() {
  // Chaque méthode de la chaîne pousse l'appel dans chainCalls et retourne
  // le même proxy pour rester chainable. La résolution finale (`await`) lit
  // `chainCount` + `chainError` (configurables par test).
  const handler: ProxyHandler<object> = {
    get(_target, prop: string) {
      // Permet de await la chaîne — thenable interface.
      if (prop === 'then') {
        return (resolve: (v: { error: typeof chainError; count: number }) => void) => {
          resolve({ error: chainError, count: chainCount })
        }
      }
      return (...args: unknown[]) => {
        chainCalls.push({ method: prop, args })
        return chain
      }
    },
  }
  const chain = new Proxy({}, handler)
  return chain
}

let chain = makeChain()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => chain),
  })),
}))

// Imports APRÈS vi.mock.
import { POST } from './route'
import { NextRequest } from 'next/server'

const VALID_USER_ID = '11111111-1111-1111-1111-111111111111'

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/prospects/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  mockGetUser.mockResolvedValue({
    data: { user: { id: VALID_USER_ID } },
    error: null,
  })
  chainCalls = []
  chainCount = 0
  chainError = null
  chain = makeChain()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ── Auth ─────────────────────────────────────────────────────────────────────

describe('POST /api/prospects/bulk-delete — auth', () => {
  it('renvoie 401 UNAUTHENTICATED si pas de session', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    })
    const res = await POST(makeReq({ filters: { statut: ['sourced'] } }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })
})

// ── Validation body ──────────────────────────────────────────────────────────

describe('POST /api/prospects/bulk-delete — validation', () => {
  it('renvoie 400 INVALID_JSON si le body n\'est pas du JSON', async () => {
    const req = new NextRequest('http://localhost/api/prospects/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'pas-du-json{',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_JSON')
  })

  it('renvoie 400 INVALID_INPUT si un statut hors enum', async () => {
    const res = await POST(makeReq({ filters: { statut: ['inconnu'] } }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('renvoie 400 NO_FILTER si aucun filtre actif (body filters vide)', async () => {
    const res = await POST(makeReq({ filters: {} }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('NO_FILTER')
  })

  it('renvoie 400 NO_FILTER si tous les filtres sont vides', async () => {
    const res = await POST(
      makeReq({
        filters: {
          statut: [],
          secteur: '',
          score_min: 0,
          archived: false,
          contact_type: [],
          beges: [],
        },
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('NO_FILTER')
  })
})

// ── Suppression ──────────────────────────────────────────────────────────────

describe('POST /api/prospects/bulk-delete — suppression', () => {
  it('renvoie 200 + { data: { deleted: N } } quand des filtres sont actifs', async () => {
    chainCount = 7

    const res = await POST(makeReq({ filters: { statut: ['sourced'] } }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.deleted).toBe(7)
  })

  it('applique le filtre statut via in()', async () => {
    chainCount = 2
    await POST(makeReq({ filters: { statut: ['sourced', 'qualified'] } }))
    const inCall = chainCalls.find((c) => c.method === 'in')
    expect(inCall).toBeDefined()
    expect(inCall?.args[0]).toBe('statut')
    expect(inCall?.args[1]).toEqual(['sourced', 'qualified'])
  })

  it('applique le filtre score_min via gte()', async () => {
    chainCount = 1
    await POST(makeReq({ filters: { score_min: 60 } }))
    const gteCall = chainCalls.find((c) => c.method === 'gte')
    expect(gteCall).toBeDefined()
    expect(gteCall?.args[0]).toBe('score_priorite')
    expect(gteCall?.args[1]).toBe(60)
  })

  it('applique le filtre secteur via ilike()', async () => {
    chainCount = 3
    await POST(makeReq({ filters: { secteur: 'industrie' } }))
    const ilikeCall = chainCalls.find((c) => c.method === 'ilike')
    expect(ilikeCall).toBeDefined()
    expect(ilikeCall?.args[0]).toBe('secteur_libelle')
    expect(ilikeCall?.args[1]).toContain('industrie')
  })

  it('applique le mode "archived=true" via not(archived_at, is, null)', async () => {
    chainCount = 4
    // archived=true seul n'est pas suffisant comme filtre actif côté garde-fou.
    // On le combine donc avec un autre filtre pour franchir le check NO_FILTER.
    await POST(makeReq({ filters: { archived: true, statut: ['sourced'] } }))
    const notCall = chainCalls.find((c) => c.method === 'not')
    expect(notCall).toBeDefined()
    expect(notCall?.args[0]).toBe('archived_at')
  })

  it('applique le mode "archived=false" via is(archived_at, null)', async () => {
    chainCount = 0
    await POST(makeReq({ filters: { statut: ['sourced'] } }))
    const isCall = chainCalls.find((c) => c.method === 'is')
    expect(isCall).toBeDefined()
    expect(isCall?.args[0]).toBe('archived_at')
    expect(isCall?.args[1]).toBeNull()
  })

  it('renvoie 500 DB_ERROR si Supabase renvoie une erreur', async () => {
    chainError = { message: 'pg connection lost' }
    const res = await POST(makeReq({ filters: { statut: ['sourced'] } }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.code).toBe('DB_ERROR')
  })
})
