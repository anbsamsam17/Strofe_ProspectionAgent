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
const mockContactsSelectEq = vi.fn()      // .from('prospect_contacts').select.eq
const mockContactsDeleteIn = vi.fn()      // .from('prospect_contacts').delete.in
const mockLegacyUpdateEq = vi.fn()        // .from('prospects').update.eq (legacy reset)

/**
 * Builder de client Supabase SSR mock. Permet de cibler la table par nom :
 *   - `prospects` : .select.eq.maybeSingle  +  .update.eq
 *   - `prospect_contacts` : .select.eq  +  .delete.in
 */
function makeSupabaseClient() {
  return {
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => {
      if (table === 'prospect_contacts') {
        return {
          select: vi.fn(() => ({
            eq: mockContactsSelectEq,
          })),
          delete: vi.fn(() => ({
            in: mockContactsDeleteIn,
          })),
        }
      }
      // table === 'prospects'
      // On utilise mockUpdateEq pour le 1er appel UPDATE (cleanup legacy + cascade).
      // Si forceReplace nettoie le legacy ET la cascade ajoute des champs,
      // on a 2 updates. Pour distinguer, mockLegacyUpdateEq.mockImplementationOnce
      // peut être utilisé dans les tests qui en ont besoin.
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: mockProspectMaybeSingle,
          })),
        })),
        update: vi.fn(() => ({
          eq: mockUpdateEq,
        })),
      }
    }),
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => makeSupabaseClient()),
  // Le rate-limiter (lib/rate-limit) est un no-op en test (NODE_ENV==='test')
  // et n'appelle donc JAMAIS ce client ; ce stub existe seulement pour que la
  // référence `createAdminClient` importée par la route soit définie.
  createAdminClient: vi.fn(() => ({})),
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

function makeRequest(body?: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/prospects/' + VALID_PROSPECT_ID + '/enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
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
  mockContactsSelectEq.mockReset()
  mockContactsDeleteIn.mockReset()
  mockLegacyUpdateEq.mockReset()

  // Par défaut : pas de contacts à supprimer (pour les tests qui n'activent
  // pas forceReplace, ces mocks ne sont jamais appelés de toute façon).
  mockContactsSelectEq.mockResolvedValue({ data: [], error: null })
  mockContactsDeleteIn.mockResolvedValue({ data: null, error: null })
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

  it('renvoie 400 sur body JSON malformé', async () => {
    const req = new NextRequest(
      'http://localhost/api/prospects/' + VALID_PROSPECT_ID + '/enrich',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not-json',
      },
    )
    const res = await POST(req, { params })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('INVALID_INPUT')
  })
})

describe('POST /api/prospects/[id]/enrich — cascade (forceReplace=false)', () => {
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
    expect(json.data.replaced).toBe(0)
    // Pas d'UPDATE si rien à appliquer
    expect(mockUpdateEq).not.toHaveBeenCalled()
    // Pas de DELETE non plus
    expect(mockContactsDeleteIn).not.toHaveBeenCalled()
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
// Cas forceReplace=true : nettoyage des contacts masqués AVANT cascade
// ------------------------------------------------------------

describe('POST /api/prospects/[id]/enrich — forceReplace=true', () => {
  it('supprime les contacts masqués puis lance la cascade', async () => {
    // Prospect avec contact_email [Masqué]
    mockProspectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_PROSPECT_ID,
        siren: '123456789',
        raison_sociale: 'Acme SAS',
        contact_email: '[Masqué]',
        contact_nom: '[Masqué]',
      },
      error: null,
    })
    // 2 contacts existants, 1 masqué + 1 normal
    mockContactsSelectEq.mockResolvedValueOnce({
      data: [
        {
          id: 'c1',
          nom: '[Masqué]',
          email: 'x@masque.local',
          telephone: null,
          email_is_pro: false,
          email_status: null,
        },
        {
          id: 'c2',
          nom: 'Dupont',
          prenom: 'Jean',
          email: 'jean@acme.fr',
          telephone: '0102030405',
          email_is_pro: true,
        },
      ],
      error: null,
    })
    mockContactsDeleteIn.mockResolvedValueOnce({ data: null, error: null })
    mockUpdateEq.mockResolvedValue({ data: null, error: null })
    mockEnrichirContact.mockResolvedValueOnce({
      contact_email: 'pierre.martin@acme.fr',
      contact_telephone: '01 02 03 04 05',
      contact_nom: 'MARTIN',
      contact_prenom: 'Pierre',
    })

    const res = await POST(makeRequest({ forceReplace: true }), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    // 1 contact masqué supprimé (le c2 normal est gardé)
    expect(mockContactsDeleteIn).toHaveBeenCalledTimes(1)
    expect(mockContactsDeleteIn).toHaveBeenCalledWith('id', ['c1'])
    expect(json.data.replaced).toBe(1)
    expect(json.data.legacyReset).toBe(true)
    expect(json.data.added).toContain('contact_email')
    expect(json.data.added).toContain('contact_telephone')
  })

  it('forceReplace=true sans aucun contact masqué : pas de DELETE, juste cascade', async () => {
    mockProspectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_PROSPECT_ID,
        siren: '123456789',
        raison_sociale: 'Acme SAS',
        contact_email: 'jean@acme.fr',
        contact_nom: 'Dupont',
        contact_telephone: '0102030405',
      },
      error: null,
    })
    // Tous les contacts existants sont OK
    mockContactsSelectEq.mockResolvedValueOnce({
      data: [
        {
          id: 'c1',
          nom: 'Dupont',
          prenom: 'Jean',
          email: 'jean@acme.fr',
          telephone: '0102030405',
          email_is_pro: true,
        },
      ],
      error: null,
    })
    mockEnrichirContact.mockResolvedValueOnce({}) // cascade retourne rien

    const res = await POST(makeRequest({ forceReplace: true }), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(mockContactsDeleteIn).not.toHaveBeenCalled()
    expect(json.data.replaced).toBe(0)
    expect(json.data.legacyReset).toBe(false)
  })

  it('forceReplace=true + masqués + cascade vide → reason=replaced_no_new_data', async () => {
    mockProspectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_PROSPECT_ID,
        siren: '123456789',
        raison_sociale: 'Acme SAS',
        contact_email: '[Masqué]',
        contact_nom: '[Masqué]',
      },
      error: null,
    })
    mockContactsSelectEq.mockResolvedValueOnce({
      data: [
        {
          id: 'c1',
          nom: '[Masqué]',
          email: null,
          telephone: null,
          email_is_pro: null,
        },
      ],
      error: null,
    })
    mockContactsDeleteIn.mockResolvedValueOnce({ data: null, error: null })
    mockUpdateEq.mockResolvedValue({ data: null, error: null })
    mockEnrichirContact.mockResolvedValueOnce({}) // rien trouvé

    const res = await POST(makeRequest({ forceReplace: true }), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.added).toEqual([])
    expect(json.data.reason).toBe('replaced_no_new_data')
    expect(json.data.replaced).toBe(1)
  })

  it('forceReplace=false : comportement actuel (pas de SELECT contacts)', async () => {
    mockProspectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_PROSPECT_ID,
        siren: '123456789',
        raison_sociale: 'Acme SAS',
      },
      error: null,
    })
    mockEnrichirContact.mockResolvedValueOnce({})

    const res = await POST(makeRequest({ forceReplace: false }), { params })
    expect(res.status).toBe(200)
    // Quand forceReplace=false, on ne lit même pas prospect_contacts.
    expect(mockContactsSelectEq).not.toHaveBeenCalled()
    expect(mockContactsDeleteIn).not.toHaveBeenCalled()
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
      from: vi.fn((table: string) => {
        if (table === 'prospect_contacts') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
            delete: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          }
        }
        return {
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
        }
      }),
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
