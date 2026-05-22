// ============================================================
// TESTS — POST /api/prospects/import (GLN-060)
// ------------------------------------------------------------
// Couvre :
//   - 401 si pas authentifié.
//   - 400 si body JSON invalide.
//   - 400 INVALID_INPUT si > 100 SIREN ou note > 200 char.
//   - 200 OK avec comptage created/updated/errors.
//   - Regex SIREN : 9 chiffres OK, alphanumérique ou < 9 chars rejeté.
//   - Dedup interne : doublons dans la liste source non comptés en erreur.
//   - Upsert idempotent (siren existant → updated++).
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks AVANT import de la route ───────────────────────────────────────────

const mockGetUser = vi.fn()
const mockUpsert = vi.fn()
const mockIn = vi.fn()
const mockEq = vi.fn()

// Mock Recherche Entreprises : retourne une raison sociale fixe pour les
// SIREN valides, null pour le SIREN '999999999' (simulation "inconnu de l'API").
vi.mock('@/lib/agent/sources/recherche-entreprises-dirigeants', () => ({
  fetchRechercheEntreprisesData: vi.fn(async (siren: string) => {
    if (siren === '999999999') return null
    return {
      siren,
      raisonSociale: `Société Test ${siren}`,
      dirigeants: [],
      dirigeantPrincipal: null,
      siege: {
        adresse: '1 rue de Test',
        codePostal: '75001',
        commune: 'Paris',
        telephone: null,
        email: null,
        siteWeb: null,
      },
    }
  }),
}))

// Mock ADEME : on ne retourne jamais rien — focus sur le pipeline d'import.
vi.mock('@/lib/agent/sourcing', () => ({
  verifierBegesAdeme: vi.fn(async () => null),
}))

// Mock scoring (pas de dépendance lourde dans les tests).
vi.mock('@/lib/agent/scoring', () => ({
  calculerScore: vi.fn(() => 50),
  determinerPriorite: vi.fn(() => 'moyenne'),
}))

// Supabase mock — chaque appel `from('prospects')` retourne un builder dynamique.
// On expose mockUpsert et mockIn/mockEq pour assertions.
let existingSirens: string[] = []
let upsertError: { message: string } | null = null

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn((_table: string) => {
      // Renvoie un objet avec select(), upsert(), in(), eq() qui sont eux-mêmes
      // chainables / thenables.
      const builder: Record<string, unknown> = {}
      builder.select = vi.fn(() => {
        mockIn.mockClear()
        mockEq.mockClear()
        const sub: Record<string, unknown> = {}
        sub.in = vi.fn((..._args: unknown[]) => {
          mockIn(..._args)
          return Promise.resolve({
            data: existingSirens.map((s) => ({ siren: s })),
            error: null,
          })
        })
        sub.eq = vi.fn((..._args: unknown[]) => {
          mockEq(..._args)
          // .eq() chainable — pour la query do_not_contact on retourne []
          return Promise.resolve({ data: [], error: null })
        })
        return sub
      })
      builder.upsert = vi.fn((rows: unknown, opts: unknown) => {
        mockUpsert(rows, opts)
        return Promise.resolve({ error: upsertError })
      })
      return builder
    }),
  })),
}))

// Imports APRÈS vi.mock
import { POST } from './route'
import { NextRequest } from 'next/server'

const VALID_USER_ID = '11111111-1111-1111-1111-111111111111'

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/prospects/import', {
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
  mockUpsert.mockClear()
  mockIn.mockClear()
  mockEq.mockClear()
  existingSirens = []
  upsertError = null
})

afterEach(() => {
  vi.clearAllMocks()
})

// ── Auth ─────────────────────────────────────────────────────────────────────

describe('POST /api/prospects/import — auth', () => {
  it('renvoie 401 si pas de session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await POST(makeReq({ sirens: ['123456789'] }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })
})

// ── Validation ───────────────────────────────────────────────────────────────

describe('POST /api/prospects/import — validation', () => {
  it('renvoie 400 INVALID_JSON si body non JSON', async () => {
    const req = new NextRequest('http://localhost/api/prospects/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'pas-du-json{',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_JSON')
  })

  it('renvoie 400 si liste sirens vide', async () => {
    const res = await POST(makeReq({ sirens: [] }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('renvoie 400 si > 100 SIREN', async () => {
    const sirens = Array.from({ length: 101 }, (_, i) =>
      String(i).padStart(9, '0'),
    )
    const res = await POST(makeReq({ sirens }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('renvoie 400 si note > 200 caractères', async () => {
    const longNote = 'a'.repeat(201)
    const res = await POST(makeReq({ sirens: ['123456789'], note: longNote }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_INPUT')
  })
})

// ── Normalisation SIREN ──────────────────────────────────────────────────────

describe('POST /api/prospects/import — normalisation SIREN', () => {
  it('rejette SIREN à 8 chiffres', async () => {
    const res = await POST(makeReq({ sirens: ['12345678'] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.errors).toHaveLength(1)
    expect(body.data.errors[0].siren).toBe('12345678')
    expect(body.data.created).toBe(0)
  })

  it('rejette SIREN alphanumérique', async () => {
    const res = await POST(makeReq({ sirens: ['ABC123456'] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.errors).toHaveLength(1)
    expect(body.data.errors[0].reason).toContain('SIREN invalide')
  })

  it('accepte SIREN avec espaces / tirets et les normalise', async () => {
    const res = await POST(makeReq({ sirens: ['123 456 789'] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.errors).toHaveLength(0)
    expect(body.data.created).toBe(1)
    // Vérifie qu'on upsert avec le SIREN nettoyé (sans espaces)
    expect(mockUpsert).toHaveBeenCalled()
    const upsertedRows = mockUpsert.mock.calls[0][0] as Array<{ siren: string }>
    expect(upsertedRows[0].siren).toBe('123456789')
  })

  it('dédup les doublons silencieusement dans la liste source', async () => {
    const res = await POST(
      makeReq({ sirens: ['123456789', '123456789', '987654321'] }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.errors).toHaveLength(0)
    // 2 SIREN uniques → 2 upserts
    expect(body.data.created).toBe(2)
  })
})

// ── Comptage created vs updated ──────────────────────────────────────────────

describe('POST /api/prospects/import — comptage', () => {
  it('compte "created" pour un SIREN absent en base', async () => {
    existingSirens = []
    const res = await POST(makeReq({ sirens: ['123456789'] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.created).toBe(1)
    expect(body.data.updated).toBe(0)
  })

  it('compte "updated" pour un SIREN déjà en base (idempotent)', async () => {
    existingSirens = ['123456789']
    const res = await POST(makeReq({ sirens: ['123456789'] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.created).toBe(0)
    expect(body.data.updated).toBe(1)
  })
})

// ── Erreur DB ────────────────────────────────────────────────────────────────

describe('POST /api/prospects/import — erreur DB', () => {
  it('renvoie 500 DB_ERROR si upsert échoue', async () => {
    upsertError = { message: 'unique violation' }
    const res = await POST(makeReq({ sirens: ['123456789'] }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.code).toBe('DB_ERROR')
  })
})

// ── Note d'import ────────────────────────────────────────────────────────────

describe('POST /api/prospects/import — note', () => {
  it('préfixe la note avec "[import] " dans le champ notes', async () => {
    await POST(
      makeReq({ sirens: ['123456789'], note: 'Pollutec 2026' }),
    )
    expect(mockUpsert).toHaveBeenCalled()
    const upsertedRows = mockUpsert.mock.calls[0][0] as Array<{ notes?: string }>
    expect(upsertedRows[0].notes).toBe('[import] Pollutec 2026')
  })

  it('omet le champ notes si aucune note fournie', async () => {
    await POST(makeReq({ sirens: ['123456789'] }))
    expect(mockUpsert).toHaveBeenCalled()
    const upsertedRows = mockUpsert.mock.calls[0][0] as Array<{ notes?: string }>
    expect(upsertedRows[0].notes).toBeUndefined()
  })
})
