// ============================================================
// TESTS UNITAIRES — /api/admin/recategorize-secteurs
//
// Couvre les 4 cas demandés :
//   1. Gemini OK : prospects sélectionnés → UPDATE → succès comptés
//   2. Gemini retourne null (quota 429 / fallback) → echecs comptés, pas de UPDATE
//   3. Aucun prospect à backfill (filtre rate les déjà-renseignés)
//   4. Filtre "Inconnu" littéral inclus dans le SELECT (ILIKE 'inconnu%')
//
// Bonus :
//   - 401 si pas de header Authorization Bearer valide
//   - 503 si GEMINI_API_KEY absente
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { NextRequest } from 'next/server'

// ------------------------------------------------------------
// MOCKS — categoriserSecteurAvecGemini + createAdminClient
// ------------------------------------------------------------

vi.mock('@/lib/agent/gemini-scoring', () => ({
  isGeminiAvailable: vi.fn(() => true),
  categoriserSecteurAvecGemini: vi.fn(),
}))

// Spies par table — chaque appel `.from('prospects')` retourne un chainable
// qui capture aussi les paramètres passés à `.or(...)` pour vérifier le filtre.
interface OrCall {
  expr: string
}

const orCalls: OrCall[] = []
const updateCalls: Array<{ id: unknown; payload: unknown }> = []

let selectResult: { data: unknown; error: { message: string } | null } = {
  data: [],
  error: null,
}

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((_table: string) => {
      const chain = {
        select: vi.fn(() => chain),
        is: vi.fn(() => chain),
        or: vi.fn((expr: string) => {
          orCalls.push({ expr })
          return chain
        }),
        not: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(() => Promise.resolve(selectResult)),
        update: vi.fn((payload: unknown) => ({
          eq: vi.fn((_col: string, id: unknown) => {
            updateCalls.push({ id, payload })
            return Promise.resolve({ data: null, error: null })
          }),
        })),
      }
      return chain
    }),
  })),
}))

// ------------------------------------------------------------
// IMPORTS APRÈS MOCKS
// ------------------------------------------------------------

import { POST } from './route'
import {
  categoriserSecteurAvecGemini,
  isGeminiAvailable,
} from '@/lib/agent/gemini-scoring'

const mockedCategoriser = categoriserSecteurAvecGemini as unknown as Mock
const mockedIsGeminiAvailable = isGeminiAvailable as unknown as Mock

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function makeRequest(authHeader: string | null = 'Bearer test-cron-secret'): NextRequest {
  const headers = new Headers()
  if (authHeader) headers.set('authorization', authHeader)
  return new NextRequest('http://localhost/api/admin/recategorize-secteurs', {
    method: 'POST',
    headers,
  })
}

// ------------------------------------------------------------
// SETUP
// ------------------------------------------------------------

beforeEach(() => {
  process.env.CRON_SECRET = 'test-cron-secret'
  process.env.GEMINI_API_KEY = 'test-gemini-key'
  mockedCategoriser.mockReset()
  mockedIsGeminiAvailable.mockReset()
  mockedIsGeminiAvailable.mockReturnValue(true)
  orCalls.length = 0
  updateCalls.length = 0
  selectResult = { data: [], error: null }
})

afterEach(() => {
  vi.clearAllMocks()
})

// ============================================================
// CAS 1 — Gemini OK, prospects catégorisés
// ============================================================

describe('POST /api/admin/recategorize-secteurs — cas nominal Gemini OK', () => {
  it('catégorise les prospects sélectionnés et compte les succès', async () => {
    // Arrange : 3 prospects à backfill, Gemini retourne un libellé pour chacun
    selectResult = {
      data: [
        { id: 'p1', secteur_naf: '49.41A', secteur_libelle: null, raison_sociale: 'Transports Dupont', effectif_min: 50 },
        { id: 'p2', secteur_naf: '10.11Z', secteur_libelle: '', raison_sociale: 'Charcuterie SAS', effectif_min: 80 },
        { id: 'p3', secteur_naf: '01.21Z', secteur_libelle: 'Inconnu', raison_sociale: 'Vignoble', effectif_min: 30 },
      ],
      error: null,
    }
    mockedCategoriser
      .mockResolvedValueOnce({
        secteur_libelle: 'Transport routier de marchandises',
        secteur_categorie: 'transport',
        confidence: 'high',
      })
      .mockResolvedValueOnce({
        secteur_libelle: 'Industrie agro-alimentaire',
        secteur_categorie: 'industrie',
        confidence: 'high',
      })
      .mockResolvedValueOnce({
        secteur_libelle: 'Viticulture',
        secteur_categorie: 'agriculture',
        confidence: 'medium',
      })

    // Act
    const res = await POST(makeRequest())
    const json = await res.json()

    // Assert
    expect(res.status).toBe(200)
    expect(json.data.traites).toBe(3)
    expect(json.data.succes).toBe(3)
    expect(json.data.echecs).toBe(0)
    expect(updateCalls).toHaveLength(3)
    // L'UPDATE doit poser le libellé renvoyé par Gemini
    expect(updateCalls[0].payload).toEqual({ secteur_libelle: 'Transport routier de marchandises' })
    expect(updateCalls[0].id).toBe('p1')
  })
})

// ============================================================
// CAS 2 — Gemini quota 429 (retour null) : echecs comptés
// ============================================================

describe('POST /api/admin/recategorize-secteurs — Gemini quota dépassé', () => {
  it('compte les echecs quand categoriserSecteurAvecGemini retourne null', async () => {
    // Arrange : 2 prospects, Gemini renvoie null (quota 429 swallowed en interne)
    selectResult = {
      data: [
        { id: 'p1', secteur_naf: '49.41A', secteur_libelle: null, raison_sociale: 'X', effectif_min: 50 },
        { id: 'p2', secteur_naf: '49.41A', secteur_libelle: null, raison_sociale: 'Y', effectif_min: 50 },
      ],
      error: null,
    }
    mockedCategoriser.mockResolvedValue(null)

    // Act
    const res = await POST(makeRequest())
    const json = await res.json()

    // Assert
    expect(res.status).toBe(200)
    expect(json.data.traites).toBe(2)
    expect(json.data.succes).toBe(0)
    expect(json.data.echecs).toBe(2)
    // Pas d'UPDATE émis quand le résultat est null
    expect(updateCalls).toHaveLength(0)
  })
})

// ============================================================
// CAS 3 — Aucun prospect à backfill
// ============================================================

describe('POST /api/admin/recategorize-secteurs — aucun prospect à backfill', () => {
  it('retourne traites=0 quand le filtre ne sélectionne rien', async () => {
    selectResult = { data: [], error: null }

    const res = await POST(makeRequest())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.traites).toBe(0)
    expect(json.data.succes).toBe(0)
    expect(json.data.echecs).toBe(0)
    expect(mockedCategoriser).not.toHaveBeenCalled()
    expect(updateCalls).toHaveLength(0)
  })
})

// ============================================================
// CAS 4 — Filtre "Inconnu" littéral inclus
// ============================================================

describe('POST /api/admin/recategorize-secteurs — filtre Inconnu littéral', () => {
  it('inclut bien `secteur_libelle.ilike.inconnu%` dans la clause OR', async () => {
    selectResult = { data: [], error: null }

    await POST(makeRequest())

    // Le SELECT doit appeler `.or(...)` avec les 3 clauses : NULL, vide, ILIKE 'inconnu%'.
    // Cf. orchestrator.phaseSecteurCategorisation pour la même expression.
    expect(orCalls).toHaveLength(1)
    expect(orCalls[0].expr).toBe(
      'secteur_libelle.is.null,secteur_libelle.eq.,secteur_libelle.ilike.inconnu%',
    )
  })
})

// ============================================================
// BONUS — 401 / 503
// ============================================================

describe('POST /api/admin/recategorize-secteurs — sécurité', () => {
  it('retourne 401 sans header Authorization Bearer valide', async () => {
    const res = await POST(makeRequest(null))
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error.code).toBe('UNAUTHENTICATED')
    expect(mockedCategoriser).not.toHaveBeenCalled()
  })

  it('retourne 401 avec un secret Bearer incorrect (timing-safe)', async () => {
    const res = await POST(makeRequest('Bearer mauvais-secret'))

    expect(res.status).toBe(401)
    expect(mockedCategoriser).not.toHaveBeenCalled()
  })

  it('retourne 503 quand GEMINI_API_KEY absente', async () => {
    mockedIsGeminiAvailable.mockReturnValue(false)

    const res = await POST(makeRequest())
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.error.code).toBe('GEMINI_UNAVAILABLE')
    expect(mockedCategoriser).not.toHaveBeenCalled()
  })
})
