// ============================================================
// TESTS — POST /api/prospects/[id]/enrich
// Mock complet du client Supabase SSR + de enrichirContact (pas d'appel réel
// Pappers/Hunter/INPI/RE).
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// ------------------------------------------------------------
// MOCKS — DOIVENT être déclarés AVANT l'import de la route.
// ------------------------------------------------------------

const mockGetUser = vi.fn()
const mockProspectMaybeSingle = vi.fn() // .from('prospects').select.eq.maybeSingle
const mockUpdateEq = vi.fn()             // .from('prospects').update.eq

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: mockProspectMaybeSingle,
        })),
      })),
      update: vi.fn(() => ({
        eq: mockUpdateEq,
      })),
    })),
  })),
}))

const mockEnrichirContact = vi.fn()
vi.mock('@/lib/agent/contact-enrichment', () => ({
  enrichirContact: (...args: unknown[]) => mockEnrichirContact(...args),
}))

// Imports APRÈS vi.mock.
import { POST } from './route'
import { NextRequest } from 'next/server'

const VALID_USER_ID = '11111111-1111-1111-1111-111111111111'
const VALID_PROSPECT_ID = '22222222-2222-4222-a222-222222222222'

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/prospects/' + VALID_PROSPECT_ID + '/enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}

const params = Promise.resolve({ id: VALID_PROSPECT_ID })

beforeEach(() => {
  mockGetUser.mockResolvedValue({
    data: { user: { id: VALID_USER_ID } },
    error: null,
  })
  mockProspectMaybeSingle.mockReset()
  mockUpdateEq.mockReset()
  mockEnrichirContact.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ------------------------------------------------------------

describe('POST /api/prospects/[id]/enrich — sécurité', () => {
  it('renvoie 401 sans session', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error.code).toBe('UNAUTHENTICATED')
  })

  it('renvoie 400 sur id non UUID', async () => {
    const badParams = Promise.resolve({ id: 'pas-un-uuid' })
    const res = await POST(makeRequest(), { params: badParams })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('INVALID_INPUT')
  })

  it('renvoie 404 quand le prospect n\'existe pas', async () => {
    mockProspectMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error.code).toBe('NOT_FOUND')
  })

  it('renvoie 400 si le prospect n\'a pas de SIREN', async () => {
    mockProspectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_PROSPECT_ID,
        siren: null,
        raison_sociale: 'Acme',
      },
      error: null,
    })
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('INVALID_INPUT')
  })
})

describe('POST /api/prospects/[id]/enrich — cascade', () => {
  it('renvoie 200 avec added=[] si la cascade ne retourne rien', async () => {
    mockProspectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_PROSPECT_ID,
        siren: '123456789',
        raison_sociale: 'Acme SAS',
      },
      error: null,
    })
    mockEnrichirContact.mockResolvedValueOnce({})

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.added).toEqual([])
    expect(json.data.reason).toBe('no_new_data')
    // Pas d'UPDATE si rien à appliquer
    expect(mockUpdateEq).not.toHaveBeenCalled()
  })

  it('met à jour le prospect avec les champs trouvés et retourne les sources', async () => {
    mockProspectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_PROSPECT_ID,
        siren: '123456789',
        raison_sociale: 'Acme SAS',
        contact_email: null,
        contact_telephone: null,
      },
      error: null,
    })
    mockEnrichirContact.mockResolvedValueOnce({
      contact_email: 'jean.dupont@acme.example',
      contact_telephone: '01 23 45 67 89',
    })
    mockUpdateEq.mockResolvedValueOnce({ data: null, error: null })

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.added).toContain('contact_email')
    expect(json.data.added).toContain('contact_telephone')
    expect(json.data.sources).toContain('pappers')
    expect(json.data.sources).toContain('hunter')
    // UPDATE déclenché
    expect(mockUpdateEq).toHaveBeenCalledTimes(1)
  })

  it('filtre l\'email perso (gmail) ajouté par la cascade', async () => {
    mockProspectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_PROSPECT_ID,
        siren: '123456789',
        raison_sociale: 'Acme SAS',
      },
      error: null,
    })
    // La cascade retourne UNIQUEMENT un email perso — doit être filtré.
    mockEnrichirContact.mockResolvedValueOnce({
      contact_email: 'random@gmail.com',
    })

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.added).toEqual([])
    expect(json.data.reason).toBe('email_perso_filtered')
    expect(mockUpdateEq).not.toHaveBeenCalled()
  })

  it('renvoie 503 quand la cascade jette une erreur "quota"', async () => {
    mockProspectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_PROSPECT_ID,
        siren: '123456789',
        raison_sociale: 'Acme SAS',
      },
      error: null,
    })
    mockEnrichirContact.mockRejectedValueOnce(
      new Error('Pappers quota exhausted (HTTP 401)'),
    )

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error.code).toBe('EXTERNAL_API_ERROR')
    expect(json.error.message).toMatch(/Quota.*épuisé/i)
  })

  it('renvoie 500 sur erreur inattendue', async () => {
    mockProspectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_PROSPECT_ID,
        siren: '123456789',
        raison_sociale: 'Acme SAS',
      },
      error: null,
    })
    mockEnrichirContact.mockRejectedValueOnce(new Error('boom'))

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error.code).toBe('INTERNAL_ERROR')
  })
})

// ------------------------------------------------------------
// Cas spécifique : capture l'updatePayload via implementation custom
// ------------------------------------------------------------

describe('POST /api/prospects/[id]/enrich — payload UPDATE', () => {
  it('passe les nouveaux champs (string|null) à supabase.update', async () => {
    let capturedUpdate: Record<string, unknown> | undefined

    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as unknown as Mock).mockImplementationOnce(async () => ({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: VALID_PROSPECT_ID,
                siren: '123456789',
                raison_sociale: 'Acme SAS',
              },
              error: null,
            }),
          })),
        })),
        update: vi.fn((payload: Record<string, unknown>) => {
          capturedUpdate = payload
          return {
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }),
      })),
    }))

    mockEnrichirContact.mockResolvedValueOnce({
      contact_nom: 'DUPONT',
      contact_prenom: 'Jean',
    })

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    expect(capturedUpdate).toBeDefined()
    expect(capturedUpdate).toEqual({
      contact_nom: 'DUPONT',
      contact_prenom: 'Jean',
    })
  })
})
