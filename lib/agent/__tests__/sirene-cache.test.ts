// ============================================================
// TESTS UNITAIRES — lib/agent/sirene-cache.ts
//
// Cibles :
//   - searchSireneCache : cache vide, frais, stale, erreur RPC, mapping wire
//   - getSireneCacheHealth : vue sirene_cache_size (vide, peuplée, erreur)
//   - Intégration runner (mock supabase.rpc) : pas d'appel API si cache hit
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { SupabaseAdminClient } from '@/lib/supabase/server'

import {
  getSireneCacheHealth,
  searchSireneCache,
  type SearchSireneCacheParams,
} from '../sirene-cache'

// ------------------------------------------------------------
// HELPERS — mock client Supabase (chainable .from / .rpc)
// ------------------------------------------------------------

interface MockSupabaseConfig {
  /**
   * Réponses pour `client.rpc('search_sirene_cache', args)`. Consommé dans
   * l'ordre des appels successifs ; si epuisé, on retourne `{ data: [], error: null }`.
   */
  rpcResponses?: Array<{
    data: unknown
    error: { message: string } | null
  }>
  /**
   * Réponse pour `client.from('sirene_cache_size').select('...')`.
   * (data est un array d'1 row pour la vue.)
   */
  healthResponse?: {
    data: unknown
    error: { message: string } | null
  }
}

interface MockSupabase {
  client: SupabaseAdminClient
  rpc: Mock
  healthFrom: Mock
  healthSelect: Mock
}

function makeMockSupabase(config: MockSupabaseConfig = {}): MockSupabase {
  const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => {
    const callIndex = rpc.mock.calls.length - 1
    const responses = config.rpcResponses ?? []
    return responses[callIndex] ?? { data: [], error: null }
  })

  const healthSelect = vi.fn(async () =>
    config.healthResponse ?? { data: [], error: null },
  )
  const healthFrom = vi.fn((_table: string) => ({
    select: healthSelect,
  }))

  const client = {
    rpc,
    from: healthFrom,
  } as unknown as SupabaseAdminClient

  return { client, rpc, healthFrom, healthSelect }
}

/** Health row factory : cache frais (3 jours, 50k établissements). */
function freshHealthRow() {
  return {
    data: [
      {
        active_count: 50_000,
        last_import_at: '2026-05-14T03:00:00.000Z',
        days_since_import: 3,
      },
    ],
    error: null,
  }
}

/** Health row factory : cache vide (jamais importé). */
function emptyHealthRow() {
  return {
    data: [
      {
        active_count: 0,
        last_import_at: null,
        days_since_import: null,
      },
    ],
    error: null,
  }
}

/** Health row factory : cache obsolète (80 jours, dépasse le seuil 60j). */
function staleHealthRow() {
  return {
    data: [
      {
        active_count: 30_000,
        last_import_at: '2026-02-20T03:00:00.000Z',
        days_since_import: 80,
      },
    ],
    error: null,
  }
}

/** Params standard pour searchSireneCache. */
function defaultParams(overrides: Partial<SearchSireneCacheParams> = {}): SearchSireneCacheParams {
  return {
    nafCodes: ['01.21Z', '10.11Z'],
    trancheEffectifs: ['21', '22', '31'],
    codePostalRange: ['33000', '33999'],
    excludeSirens: ['111111111', '222222222'],
    pageSize: 100,
    offset: 0,
    ...overrides,
  }
}

/** Génère N rows synthétiques cohérentes avec le RETURNS TABLE de la migration. */
function makeCacheRows(count: number, sirenStart = 100_000_000) {
  return Array.from({ length: count }, (_, i) => {
    const siren = String(sirenStart + i).padStart(9, '0')
    return {
      siren,
      siret: `${siren}00012`,
      raison_sociale: `ENTREPRISE TEST ${siren}`,
      activite_principale: '01.21Z',
      tranche_effectifs: '22',
      effectif_min: 10,
      effectif_max: 19,
      code_postal: '33000',
      commune: 'BORDEAUX',
      adresse: '12 RUE DE LA REPUBLIQUE',
    }
  })
}

// ------------------------------------------------------------
// TESTS — getSireneCacheHealth
// ------------------------------------------------------------

describe('getSireneCacheHealth', () => {
  it('retourne {isEmpty: false, ageDays: 3, rowCount: 50000} sur cache peuplé frais', async () => {
    const { client } = makeMockSupabase({ healthResponse: freshHealthRow() })
    const health = await getSireneCacheHealth(client)
    expect(health).toEqual({ isEmpty: false, ageDays: 3, rowCount: 50_000 })
  })

  it('retourne {isEmpty: true, rowCount: 0, ageDays: NaN} quand cache vide', async () => {
    const { client } = makeMockSupabase({ healthResponse: emptyHealthRow() })
    const health = await getSireneCacheHealth(client)
    expect(health).not.toBeNull()
    expect(health!.isEmpty).toBe(true)
    expect(health!.rowCount).toBe(0)
    expect(Number.isNaN(health!.ageDays)).toBe(true)
  })

  it('retourne {isEmpty: false, ageDays: 80, rowCount: 30000} sur cache stale', async () => {
    const { client } = makeMockSupabase({ healthResponse: staleHealthRow() })
    const health = await getSireneCacheHealth(client)
    expect(health).toEqual({ isEmpty: false, ageDays: 80, rowCount: 30_000 })
  })

  it('retourne null sur erreur Supabase (vue manquante / réseau)', async () => {
    const { client } = makeMockSupabase({
      healthResponse: { data: null, error: { message: 'relation "sirene_cache_size" does not exist' } },
    })
    const health = await getSireneCacheHealth(client)
    expect(health).toBeNull()
  })

  it('retourne null si la vue ne renvoie aucune ligne (cas dégradé)', async () => {
    const { client } = makeMockSupabase({
      healthResponse: { data: [], error: null },
    })
    const health = await getSireneCacheHealth(client)
    expect(health).toBeNull()
  })

  it('cible bien la vue sirene_cache_size', async () => {
    const { client, healthFrom } = makeMockSupabase({ healthResponse: freshHealthRow() })
    await getSireneCacheHealth(client)
    expect(healthFrom).toHaveBeenCalledWith('sirene_cache_size')
  })
})

// ------------------------------------------------------------
// TESTS — searchSireneCache : cache utilisable
// ------------------------------------------------------------

describe('searchSireneCache — cache frais', () => {
  it('retourne result avec cacheUsed=true quand RPC renvoie 100 rows + cache frais', async () => {
    const rows = makeCacheRows(100)
    const { client, rpc } = makeMockSupabase({
      healthResponse: freshHealthRow(),
      rpcResponses: [{ data: rows, error: null }],
    })

    const result = await searchSireneCache(client, defaultParams())
    expect(result).not.toBeNull()
    expect(result!.cacheUsed).toBe(true)
    expect(result!.cacheAgeDays).toBe(3)
    expect(result!.etablissements).toHaveLength(100)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('passe les paramètres p_naf_codes / p_tranche_effectifs / p_code_postal_min/max / p_exclude_sirens', async () => {
    const { client, rpc } = makeMockSupabase({
      healthResponse: freshHealthRow(),
      rpcResponses: [{ data: [], error: null }],
    })

    await searchSireneCache(
      client,
      defaultParams({
        nafCodes: ['49.41A'],
        trancheEffectifs: ['42'],
        codePostalRange: ['75000', '75999'],
        excludeSirens: ['123456789'],
      }),
    )

    expect(rpc).toHaveBeenCalledWith('search_sirene_cache', {
      p_naf_codes: ['49.41A'],
      p_tranche_effectifs: ['42'],
      p_code_postal_min: '75000',
      p_code_postal_max: '75999',
      p_exclude_sirens: ['123456789'],
      p_limit: 100,
      p_offset: 0,
    })
  })

  it('passe p_code_postal_min/max=null quand codePostalRange est undefined', async () => {
    const { client, rpc } = makeMockSupabase({
      healthResponse: freshHealthRow(),
      rpcResponses: [{ data: [], error: null }],
    })

    await searchSireneCache(client, defaultParams({ codePostalRange: undefined }))

    expect(rpc).toHaveBeenCalledWith(
      'search_sirene_cache',
      expect.objectContaining({
        p_code_postal_min: null,
        p_code_postal_max: null,
      }),
    )
  })

  it('mappe correctement une row cache → SireneEtablissement (wire Sirene)', async () => {
    const { client } = makeMockSupabase({
      healthResponse: freshHealthRow(),
      rpcResponses: [
        {
          data: [
            {
              siren: '542065479',
              siret: '54206547900012',
              raison_sociale: 'CARREFOUR',
              activite_principale: '47.11D',
              tranche_effectifs: '53',
              effectif_min: 1000,
              effectif_max: 1999,
              code_postal: '91300',
              commune: 'MASSY',
              adresse: '93 AVENUE DE PARIS',
            },
          ],
          error: null,
        },
      ],
    })

    const result = await searchSireneCache(client, defaultParams())
    expect(result).not.toBeNull()
    const etab = result!.etablissements[0]
    expect(etab.siren).toBe('542065479')
    expect(etab.siret).toBe('54206547900012')
    expect(etab.denominationUniteLegale).toBe('CARREFOUR')
    expect(etab.activitePrincipaleEtablissement).toBe('47.11D')
    expect(etab.trancheEffectifsEtablissement).toBe('53')
    expect(etab.codePostalEtablissement).toBe('91300')
    expect(etab.libelleCommuneEtablissement).toBe('MASSY')
    // L'état administratif est forcé à 'A' (la fonction SQL filtre déjà).
    expect(etab.etatAdministratifEtablissement).toBe('A')
    // adresseEtablissement reconstruit pour rétrocompat downstream.
    expect(etab.adresseEtablissement).toBeDefined()
    expect(etab.adresseEtablissement?.codePostalEtablissement).toBe('91300')
  })

  it('utilise pageSize/offset par défaut (100 / 0) quand non fournis', async () => {
    const { client, rpc } = makeMockSupabase({
      healthResponse: freshHealthRow(),
      rpcResponses: [{ data: [], error: null }],
    })

    await searchSireneCache(client, {
      nafCodes: [],
      trancheEffectifs: [],
      excludeSirens: [],
    })

    expect(rpc).toHaveBeenCalledWith(
      'search_sirene_cache',
      expect.objectContaining({ p_limit: 100, p_offset: 0 }),
    )
  })

  it('tolère des champs NULL dans la row cache (raison_sociale, code_postal manquants)', async () => {
    const { client } = makeMockSupabase({
      healthResponse: freshHealthRow(),
      rpcResponses: [
        {
          data: [
            {
              siren: '999999999',
              siret: '99999999900001',
              raison_sociale: null,
              activite_principale: null,
              tranche_effectifs: null,
              effectif_min: null,
              effectif_max: null,
              code_postal: null,
              commune: null,
              adresse: null,
            },
          ],
          error: null,
        },
      ],
    })

    const result = await searchSireneCache(client, defaultParams())
    expect(result).not.toBeNull()
    const etab = result!.etablissements[0]
    expect(etab.siren).toBe('999999999')
    expect(etab.denominationUniteLegale).toBeUndefined()
    expect(etab.activitePrincipaleEtablissement).toBeUndefined()
    expect(etab.codePostalEtablissement).toBeUndefined()
  })
})

// ------------------------------------------------------------
// TESTS — searchSireneCache : null cases (fallback)
// ------------------------------------------------------------

describe('searchSireneCache — null cases (fallback obligatoire)', () => {
  it('retourne null quand le cache est vide (rowCount=0)', async () => {
    const { client, rpc } = makeMockSupabase({
      healthResponse: emptyHealthRow(),
    })

    const result = await searchSireneCache(client, defaultParams())
    expect(result).toBeNull()
    // Pas d'appel RPC inutile si cache vide — short-circuit sur health.
    expect(rpc).not.toHaveBeenCalled()
  })

  it('retourne null quand le cache est stale (>60j d\'âge)', async () => {
    const { client, rpc } = makeMockSupabase({
      healthResponse: staleHealthRow(),
    })

    const result = await searchSireneCache(client, defaultParams())
    expect(result).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('retourne null quand le health-check Supabase renvoie une erreur', async () => {
    const { client, rpc } = makeMockSupabase({
      healthResponse: { data: null, error: { message: 'connection timeout' } },
    })

    const result = await searchSireneCache(client, defaultParams())
    expect(result).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('retourne null quand la RPC search_sirene_cache erreur (fonction absente / DB down)', async () => {
    const { client, rpc } = makeMockSupabase({
      healthResponse: freshHealthRow(),
      rpcResponses: [
        { data: null, error: { message: 'function search_sirene_cache does not exist' } },
      ],
    })

    const result = await searchSireneCache(client, defaultParams())
    expect(result).toBeNull()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('retourne un result valide (vide) si RPC renvoie data=[] (filtres trop stricts, pas une erreur)', async () => {
    const { client } = makeMockSupabase({
      healthResponse: freshHealthRow(),
      rpcResponses: [{ data: [], error: null }],
    })

    const result = await searchSireneCache(client, defaultParams())
    // Important : data=[] est un cas légitime (filtres trop stricts), pas une raison de fallback.
    // Le caller verra etablissements.length === 0 et peut décider lui-même de fallback.
    expect(result).not.toBeNull()
    expect(result!.etablissements).toEqual([])
    expect(result!.cacheUsed).toBe(true)
  })

  it('exception inattendue (rpc throw réseau) → null + log warn', async () => {
    const rpc = vi.fn(async () => {
      throw new Error('network failure')
    })
    const healthSelect = vi.fn(async () => freshHealthRow())
    const healthFrom = vi.fn(() => ({ select: healthSelect }))
    const client = { rpc, from: healthFrom } as unknown as SupabaseAdminClient

    const result = await searchSireneCache(client, defaultParams())
    expect(result).toBeNull()
  })

  it('cache à exactement 60j (à la limite) reste utilisable', async () => {
    const { client, rpc } = makeMockSupabase({
      healthResponse: {
        data: [{ active_count: 30_000, last_import_at: '2026-03-18', days_since_import: 60 }],
        error: null,
      },
      rpcResponses: [{ data: makeCacheRows(10), error: null }],
    })

    const result = await searchSireneCache(client, defaultParams())
    expect(result).not.toBeNull()
    expect(result!.cacheAgeDays).toBe(60)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('cache à 61j (1j au-dessus du seuil) → null', async () => {
    const { client, rpc } = makeMockSupabase({
      healthResponse: {
        data: [{ active_count: 30_000, last_import_at: '2026-03-17', days_since_import: 61 }],
        error: null,
      },
    })

    const result = await searchSireneCache(client, defaultParams())
    expect(result).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('cache avec days_since_import=null (cas dégradé inattendu) → null', async () => {
    const { client, rpc } = makeMockSupabase({
      healthResponse: {
        data: [{ active_count: 30_000, last_import_at: null, days_since_import: null }],
        error: null,
      },
    })

    const result = await searchSireneCache(client, defaultParams())
    expect(result).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------
// TESTS — Intégration runner (cache hit = pas d'appel Sirene API)
// ------------------------------------------------------------

describe('Intégration runner — cascade cache → API live', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('cache hit : searchSireneCache renvoie un result, pas besoin d\'appeler sourcerEntreprises', async () => {
    const { client, rpc } = makeMockSupabase({
      healthResponse: freshHealthRow(),
      rpcResponses: [{ data: makeCacheRows(50), error: null }],
    })

    const sourcerEntreprisesSpy = vi.fn()

    // Pattern attendu côté caller :
    //   const cacheResult = await searchSireneCache(supabase, params)
    //   if (cacheResult) { result = adapt(cacheResult) }
    //   else { result = await sourcerEntreprises(...) }
    const cacheResult = await searchSireneCache(client, defaultParams())

    if (cacheResult) {
      // Branche cache hit — on n'appelle PAS sourcerEntreprises.
      expect(cacheResult.etablissements).toHaveLength(50)
    } else {
      sourcerEntreprisesSpy()
    }

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(sourcerEntreprisesSpy).not.toHaveBeenCalled()
  })

  it('cache miss (vide) : searchSireneCache renvoie null → caller doit appeler sourcerEntreprises', async () => {
    const { client } = makeMockSupabase({
      healthResponse: emptyHealthRow(),
    })

    const sourcerEntreprisesSpy = vi.fn(async () => ({
      etablissements: [],
      curseur: '*',
      curseurSuivant: '*',
      totalAvailable: 0,
      pagesLoaded: 1,
      exhausted: true,
      universeEmpty: true,
    }))

    const cacheResult = await searchSireneCache(client, defaultParams())

    if (!cacheResult) {
      await sourcerEntreprisesSpy()
    }

    expect(cacheResult).toBeNull()
    expect(sourcerEntreprisesSpy).toHaveBeenCalledTimes(1)
  })

  it('cache stale (>60j) : searchSireneCache renvoie null → caller doit fallback API', async () => {
    const { client } = makeMockSupabase({
      healthResponse: staleHealthRow(),
    })

    const sourcerEntreprisesSpy = vi.fn()

    const cacheResult = await searchSireneCache(client, defaultParams())

    if (!cacheResult) {
      sourcerEntreprisesSpy()
    }

    expect(cacheResult).toBeNull()
    expect(sourcerEntreprisesSpy).toHaveBeenCalledTimes(1)
  })
})
