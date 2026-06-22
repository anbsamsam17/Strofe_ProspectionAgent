// ============================================================
// TESTS — POST /api/email/send (GLN-020 + GLN-003)
// Mock Supabase SSR + Resend (jamais d'envoi réel).
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// ------------------------------------------------------------
// MOCKS — DOIVENT être hoistés AVANT l'import de la route.
// ------------------------------------------------------------

const mockGetUser = vi.fn()
const mockResendSend = vi.fn()

// État partagé entre les tests — réécrit dans beforeEach.
type FromHandlers = Record<string, () => Record<string, unknown>>
const fromHandlers: { current: FromHandlers } = { current: {} }

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => {
      const handler = fromHandlers.current[table]
      if (!handler) throw new Error(`Unmocked table: ${table}`)
      return handler()
    }),
  })),
}))

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: mockResendSend },
  })),
}))

// Stub generateOptOutToken pour éviter besoin de l'env OPT_OUT_HMAC_SECRET.
vi.mock('@/lib/auth/opt-out-token', () => ({
  generateOptOutToken: vi.fn(() => 'mocked.opt.out.token'),
}))

// Imports APRÈS vi.mock.
import { POST } from './route'
import { NextRequest } from 'next/server'

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

const USER_ID = '11111111-1111-1111-1111-111111111111'
const PROSPECT_ID = '22222222-2222-4222-a222-222222222222'
const CONTACT_ID = '33333333-3333-4333-a333-333333333333'

const VALID_BODY = {
  prospectId: PROSPECT_ID,
  contactId: CONTACT_ID,
  subject: 'Bonjour {{prenom}}',
  body: 'Salut, {{raison_sociale}} doit faire son BEGES.',
  templateKey: 'daf',
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

interface SetupOptions {
  prospect?: Record<string, unknown> | null
  contact?: Record<string, unknown> | null
  profile?: Record<string, unknown> | null
  exchangeError?: { message: string } | null
  updateError?: { message: string } | null
  /** Nb d'emails déjà envoyés à ce prospect — utilise pour le fallback
   *  isFirstContact via count prospect_exchanges. Défaut 0. */
  priorEmailCount?: number
  /** Ligne opt_out renvoyée par isOptedOut (siren ET email). `null` (défaut) =
   *  destinataire NON désinscrit → envoi autorisé. */
  optOutRow?: { id: string } | null
  /** Force une erreur DB sur la table opt_out (test fail-closed). */
  optOutDbError?: { message: string } | null
}

function setupHandlers(opts: SetupOptions = {}) {
  const captured: {
    exchangeInsert?: Record<string, unknown>
    prospectUpdate?: Record<string, unknown>
  } = {}

  const prospect = opts.prospect === null
    ? null
    : {
        id: PROSPECT_ID,
        user_id: USER_ID,
        raison_sociale: 'Acme SAS',
        secteur_libelle: 'Industrie agroalimentaire',
        beges_derniere_publication: '2023-06-15',
        entite_publique: false,
        first_contact_at: null,
        siren: '123456789',
        ...opts.prospect,
      }

  const contact = opts.contact === null
    ? null
    : {
        id: CONTACT_ID,
        prospect_id: PROSPECT_ID,
        prenom: 'Marie',
        nom: 'Dupont',
        email: 'marie.dupont@acme.fr',
        email_status: 'valid',
        poste: 'DAF',
        ...opts.contact,
      }

  const profile = opts.profile === null
    ? null
    : {
        settings: { calendly_url: 'https://calendly.com/samir/30min' },
        email: 'samir@strofe.fr',
        full_name: 'Samir Anbri',
        ...opts.profile,
      }

  // isOptedOut() interroge `opt_out` :
  //   - SIREN : .select('id').eq('user_id').eq('siren').limit().maybeSingle()
  //   - email : .select('id').eq('user_id').ilike('email').limit().maybeSingle()
  // On mocke un maybeSingle commun renvoyant la ligne opt_out (ou null).
  const optOutResult = {
    data: opts.optOutDbError ? null : (opts.optOutRow ?? null),
    error: opts.optOutDbError ?? null,
  }
  const optOutMaybeSingle = vi.fn().mockResolvedValue(optOutResult)

  fromHandlers.current = {
    opt_out: () => ({
      select: () => ({
        eq: () => ({
          // chaîne SIREN : .eq('siren').limit().maybeSingle()
          eq: () => ({ limit: () => ({ maybeSingle: optOutMaybeSingle }) }),
          // chaîne email : .ilike('email').limit().maybeSingle()
          ilike: () => ({ limit: () => ({ maybeSingle: optOutMaybeSingle }) }),
        }),
      }),
    }),
    prospects: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: prospect, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        captured.prospectUpdate = payload
        return {
          eq: vi.fn().mockResolvedValue({ data: null, error: opts.updateError ?? null }),
        }
      },
    }),
    prospect_contacts: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: contact, error: null }),
        }),
      }),
    }),
    profiles: () => ({
      select: () => ({
        eq: () => ({
          single: vi.fn().mockResolvedValue({ data: profile, error: null }),
        }),
      }),
    }),
    prospect_exchanges: () => ({
      insert: (payload: Record<string, unknown>) => {
        captured.exchangeInsert = payload
        return {
          select: () => ({
            single: vi
              .fn()
              .mockResolvedValue({
                data: opts.exchangeError ? null : { id: 'exch-uuid' },
                error: opts.exchangeError ?? null,
              }),
          }),
        }
      },
      // select(..., { count: 'exact', head: true }).eq().eq() — utilise pour
      // détecter si un email a déjà été envoyé (fallback isFirstContact pour
      // les prospects pré-migration 022 sans first_contact_at).
      select: (_cols: string, _opts?: { count?: string; head?: boolean }) => ({
        eq: () => ({
          eq: vi.fn().mockResolvedValue({
            count: opts.priorEmailCount ?? 0,
            error: null,
          }),
        }),
      }),
    }),
  }

  return captured
}

// ------------------------------------------------------------
// SETUP
// ------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID, email: 'samir@strofe.fr' } }, error: null })
  mockResendSend.mockResolvedValue({ data: { id: 'resend-xyz' }, error: null })
  process.env.RESEND_API_KEY = 'test-resend-key'
  process.env.RESEND_FROM_EMAIL = 'noreply@strofe.fr'
  process.env.OPT_OUT_HMAC_SECRET = 'test-hmac-secret'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
})

afterEach(() => {
  delete process.env.RESEND_API_KEY
  delete process.env.RESEND_FROM_EMAIL
  delete process.env.OPT_OUT_HMAC_SECRET
  delete process.env.NEXT_PUBLIC_APP_URL
})

// ------------------------------------------------------------
// TESTS
// ------------------------------------------------------------

describe('POST /api/email/send', () => {
  it('renvoie 401 si non authentifié', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    setupHandlers()

    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error.code).toBe('UNAUTHENTICATED')
  })

  it('renvoie 400 sur body invalide (Zod)', async () => {
    setupHandlers()
    const res = await POST(makeRequest({ ...VALID_BODY, templateKey: 'invalid' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('INVALID_INPUT')
  })

  it('renvoie 400 sur JSON invalide', async () => {
    setupHandlers()
    const req = new NextRequest('http://localhost/api/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('renvoie 404 si prospect introuvable (RLS implicite)', async () => {
    setupHandlers({ prospect: null })
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(404)
  })

  it('renvoie 404 si contact n\'appartient pas au prospect', async () => {
    setupHandlers({
      contact: { prospect_id: '00000000-0000-0000-0000-000000000000' },
    })
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(404)
  })

  it('renvoie 400 si email contact manquant ou invalide', async () => {
    setupHandlers({
      contact: { email_status: 'invalid' },
    })
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(400)
  })

  it('envoie un email Resend avec from/reply_to corrects', async () => {
    setupHandlers()
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(201)
    expect(mockResendSend).toHaveBeenCalledTimes(1)
    const call = mockResendSend.mock.calls[0][0]
    expect(call.from).toBe('noreply@strofe.fr')
    expect(call.to).toBe('marie.dupont@acme.fr')
    expect(call.replyTo).toBe('contact@strofe.fr')
  })

  it('interpole {{prenom}} et {{raison_sociale}} dans le sujet', async () => {
    setupHandlers()
    await POST(makeRequest(VALID_BODY))
    const call = mockResendSend.mock.calls[0][0]
    expect(call.subject).toBe('Bonjour Marie')
  })

  it('GLN-003 : ajoute le footer RGPD art. 14 si first_contact_at est null', async () => {
    const captured = setupHandlers({ prospect: { first_contact_at: null } })
    await POST(makeRequest(VALID_BODY))

    // Le corps de l'échange persistance contient le footer RGPD
    const exchangeNotes = (captured.exchangeInsert?.notes as string) ?? ''
    expect(exchangeNotes).toContain('Conformément à l\'article 14 du RGPD')
    expect(exchangeNotes).toContain('mocked.opt.out.token')
  })

  it('GLN-003 : N\'ajoute PAS le footer RGPD si first_contact_at déjà renseigné', async () => {
    const captured = setupHandlers({ prospect: { first_contact_at: '2026-04-01T10:00:00Z' } })
    await POST(makeRequest(VALID_BODY))

    const exchangeNotes = (captured.exchangeInsert?.notes as string) ?? ''
    expect(exchangeNotes).not.toContain('Conformément à l\'article 14 du RGPD')
  })

  it('GLN-003 : UPDATE first_contact_at si premier contact', async () => {
    const captured = setupHandlers({ prospect: { first_contact_at: null } })
    await POST(makeRequest(VALID_BODY))

    expect(captured.prospectUpdate).toBeDefined()
    expect(captured.prospectUpdate?.first_contact_at).toBeTypeOf('string')
  })

  it('GLN-003 : NE met PAS à jour first_contact_at si déjà renseigné', async () => {
    const captured = setupHandlers({ prospect: { first_contact_at: '2026-04-01T10:00:00Z' } })
    await POST(makeRequest(VALID_BODY))

    expect(captured.prospectUpdate).toBeUndefined()
  })

  it('crée une ligne prospect_exchanges type=email result=sent', async () => {
    const captured = setupHandlers()
    await POST(makeRequest(VALID_BODY))

    expect(captured.exchangeInsert).toMatchObject({
      user_id: USER_ID,
      prospect_id: PROSPECT_ID,
      type: 'email',
      result: 'sent',
    })
  })

  it('renvoie 502 si Resend échoue', async () => {
    setupHandlers()
    mockResendSend.mockResolvedValue({ data: null, error: { message: 'Resend down' } })

    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error.code).toBe('EXTERNAL_API_ERROR')
  })

  it('renvoie 500 si RESEND_FROM_EMAIL absent', async () => {
    delete process.env.RESEND_FROM_EMAIL
    setupHandlers()

    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(500)
  })

  // ----------------------------------------------------------
  // RGPD — opt-out (art. 21) : blocage avant envoi (B4)
  // ----------------------------------------------------------

  it('RGPD : bloque l\'envoi (409) si le prospect est en statut do_not_contact', async () => {
    setupHandlers({ prospect: { statut: 'do_not_contact' } })

    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error.code).toBe('OPTED_OUT')
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('RGPD : bloque l\'envoi (409) si le destinataire est désinscrit (table opt_out)', async () => {
    setupHandlers({ optOutRow: { id: 'optout-uuid' } })

    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error.code).toBe('OPTED_OUT')
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('RGPD : fail-closed (409) si la vérification opt-out lève une exception', async () => {
    setupHandlers()
    // Force isOptedOut à throw : la table opt_out n'est plus mockée.
    fromHandlers.current.opt_out = () => {
      throw new Error('opt_out check boom')
    }

    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error.code).toBe('OPT_OUT_CHECK_FAILED')
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('RGPD : autorise l\'envoi si le destinataire n\'est pas désinscrit', async () => {
    setupHandlers({ optOutRow: null })

    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(201)
    expect(mockResendSend).toHaveBeenCalledTimes(1)
  })
})
