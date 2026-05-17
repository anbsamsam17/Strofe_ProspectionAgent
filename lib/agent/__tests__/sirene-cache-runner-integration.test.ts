// ============================================================
// TESTS — intégration cache SIRENE (lib/agent/sirene-cache.ts)
//        + cascade vers runner (cache → Sirene live → Recherche Entreprises)
// ------------------------------------------------------------
// Le module `sirene-cache.ts` expose deux fonctions :
//   - `searchSireneCache(supabase, params)`
//       → `SearchSireneCacheResult | null` (null si cache vide/stale/erreur)
//   - `getSireneCacheHealth(supabase)`
//       → `SireneCacheHealth | null` (null si erreur Supabase)
//
// Stratégie de test :
//   1. Mock `supabase.rpc('search_sirene_cache', ...)` et
//      `supabase.from('sirene_cache_size').select(...)`.
//   2. Vérifier que `searchSireneCache` retourne `null` quand cache vide
//      ou stale (> 60j), → le runner cascade vers Sirene live.
//   3. Vérifier que les rows DB sont mappées vers `SireneEtablissement`
//      (drop-in compatibility avec le pipeline).
//   4. Vérifier la cascade attendue côté runner (cache → live → fallback)
//      via un wrapper qui imite la décision.
//
// Pas d'appel réseau. Tous les Supabase calls sont mockés.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SireneEtablissement } from '@/lib/types'
import {
  getSireneCacheHealth,
  searchSireneCache,
  type SearchSireneCacheParams,
  type SearchSireneCacheResult,
  type SireneCacheHealth,
} from '../sirene-cache'

// ------------------------------------------------------------
// MOCK SUPABASE — shape minimal compatible avec sirene-cache
// ------------------------------------------------------------

interface CacheRowDb {
  siren: string
  siret: string
  raison_sociale: string | null
  activite_principale: string | null
  tranche_effectifs: string | null
  effectif_min: number | null
  effectif_max: number | null
  code_postal: string | null
  commune: string | null
  adresse: string | null
}

interface MockSupabaseState {
  cacheRows: CacheRowDb[]
  /** Réponse de la vue sirene_cache_size. */
  health: {
    active_count: number | null
    last_import_at: string | null
    days_since_import: number | null
  } | null
  /** Si défini, simule une erreur côté view sirene_cache_size. */
  healthError: { message: string } | null
  /** Si défini, simule une erreur côté RPC search_sirene_cache. */
  rpcError: { message: string } | null
  /** Compteur d'appels RPC pour vérifier qu'on n'appelle pas la RPC en cas de cache stale. */
  rpcCalls: number
}

function makeMockSupabase(state: MockSupabaseState) {
  return {
    rpc: vi.fn(async (fnName: string, params: Record<string, unknown>) => {
      state.rpcCalls++
      if (fnName !== 'search_sirene_cache') {
        return { data: null, error: { message: `Unknown RPC: ${fnName}` } }
      }
      if (state.rpcError) {
        return { data: null, error: state.rpcError }
      }
      // Filtrer côté mock (logique simplifiée — alignée sur search_sirene_cache.sql).
      const nafCodes = (params.p_naf_codes as string[]) ?? []
      const tranches = (params.p_tranche_effectifs as string[]) ?? []
      const cpMin = params.p_code_postal_min as string | null
      const cpMax = params.p_code_postal_max as string | null
      const excludeSirens = (params.p_exclude_sirens as string[]) ?? []
      const limit = (params.p_limit as number) ?? 100
      const offset = (params.p_offset as number) ?? 0

      const filtered = state.cacheRows.filter((row) => {
        if (
          nafCodes.length > 0 &&
          !nafCodes.includes(row.activite_principale ?? '')
        )
          return false
        if (
          tranches.length > 0 &&
          !tranches.includes(row.tranche_effectifs ?? '')
        )
          return false
        if (cpMin && (row.code_postal ?? '') < cpMin) return false
        if (cpMax && (row.code_postal ?? '') > cpMax) return false
        if (excludeSirens.includes(row.siren)) return false
        return true
      })
      return {
        data: filtered.slice(offset, offset + limit),
        error: null,
      }
    }),
    from: vi.fn((table: string) => {
      if (table === 'sirene_cache_size') {
        return {
          select: vi.fn(async (_cols: string) => {
            if (state.healthError) {
              return { data: null, error: state.healthError }
            }
            return {
              data: state.health ? [state.health] : [],
              error: null,
            }
          }),
        }
      }
      return {
        select: vi.fn(async () => ({ data: null, error: null })),
      }
    }),
  }
}

// ------------------------------------------------------------
// HELPERS — fixtures
// ------------------------------------------------------------

function makeCacheRow(overrides: Partial<CacheRowDb> = {}): CacheRowDb {
  return {
    siren: '100000001',
    siret: '10000000100012',
    raison_sociale: 'TEST CACHE SAS',
    activite_principale: '01.21Z',
    tranche_effectifs: '42',
    effectif_min: 250,
    effectif_max: 499,
    code_postal: '33000',
    commune: 'BORDEAUX',
    adresse: '1 RUE DES VIGNES',
    ...overrides,
  }
}

const FRESH_HEALTH = {
  active_count: 250_000,
  last_import_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  days_since_import: 5,
}

const STALE_HEALTH = {
  active_count: 250_000,
  last_import_at: new Date(Date.now() - 75 * 86_400_000).toISOString(),
  days_since_import: 75,
}

const EMPTY_HEALTH = {
  active_count: 0,
  last_import_at: null,
  days_since_import: null,
}

const BASE_PARAMS: SearchSireneCacheParams = {
  nafCodes: ['01.21Z'],
  trancheEffectifs: ['42'],
  codePostalRange: ['33000', '33999'],
  excludeSirens: [],
  pageSize: 100,
  offset: 0,
}

// ------------------------------------------------------------
// SETUP / TEARDOWN
// ------------------------------------------------------------

let consoleLogSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // Mute console.log (le module loggue en JSON structuré).
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  consoleLogSpy.mockRestore()
  vi.restoreAllMocks()
})

// ============================================================
// TESTS — getSireneCacheHealth
// ============================================================

describe('getSireneCacheHealth', () => {
  it('retourne {isEmpty: false, ageDays, rowCount} quand vue OK et cache peuplé', async () => {
    const state: MockSupabaseState = {
      cacheRows: [],
      health: FRESH_HEALTH,
      healthError: null,
      rpcError: null,
      rpcCalls: 0,
    }
    const supabase = makeMockSupabase(state)
    // Cast — le module accepte SupabaseAdminClient, notre mock est duck-typé.
    const health = await getSireneCacheHealth(
      supabase as unknown as Parameters<typeof getSireneCacheHealth>[0],
    )
    expect(health).not.toBeNull()
    expect(health!.isEmpty).toBe(false)
    expect(health!.ageDays).toBe(5)
    expect(health!.rowCount).toBe(250_000)
  })

  it('retourne {isEmpty: true, ageDays: NaN, rowCount: 0} quand cache vide', async () => {
    const state: MockSupabaseState = {
      cacheRows: [],
      health: EMPTY_HEALTH,
      healthError: null,
      rpcError: null,
      rpcCalls: 0,
    }
    const supabase = makeMockSupabase(state)
    const health = await getSireneCacheHealth(
      supabase as unknown as Parameters<typeof getSireneCacheHealth>[0],
    )
    expect(health).not.toBeNull()
    expect(health!.isEmpty).toBe(true)
    expect(Number.isNaN(health!.ageDays)).toBe(true)
    expect(health!.rowCount).toBe(0)
  })

  it('retourne null quand la vue retourne une erreur (migration 019 absente, RLS, etc.)', async () => {
    const state: MockSupabaseState = {
      cacheRows: [],
      health: null,
      healthError: { message: 'relation "sirene_cache_size" does not exist' },
      rpcError: null,
      rpcCalls: 0,
    }
    const supabase = makeMockSupabase(state)
    const health = await getSireneCacheHealth(
      supabase as unknown as Parameters<typeof getSireneCacheHealth>[0],
    )
    expect(health).toBeNull()
  })

  it('retourne null quand la vue est vide (data: [] inattendu)', async () => {
    const state: MockSupabaseState = {
      cacheRows: [],
      health: null, // makeMockSupabase répond data: [] dans ce cas
      healthError: null,
      rpcError: null,
      rpcCalls: 0,
    }
    const supabase = makeMockSupabase(state)
    const health = await getSireneCacheHealth(
      supabase as unknown as Parameters<typeof getSireneCacheHealth>[0],
    )
    expect(health).toBeNull()
  })
})

// ============================================================
// TESTS — searchSireneCache (cas nominal + edge cases)
// ============================================================

describe('searchSireneCache — cache frais', () => {
  it('cache frais (ageDays = 5j) : retourne les rows mappées en SireneEtablissement', async () => {
    const state: MockSupabaseState = {
      cacheRows: [
        makeCacheRow({ siren: '100000001', siret: '10000000100012' }),
        makeCacheRow({ siren: '100000002', siret: '10000000200013' }),
      ],
      health: FRESH_HEALTH,
      healthError: null,
      rpcError: null,
      rpcCalls: 0,
    }
    const supabase = makeMockSupabase(state)
    const result: SearchSireneCacheResult | null = await searchSireneCache(
      supabase as unknown as Parameters<typeof searchSireneCache>[0],
      BASE_PARAMS,
    )
    expect(result).not.toBeNull()
    expect(result!.cacheUsed).toBe(true)
    expect(result!.cacheAgeDays).toBe(5)
    expect(result!.etablissements.length).toBe(2)
    // RPC appelé une fois (cache health OK + RPC ok).
    expect(state.rpcCalls).toBe(1)
  })

  it('drop-in : chaque etablissement a le shape SireneEtablissement', async () => {
    const state: MockSupabaseState = {
      cacheRows: [
        makeCacheRow({
          siren: '123456789',
          siret: '12345678900012',
          raison_sociale: 'INDUSTRIES CARBONE SAS',
          activite_principale: '24.10Z',
          tranche_effectifs: '42',
          code_postal: '13001',
          commune: 'MARSEILLE',
        }),
      ],
      health: FRESH_HEALTH,
      healthError: null,
      rpcError: null,
      rpcCalls: 0,
    }
    const supabase = makeMockSupabase(state)
    const result = await searchSireneCache(
      supabase as unknown as Parameters<typeof searchSireneCache>[0],
      {
        nafCodes: ['24.10Z'],
        trancheEffectifs: ['42'],
        codePostalRange: ['13000', '13999'],
        excludeSirens: [],
        pageSize: 100,
        offset: 0,
      },
    )
    expect(result).not.toBeNull()
    const etab: SireneEtablissement = result!.etablissements[0]!
    // Champs critiques pour le scoring + l'enrichissement aval.
    expect(etab.siren).toBe('123456789')
    expect(etab.siret).toBe('12345678900012')
    expect(etab.denominationUniteLegale).toBe('INDUSTRIES CARBONE SAS')
    expect(etab.activitePrincipaleEtablissement).toBe('24.10Z')
    expect(etab.trancheEffectifsEtablissement).toBe('42')
    expect(etab.codePostalEtablissement).toBe('13001')
    expect(etab.libelleCommuneEtablissement).toBe('MARSEILLE')
    expect(etab.etatAdministratifEtablissement).toBe('A')
    // Sub-objet adresse populé (drop-in pour le pipeline d'enrichissement).
    expect(etab.adresseEtablissement).toBeDefined()
    expect(etab.adresseEtablissement?.codePostalEtablissement).toBe('13001')
  })

  it('passe les filtres NAF, tranche, CP, excludeSirens, pageSize, offset à la RPC', async () => {
    const state: MockSupabaseState = {
      cacheRows: [],
      health: FRESH_HEALTH,
      healthError: null,
      rpcError: null,
      rpcCalls: 0,
    }
    const supabase = makeMockSupabase(state)
    await searchSireneCache(
      supabase as unknown as Parameters<typeof searchSireneCache>[0],
      {
        nafCodes: ['01.21Z', '49.41A'],
        trancheEffectifs: ['41', '42', '51'],
        codePostalRange: ['33000', '33999'],
        excludeSirens: ['999999999'],
        pageSize: 50,
        offset: 100,
      },
    )
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
    const [fnName, rpcParams] = (supabase.rpc as ReturnType<typeof vi.fn>).mock
      .calls[0]!
    expect(fnName).toBe('search_sirene_cache')
    expect(rpcParams).toMatchObject({
      p_naf_codes: ['01.21Z', '49.41A'],
      p_tranche_effectifs: ['41', '42', '51'],
      p_code_postal_min: '33000',
      p_code_postal_max: '33999',
      p_exclude_sirens: ['999999999'],
      p_limit: 50,
      p_offset: 100,
    })
  })
})

describe('searchSireneCache — cache stale / vide / erreur', () => {
  it('cache stale (ageDays = 75j) : retourne null SANS appeler la RPC', async () => {
    const state: MockSupabaseState = {
      cacheRows: [makeCacheRow()],
      health: STALE_HEALTH,
      healthError: null,
      rpcError: null,
      rpcCalls: 0,
    }
    const supabase = makeMockSupabase(state)
    const result = await searchSireneCache(
      supabase as unknown as Parameters<typeof searchSireneCache>[0],
      BASE_PARAMS,
    )
    expect(result).toBeNull()
    // Anti-régression : la RPC ne doit JAMAIS être appelée si cache stale —
    // le caller (runner) doit fallback sur Sirene live.
    expect(state.rpcCalls).toBe(0)
  })

  it('cache vide (rowCount = 0) : retourne null SANS appeler la RPC', async () => {
    const state: MockSupabaseState = {
      cacheRows: [],
      health: EMPTY_HEALTH,
      healthError: null,
      rpcError: null,
      rpcCalls: 0,
    }
    const supabase = makeMockSupabase(state)
    const result = await searchSireneCache(
      supabase as unknown as Parameters<typeof searchSireneCache>[0],
      BASE_PARAMS,
    )
    expect(result).toBeNull()
    expect(state.rpcCalls).toBe(0)
  })

  it('vue sirene_cache_size en erreur : retourne null (pas de fallback silencieux)', async () => {
    const state: MockSupabaseState = {
      cacheRows: [makeCacheRow()],
      health: null,
      healthError: { message: 'permission denied for view sirene_cache_size' },
      rpcError: null,
      rpcCalls: 0,
    }
    const supabase = makeMockSupabase(state)
    const result = await searchSireneCache(
      supabase as unknown as Parameters<typeof searchSireneCache>[0],
      BASE_PARAMS,
    )
    expect(result).toBeNull()
    expect(state.rpcCalls).toBe(0)
  })

  it('RPC en erreur après health OK : retourne null (cascade fallback)', async () => {
    const state: MockSupabaseState = {
      cacheRows: [makeCacheRow()],
      health: FRESH_HEALTH,
      healthError: null,
      rpcError: { message: 'function search_sirene_cache(...) does not exist' },
      rpcCalls: 0,
    }
    const supabase = makeMockSupabase(state)
    const result = await searchSireneCache(
      supabase as unknown as Parameters<typeof searchSireneCache>[0],
      BASE_PARAMS,
    )
    expect(result).toBeNull()
    expect(state.rpcCalls).toBe(1) // health OK → RPC tentée → erreur
  })
})

// ============================================================
// TESTS — cascade complète (runner décision)
// ============================================================

describe('cascade runner : cache → Sirene live → Recherche Entreprises', () => {
  /**
   * Simule la décision côté `runAdaptiveSourcing` : si `searchSireneCache`
   * retourne un résultat non-null, on utilise les rows du cache et on n'appelle
   * PAS l'API Sirene live. Sinon on bascule sur `sourcerEntreprises`, et si
   * cette dernière throw `SireneApiError`, on bascule sur Recherche Entreprises.
   */
  async function runRunnerCascade(opts: {
    supabase: ReturnType<typeof makeMockSupabase>
    sourcerEntreprises: ReturnType<typeof vi.fn>
    sourcerEntreprisesFallback: ReturnType<typeof vi.fn>
  }): Promise<{ etablissements: SireneEtablissement[]; source: string }> {
    const cacheResult = await searchSireneCache(
      opts.supabase as unknown as Parameters<typeof searchSireneCache>[0],
      BASE_PARAMS,
    )
    if (cacheResult) {
      return { etablissements: cacheResult.etablissements, source: 'cache' }
    }
    try {
      const liveResult = await opts.sourcerEntreprises()
      return {
        etablissements: (liveResult as { etablissements: SireneEtablissement[] })
          .etablissements,
        source: 'sirene_live',
      }
    } catch {
      const fallback = await opts.sourcerEntreprisesFallback()
      return {
        etablissements: fallback as SireneEtablissement[],
        source: 'recherche_entreprises_fallback',
      }
    }
  }

  it('cache frais : runner utilise le cache, n\'appelle PAS Sirene API live', async () => {
    const state: MockSupabaseState = {
      cacheRows: [
        makeCacheRow({ siren: '100000001' }),
        makeCacheRow({ siren: '100000002' }),
      ],
      health: FRESH_HEALTH,
      healthError: null,
      rpcError: null,
      rpcCalls: 0,
    }
    const supabase = makeMockSupabase(state)
    const sourcerEntreprises = vi.fn()
    const sourcerEntreprisesFallback = vi.fn()

    const out = await runRunnerCascade({
      supabase,
      sourcerEntreprises,
      sourcerEntreprisesFallback,
    })

    expect(out.source).toBe('cache')
    expect(out.etablissements.length).toBe(2)
    expect(sourcerEntreprises).not.toHaveBeenCalled()
    expect(sourcerEntreprisesFallback).not.toHaveBeenCalled()
  })

  it('cache stale (75j) : runner fallback sur Sirene API live', async () => {
    const state: MockSupabaseState = {
      cacheRows: [makeCacheRow()],
      health: STALE_HEALTH,
      healthError: null,
      rpcError: null,
      rpcCalls: 0,
    }
    const supabase = makeMockSupabase(state)
    const sourcerEntreprises = vi.fn().mockResolvedValue({
      etablissements: [
        {
          siren: '999999999',
          siret: '99999999900012',
          etatAdministratifEtablissement: 'A',
        } satisfies SireneEtablissement,
      ],
    })
    const sourcerEntreprisesFallback = vi.fn()

    const out = await runRunnerCascade({
      supabase,
      sourcerEntreprises,
      sourcerEntreprisesFallback,
    })

    expect(out.source).toBe('sirene_live')
    expect(sourcerEntreprises).toHaveBeenCalledTimes(1)
    expect(sourcerEntreprisesFallback).not.toHaveBeenCalled()
    expect(out.etablissements[0]!.siren).toBe('999999999')
    // Cache RPC NON appelée (cache stale détecté en health-check).
    expect(state.rpcCalls).toBe(0)
  })

  it('cache vide : runner fallback sur Sirene API live', async () => {
    const state: MockSupabaseState = {
      cacheRows: [],
      health: EMPTY_HEALTH,
      healthError: null,
      rpcError: null,
      rpcCalls: 0,
    }
    const supabase = makeMockSupabase(state)
    const sourcerEntreprises = vi.fn().mockResolvedValue({
      etablissements: [
        {
          siren: '888888888',
          siret: '88888888800012',
          etatAdministratifEtablissement: 'A',
        } satisfies SireneEtablissement,
      ],
    })
    const sourcerEntreprisesFallback = vi.fn()

    const out = await runRunnerCascade({
      supabase,
      sourcerEntreprises,
      sourcerEntreprisesFallback,
    })

    expect(out.source).toBe('sirene_live')
    expect(sourcerEntreprises).toHaveBeenCalledTimes(1)
    expect(state.rpcCalls).toBe(0)
  })

  it('cache stale + Sirene KO : fallback final Recherche Entreprises', async () => {
    const state: MockSupabaseState = {
      cacheRows: [],
      health: STALE_HEALTH,
      healthError: null,
      rpcError: null,
      rpcCalls: 0,
    }
    const supabase = makeMockSupabase(state)
    const sourcerEntreprises = vi
      .fn()
      .mockRejectedValue(new Error('Sirene HTTP 400 : Erreur de syntaxe'))
    const sourcerEntreprisesFallback = vi.fn().mockResolvedValue([
      {
        siren: '555555555',
        siret: '55555555500012',
        etatAdministratifEtablissement: 'A',
      } satisfies SireneEtablissement,
    ])

    const out = await runRunnerCascade({
      supabase,
      sourcerEntreprises,
      sourcerEntreprisesFallback,
    })

    expect(out.source).toBe('recherche_entreprises_fallback')
    expect(sourcerEntreprises).toHaveBeenCalledTimes(1)
    expect(sourcerEntreprisesFallback).toHaveBeenCalledTimes(1)
    expect(out.etablissements[0]!.siren).toBe('555555555')
  })

  it('format SireneEtablissement préservé via le cache (drop-in OK pour enrichirProspect)', async () => {
    const state: MockSupabaseState = {
      cacheRows: [
        makeCacheRow({
          siren: '100000010',
          siret: '10000001000021',
          raison_sociale: 'CIMENTS DU NORD',
          activite_principale: '23.51Z',
          tranche_effectifs: '42',
          effectif_min: 250,
          effectif_max: 499,
          code_postal: '80000',
          commune: 'AMIENS',
        }),
      ],
      health: FRESH_HEALTH,
      healthError: null,
      rpcError: null,
      rpcCalls: 0,
    }
    const supabase = makeMockSupabase(state)
    const result = await searchSireneCache(
      supabase as unknown as Parameters<typeof searchSireneCache>[0],
      {
        nafCodes: ['23.51Z'],
        trancheEffectifs: ['42'],
        codePostalRange: ['80000', '80999'],
        excludeSirens: [],
        pageSize: 100,
        offset: 0,
      },
    )
    expect(result).not.toBeNull()
    const etab = result!.etablissements[0]!
    // Champs requis par le pipeline downstream (scoring, ADEME, enrich).
    const REQUIRED: (keyof SireneEtablissement)[] = [
      'siren',
      'siret',
      'activitePrincipaleEtablissement',
      'trancheEffectifsEtablissement',
      'codePostalEtablissement',
      'etatAdministratifEtablissement',
    ]
    for (const key of REQUIRED) {
      expect(etab[key]).toBeDefined()
      expect(etab[key]).not.toBe('')
    }
    // Format strict (anti-régression : SIREN doit rester 9 chiffres, SIRET 14).
    expect(etab.siren).toMatch(/^\d{9}$/)
    expect(etab.siret).toMatch(/^\d{14}$/)
    // etatAdministratif forcé à 'A' par le cache (filtre côté SQL).
    expect(etab.etatAdministratifEtablissement).toBe('A')
  })

  it('SIREN cachés sont exclus côté cache (dedup avec base prospects)', async () => {
    const state: MockSupabaseState = {
      cacheRows: [
        makeCacheRow({ siren: '100000001' }),
        makeCacheRow({ siren: '100000002' }),
        makeCacheRow({ siren: '100000003' }),
      ],
      health: FRESH_HEALTH,
      healthError: null,
      rpcError: null,
      rpcCalls: 0,
    }
    const supabase = makeMockSupabase(state)
    const result = await searchSireneCache(
      supabase as unknown as Parameters<typeof searchSireneCache>[0],
      {
        ...BASE_PARAMS,
        excludeSirens: ['100000001', '100000002'],
      },
    )
    expect(result).not.toBeNull()
    const sirens = result!.etablissements.map((e) => e.siren)
    expect(sirens).not.toContain('100000001')
    expect(sirens).not.toContain('100000002')
    expect(sirens).toContain('100000003')
  })
})
