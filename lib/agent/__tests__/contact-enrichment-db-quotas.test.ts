// ============================================================
// TESTS UNITAIRES — contact-enrichment.ts + quotas DB
// Focus :
//   - Quand le quota Pappers (DB) est épuisé, fetchPappers ne doit PAS appeler
//     l'API Pappers (hard stop persistant).
//   - Hunter (quota séparé) continue à être appelé indépendamment.
//   - Mode rétrocompat : sans userId/supabase, fallback in-memory.
//
// Pattern AAA + mocks Supabase fluent (cf. quotas.test.ts).
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock du helper LinkedIn (HEAD HTTP réseau évité)
vi.mock('../linkedin-company', () => ({
  findLinkedinCompanyUrl: vi.fn().mockResolvedValue(null),
}))

import { enrichirContact } from '../contact-enrichment'

// ------------------------------------------------------------
// HARNESS — Supabase mock minimal et chainable
// ------------------------------------------------------------

/**
 * Construit un mock SupabaseClient qui retourne, pour la table `api_quotas` :
 *  - une ligne avec used_count = limit_count pour les providers `exhaustedProviders`
 *    (=> consumeQuota voit exhausted=true et n'incrémente pas)
 *  - une ligne fresh (used_count=0) pour les autres providers (=> quota dispo)
 *
 * Stratégie : on inspecte les `.eq('provider', X)` posés sur le chain pour
 * router vers la bonne réponse.
 */
function createSupabaseQuotaMock(exhaustedProviders: ReadonlyArray<string>) {
  function buildSelectChain() {
    let currentProvider: string | null = null
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockImplementation((col: string, val: string) => {
        if (col === 'provider') currentProvider = val
        return chain
      }),
      maybeSingle: vi.fn().mockImplementation(async () => {
        // Retourne une ligne déjà existante pour éviter le upsert insert.
        const exhausted = currentProvider !== null && exhaustedProviders.includes(currentProvider)
        return {
          data: {
            used_count: exhausted ? 100 : 0,
            limit_count: 100,
            month_start: '2026-05-01',
          },
          error: null,
        }
      }),
    }
    return chain
  }

  function buildUpdateChain() {
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockImplementation(() => chain),
      select: vi.fn().mockResolvedValue({
        data: [{ used_count: 1, limit_count: 100 }],
        error: null,
      }),
    }
    return chain
  }

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table !== 'api_quotas') {
      // Default empty for other tables (we don't touch them in this test).
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    }
    return {
      select: vi.fn().mockImplementation(() => buildSelectChain()),
      update: vi.fn().mockImplementation(() => buildUpdateChain()),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }
  })

  // Cast nécessaire : le mock minimal ne satisfait pas l'interface complète
  // SupabaseClient (Database generics + nombreuses méthodes inutilisées ici).
  return { from: fromMock } as unknown as import('@supabase/supabase-js').SupabaseClient
}

// ------------------------------------------------------------
// TESTS
// ------------------------------------------------------------

describe('enrichirContact — quotas DB (api_quotas)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Mock global fetch pour intercepter tous les appels HTTP de la cascade.
    // 503 par défaut = "rien trouvé", la cascade traite silencieusement.
    fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => '',
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchSpy)

    // Active Pappers + Hunter pour que la cascade tente leurs appels
    process.env.PAPPERS_API_KEY = 'test-pappers-key'
    process.env.HUNTER_API_KEY = 'test-hunter-key'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.PAPPERS_API_KEY
    delete process.env.HUNTER_API_KEY
  })

  it('NE PAS appeler Pappers si quota DB pappers épuisé, MAIS appelle Hunter (quota séparé)', async () => {
    // Arrange : Pappers KO en DB, Hunter dispo en DB.
    const supabase = createSupabaseQuotaMock(['pappers'])

    // Act
    await enrichirContact('123456789', {}, 'Foo Bar SAS', {
      userId: 'user-abc',
      supabase,
    })

    // Assert : aucun fetch vers Pappers.
    const fetchUrls = fetchSpy.mock.calls.map((c) => String(c[0]))
    const pappersCalls = fetchUrls.filter((u) => u.includes('pappers.fr'))
    expect(pappersCalls.length).toBe(0)

    // Hunter doit avoir été appelé (quota séparé, donc dispo)
    const hunterCalls = fetchUrls.filter((u) => u.includes('hunter.io'))
    expect(hunterCalls.length).toBeGreaterThan(0)
  })

  it('appelle Pappers normalement quand DB indique quota dispo', async () => {
    // Arrange : tous les quotas dispos.
    const supabase = createSupabaseQuotaMock([])

    // Act
    await enrichirContact('123456789', {}, 'Foo Bar SAS', {
      userId: 'user-abc',
      supabase,
    })

    // Assert : au moins un fetch vers Pappers.
    const fetchUrls = fetchSpy.mock.calls.map((c) => String(c[0]))
    const pappersCalls = fetchUrls.filter((u) => u.includes('pappers.fr'))
    expect(pappersCalls.length).toBeGreaterThan(0)
  })

  it('rétrocompat : sans options, fonctionne via le compteur in-memory (pas de DB requise)', async () => {
    // Act : pas de userId/supabase fournis → fallback in-memory pur.
    await enrichirContact('123456789', {}, 'Foo Bar SAS')

    // Assert : la cascade s'est exécutée (fetch invoqué pour RE/Pappers/Hunter).
    // On ne vérifie pas la DB ici — l'absence d'erreur prouve la rétrocompat.
    expect(fetchSpy).toHaveBeenCalled()
  })
})
