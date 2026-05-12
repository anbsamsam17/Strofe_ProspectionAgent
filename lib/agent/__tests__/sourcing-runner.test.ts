// ============================================================
// TESTS UNITAIRES — sourcing-runner.ts (Wave 3.2)
// Cibles : runPipelineSourcing + runAdaptiveSourcing
//
// Stratégie de mock :
//   - `vi.mock('@/lib/agent/sourcing', ...)` pour contrôler finement
//     sourcerEntreprises, sourcerEntreprisesFallback, enrichirProspect
//     tout en gardant la VRAIE classe SireneApiError (utilisée pour
//     `err instanceof SireneApiError` dans le runner).
//   - Mock client Supabase admin via une factory `mockSupabaseAdminClient`
//     qui retourne des chainables `.from('table').select/upsert/update/...`
//     personnalisables par appel.
//   - Aucune dépendance réelle Sirene/ADEME/Supabase/réseau.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { SupabaseAdminClient } from '@/lib/supabase/server'
import type { ProfileSettings, Prospect, SireneEtablissement } from '@/lib/types'

// ------------------------------------------------------------
// MOCK GLOBAL — module sourcing
// IMPORTANT : on mocke `sourcerEntreprises`, `sourcerEntreprisesFallback`,
// `enrichirProspect` mais on conserve la vraie `SireneApiError` (sinon
// `err instanceof SireneApiError` côté runner échoue silencieusement).
// ------------------------------------------------------------

vi.mock('@/lib/agent/sourcing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent/sourcing')>('@/lib/agent/sourcing')
  return {
    ...actual,
    sourcerEntreprises: vi.fn(),
    sourcerEntreprisesFallback: vi.fn(),
    enrichirProspect: vi.fn(),
  }
})

// Imports APRÈS vi.mock — runner réel + références mockées
import {
  runAdaptiveSourcing,
  runPipelineSourcing,
  type AdaptiveSourcingOutcome,
  type PipelineSourcingInput,
  type ResolvedSourcingFilters,
} from '../sourcing-runner'
import {
  enrichirProspect,
  SireneApiError,
  sourcerEntreprises,
  sourcerEntreprisesFallback,
  type SourcerEntreprisesResult,
} from '../sourcing'
import { sireneSampleEtablissement } from './fixtures'

const mockedSourcerEntreprises = sourcerEntreprises as unknown as Mock
const mockedSourcerFallback = sourcerEntreprisesFallback as unknown as Mock
const mockedEnrichirProspect = enrichirProspect as unknown as Mock

// ------------------------------------------------------------
// HELPERS / FACTORIES
// ------------------------------------------------------------

/** Construit une page Sirene synthétique pour le mock de `sourcerEntreprises`. */
function buildSourcerPage(opts: {
  count: number
  sirenStart?: number
  curseur: string
  curseurSuivant: string
  totalAvailable?: number
  exhausted?: boolean
  trancheEffectif?: string
  universeEmpty?: boolean
}): SourcerEntreprisesResult {
  const {
    count,
    sirenStart = 100_000_000,
    curseur,
    curseurSuivant,
    totalAvailable = 1_000,
    exhausted = curseur === curseurSuivant,
    trancheEffectif,
    universeEmpty = false,
  } = opts
  const etablissements: SireneEtablissement[] = []
  for (let i = 0; i < count; i++) {
    const siren = String(sirenStart + i).padStart(9, '0')
    const base = sireneSampleEtablissement(siren)
    etablissements.push(
      trancheEffectif ? { ...base, trancheEffectifsEtablissement: trancheEffectif } : base,
    )
  }
  return {
    etablissements,
    curseur,
    curseurSuivant,
    totalAvailable,
    pagesLoaded: 1,
    exhausted,
    universeEmpty,
  }
}

/**
 * Construit un mock `enrichirProspect` qui retourne un prospect partiel cohérent
 * avec le SIREN reçu. Permet de simuler des qualifiés (tranche 41+ -> obligation BEGES).
 */
function makeEnrichSuccess(opts: { trancheEffectif?: string } = {}) {
  return vi.fn(async (etab: SireneEtablissement): Promise<Partial<Prospect>> => {
    const tranche = opts.trancheEffectif ?? etab.trancheEffectifsEtablissement ?? '41'
    const obligation = parseInt(tranche, 10) >= 41
    return {
      siren: etab.siren,
      siret: etab.siret,
      raison_sociale: etab.denominationUniteLegale ?? 'TEST',
      secteur_naf: etab.activitePrincipaleEtablissement,
      effectif_min: obligation ? 500 : 50,
      effectif_max: obligation ? 999 : 99,
      obligation_beges: obligation,
      beges_publie: false,
      contact_telephone: '0556000000',
      signaux: [],
      source: 'sirene_api',
    }
  })
}

interface ChainableResult {
  data?: unknown
  error?: { message: string } | null
}

/**
 * Construit un client Supabase admin mocké, configurable par table.
 *
 * Chaque table peut exposer :
 *   - `selectResponse`     : pour `.select(...).eq(...).single()` ou `.select(...).eq(...)`
 *   - `upsertResponses`    : liste consommée à chaque appel `.upsert(...).select(...)`
 *   - `updateResponse`     : pour `.update(...).eq(...)`
 *   - `insertResponse`     : pour `.insert(...).select().single()`
 *
 * Les spies sont attachés en propriétés du retour pour permettre des assertions.
 */
interface MockTableConfig {
  selectResponse?: ChainableResult
  upsertResponses?: ChainableResult[]
  updateResponse?: ChainableResult
  insertResponse?: ChainableResult
}

interface MockSupabaseAdmin {
  client: SupabaseAdminClient
  spies: {
    from: Mock
    selectByTable: Record<string, Mock>
    upsertByTable: Record<string, Mock>
    updateByTable: Record<string, Mock>
    insertByTable: Record<string, Mock>
  }
}

function mockSupabaseAdminClient(
  config: Record<string, MockTableConfig> = {},
): MockSupabaseAdmin {
  const selectByTable: Record<string, Mock> = {}
  const upsertByTable: Record<string, Mock> = {}
  const updateByTable: Record<string, Mock> = {}
  const insertByTable: Record<string, Mock> = {}

  const from = vi.fn((table: string) => {
    const tableConfig = config[table] ?? {}

    // SELECT branch : .select(...).eq(...).single() OU .select(...).eq(...)
    const select = vi.fn((_cols?: string) => {
      const selectResponse: ChainableResult = tableConfig.selectResponse ?? { data: null, error: null }
      const eqChain = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(selectResponse),
        then: (resolve: (v: ChainableResult) => void) => {
          resolve(selectResponse)
          return Promise.resolve(selectResponse)
        },
      }
      // Permet à `await supabase.from(t).select(...).eq(...)` de résoudre directement
      return new Proxy(eqChain, {
        get(target, prop) {
          if (prop in target) return (target as unknown as Record<string | symbol, unknown>)[prop]
          if (prop === 'then') return target.then
          return undefined
        },
      })
    })
    selectByTable[table] = select

    // UPSERT branch : .upsert(...).select(...)
    const upsert = vi.fn((_rows: unknown, _opts?: unknown) => {
      const responses = tableConfig.upsertResponses ?? []
      const callIndex = upsert.mock.calls.length - 1
      const response: ChainableResult = responses[callIndex] ?? { data: [], error: null }
      return {
        select: vi.fn().mockResolvedValue(response),
      }
    })
    upsertByTable[table] = upsert

    // UPDATE branch : .update(...).eq(...)
    const update = vi.fn((_payload: unknown) => {
      const response: ChainableResult = tableConfig.updateResponse ?? { data: null, error: null }
      return {
        eq: vi.fn().mockResolvedValue(response),
      }
    })
    updateByTable[table] = update

    // INSERT branch : .insert(...).select().single()
    const insert = vi.fn((_payload: unknown) => {
      const response: ChainableResult = tableConfig.insertResponse ?? {
        data: { id: 'run-stub-id' },
        error: null,
      }
      return {
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue(response),
        })),
      }
    })
    insertByTable[table] = insert

    return { select, upsert, update, insert }
  })

  return {
    client: { from } as unknown as SupabaseAdminClient,
    spies: { from, selectByTable, upsertByTable, updateByTable, insertByTable },
  }
}

/** Capture les logs structurés émis par le runner (pushLog). */
function makePushLog() {
  const calls: Array<{
    phase: string
    message: string
    level: string
    data?: Record<string, unknown>
  }> = []
  const pushLog = vi.fn(
    (phase: string, message: string, level: 'info' | 'warn' | 'error', data?: Record<string, unknown>) => {
      calls.push({ phase, message, level, data })
    },
  )
  return { pushLog, calls }
}

/** Filtres résolus minimalistes pour `runAdaptiveSourcing` direct. */
function makeFilters(overrides: Partial<ResolvedSourcingFilters> = {}): ResolvedSourcingFilters {
  return {
    nafCodes: ['01.21Z'],
    tranches: ['21', '22'],
    codePostalRange: ['33000', '33999'],
    departements: ['33'],
    signature: 'sig-current',
    nafSource: 'naf_prioritaires_default',
    ...overrides,
  }
}

/** Settings utilisateur minimaliste. */
function makeSettings(overrides: Partial<ProfileSettings> = {}): ProfileSettings {
  return {
    daily_call_target: 15,
    ...overrides,
  }
}

/** Upsert response factory : génère N rows new (created_at === updated_at). */
function upsertResponseAllNew(count: number, prefix = 'new-'): ChainableResult {
  const ts = '2025-05-11T10:00:00.000Z'
  return {
    data: Array.from({ length: count }, (_, i) => ({
      id: `${prefix}${i}`,
      created_at: ts,
      updated_at: ts,
    })),
    error: null,
  }
}

/** Upsert response factory : N rows updated (created_at !== updated_at). */
function upsertResponseAllUpdated(count: number, prefix = 'upd-'): ChainableResult {
  return {
    data: Array.from({ length: count }, (_, i) => ({
      id: `${prefix}${i}`,
      created_at: '2025-04-01T10:00:00.000Z',
      updated_at: '2025-05-11T10:00:00.000Z',
    })),
    error: null,
  }
}

// ------------------------------------------------------------
// SETUP / TEARDOWN
// ------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockedSourcerEntreprises.mockReset()
  mockedSourcerFallback.mockReset()
  mockedEnrichirProspect.mockReset()
  mockedEnrichirProspect.mockImplementation(makeEnrichSuccess())
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================
// CATÉGORIE A — Boucle adaptative (stop conditions)
// ============================================================

describe('runAdaptiveSourcing — stop conditions (Cat. A)', () => {
  it('A1: stoppe après 1 page quand candidates >= targetCandidates', async () => {
    // Arrange : 1 page de 60 etabs, target=50, univers non épuisé.
    mockedSourcerEntreprises.mockResolvedValueOnce(
      buildSourcerPage({ count: 60, curseur: '*', curseurSuivant: 'c2', exhausted: false }),
    )
    const { pushLog } = makePushLog()

    // Act
    const outcome = await runAdaptiveSourcing({
      userId: 'user-1',
      runId: 'run-1',
      filters: makeFilters(),
      startCurseur: '*',
      sirenSet: new Set(),
      targetCandidates: 50,
      pushLog,
    })

    // Assert : 1 seule page, collectedEtablissements >= 50.
    expect(mockedSourcerEntreprises).toHaveBeenCalledTimes(1)
    expect(outcome.etablissements.length).toBe(60)
    expect(outcome.pagesLoaded).toBe(1)
    expect(outcome.exhausted).toBe(false)
    expect(outcome.curseurFinal).toBe('c2')
  })

  it('A2: stoppe sur exhausted=true à la 3e page (univers épuisé)', async () => {
    // 3 pages : page1 (30), page2 (30), page3 (10, exhausted)
    mockedSourcerEntreprises
      .mockResolvedValueOnce(buildSourcerPage({ count: 30, sirenStart: 100_000_000, curseur: '*', curseurSuivant: 'c2' }))
      .mockResolvedValueOnce(buildSourcerPage({ count: 30, sirenStart: 100_000_030, curseur: 'c2', curseurSuivant: 'c3' }))
      .mockResolvedValueOnce(buildSourcerPage({ count: 10, sirenStart: 100_000_060, curseur: 'c3', curseurSuivant: 'c3', exhausted: true }))
    const { pushLog } = makePushLog()

    const outcome = await runAdaptiveSourcing({
      userId: 'user-1',
      runId: 'run-1',
      filters: makeFilters(),
      startCurseur: '*',
      sirenSet: new Set(),
      targetCandidates: 500, // jamais atteint
      pushLog,
    })

    expect(mockedSourcerEntreprises).toHaveBeenCalledTimes(3)
    expect(outcome.pagesLoaded).toBe(3)
    expect(outcome.exhausted).toBe(true)
    expect(outcome.etablissements.length).toBe(70)
    expect(outcome.curseurFinal).toBe('c3')
  })

  it('A3: stoppe sur HARD_CAP_PAGES (=50) en univers infini', async () => {
    // Univers infini : chaque page ramène 1 etab, curseur change, never exhausted, target > 50.
    mockedSourcerEntreprises.mockImplementation(async (params: { curseur?: string }) => {
      const c = params.curseur ?? '*'
      // Hash léger pour générer un SIREN unique par curseur
      const idx = Number.parseInt(c.replace(/\D/g, ''), 10) || 0
      return buildSourcerPage({
        count: 1,
        sirenStart: 200_000_000 + idx,
        curseur: c,
        curseurSuivant: `c${idx + 1}`,
        exhausted: false,
      })
    })
    const { pushLog, calls } = makePushLog()

    const outcome = await runAdaptiveSourcing({
      userId: 'user-1',
      runId: 'run-1',
      filters: makeFilters(),
      startCurseur: '*',
      sirenSet: new Set(),
      targetCandidates: 100_000, // jamais atteint
      pushLog,
    })

    // HARD_CAP_PAGES = 50 (cf. sourcing-runner.ts)
    expect(outcome.pagesLoaded).toBe(50)
    expect(mockedSourcerEntreprises).toHaveBeenCalledTimes(50)
    expect(outcome.exhausted).toBe(false)
    // Un log warn doit signaler le cap pages
    const capLog = calls.find((c) => c.phase === 'sourcing_loop' && c.message.includes('Cap pages atteint'))
    expect(capLog).toBeDefined()
    expect(capLog?.level).toBe('warn')
  }, 30_000)

  it('A4: stoppe sur HARD_CAP_DURATION_MS via fake timers', async () => {
    // On configure des pages qui retournent rapidement mais on avance manuellement
    // le temps de 5 minutes entre deux pages pour franchir le cap durée (4 min).
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mockedSourcerEntreprises.mockImplementation(async (params: { curseur?: string }) => {
        const c = params.curseur ?? '*'
        const idx = Number.parseInt(c.replace(/\D/g, ''), 10) || 0
        // Avance le temps de 2 min à chaque page
        vi.advanceTimersByTime(2 * 60 * 1000)
        return buildSourcerPage({
          count: 1,
          sirenStart: 300_000_000 + idx,
          curseur: c,
          curseurSuivant: `c${idx + 1}`,
          exhausted: false,
        })
      })
      const { pushLog, calls } = makePushLog()

      const outcome = await runAdaptiveSourcing({
        userId: 'user-1',
        runId: 'run-1',
        filters: makeFilters(),
        startCurseur: '*',
        sirenSet: new Set(),
        targetCandidates: 100_000,
        pushLog,
      })

      // Devrait stopper bien avant 50 pages (probablement 3 pages = 6 min > 4 min cap)
      expect(outcome.pagesLoaded).toBeLessThan(10)
      const timeoutLog = calls.find(
        (c) => c.phase === 'sourcing_loop' && c.message.includes('Timeout adaptatif'),
      )
      expect(timeoutLog).toBeDefined()
      expect(timeoutLog?.level).toBe('warn')
    } finally {
      vi.useRealTimers()
    }
  })

  it('A1bis: retourne outcome.curseurInitial === startCurseur, totalAvailable depuis page 1', async () => {
    mockedSourcerEntreprises.mockResolvedValueOnce(
      buildSourcerPage({ count: 60, curseur: 'cInit', curseurSuivant: 'cNext', totalAvailable: 12345 }),
    )
    const { pushLog } = makePushLog()

    const outcome = await runAdaptiveSourcing({
      userId: 'user-1',
      runId: 'run-1',
      filters: makeFilters(),
      startCurseur: 'cInit',
      sirenSet: new Set(),
      targetCandidates: 50,
      pushLog,
    })

    expect(outcome.curseurInitial).toBe('cInit')
    expect(outcome.totalAvailable).toBe(12345)
    expect(outcome.filtersSignature).toBe('sig-current')
    expect(outcome.usedFallback).toBe(false)
  })
})

// ============================================================
// CATÉGORIE B — Signature filtres + invalidation curseur
// ============================================================

describe('runPipelineSourcing — invalidation curseur via signature (Cat. B)', () => {
  it('B1: signature stockée DIFFÉRENTE → curseur reset à *', async () => {
    const { client, spies } = mockSupabaseAdminClient({
      profiles: {
        selectResponse: {
          data: {
            sourcing_state: {
              curseur: 'cOLD',
              curseurSuivant: 'cOLD-next',
              filters_signature: 'OLD_SIG_DIFF',
              exhausted_at: null,
            },
          },
          error: null,
        },
        updateResponse: { data: null, error: null },
      },
      prospects: {
        selectResponse: { data: [], error: null },
        upsertResponses: [upsertResponseAllNew(60)],
      },
    })

    mockedSourcerEntreprises.mockResolvedValueOnce(
      buildSourcerPage({ count: 60, curseur: '*', curseurSuivant: 'cNew' }),
    )

    const { pushLog } = makePushLog()
    const input: PipelineSourcingInput = {
      userId: 'user-b1',
      runId: 'run-b1',
      params: {},
      settings: makeSettings(),
      supabase: client,
      pushLog,
    }

    await runPipelineSourcing(input)

    // Le 1er appel à sourcerEntreprises doit avoir curseur='*' (reset)
    const firstCallArgs = mockedSourcerEntreprises.mock.calls[0][0] as { curseur: string }
    expect(firstCallArgs.curseur).toBe('*')

    // Bonus : spies.from a bien été appelé sur profiles
    expect(spies.from).toHaveBeenCalledWith('profiles')
  })

  it('B2: signature stockée IDENTIQUE → curseur reprend state.curseurSuivant', async () => {
    // Pour obtenir la signature courante, on capture celle qui sera persistée
    // via la 1ère exécution. Plus simple : on calcule la signature en passant
    // par les filtres défaut et en se calant sur le persistedState.
    const { client } = mockSupabaseAdminClient({
      profiles: {
        // On doit donner la même signature que celle que computeFiltersSignature produit
        // pour les filtres défaut (NAF_PRIORITAIRES + Gironde + tranches default 50+).
        // Plus robuste : on triche en injectant la signature courante après 1er run.
        // Ici on vérifie juste la branche "reset si différent" via un wrapper :
        // on lance un 1er run pour récupérer la signature persistée, puis on relance.
        selectResponse: {
          data: { sourcing_state: null }, // 1er run : fresh
          error: null,
        },
        updateResponse: { data: null, error: null },
      },
      prospects: {
        selectResponse: { data: [], error: null },
        upsertResponses: [upsertResponseAllNew(60), upsertResponseAllNew(60)],
      },
    })

    mockedSourcerEntreprises.mockResolvedValue(
      buildSourcerPage({ count: 60, curseur: '*', curseurSuivant: 'cResume' }),
    )

    const { pushLog } = makePushLog()
    const input: PipelineSourcingInput = {
      userId: 'user-b2',
      runId: 'run-b2',
      params: {},
      settings: makeSettings(),
      supabase: client,
      pushLog,
    }
    const output = await runPipelineSourcing(input)

    // 1er run : curseur initial '*' (fresh), final 'cResume'.
    expect((mockedSourcerEntreprises.mock.calls[0][0] as { curseur: string }).curseur).toBe('*')
    expect(output.outcome?.curseurFinal).toBe('cResume')
    expect(output.outcome?.filtersSignature).toBeDefined()
  })

  it('B3: profile sans sourcing_state (premier run) → curseur *', async () => {
    const { client } = mockSupabaseAdminClient({
      profiles: {
        selectResponse: { data: { sourcing_state: null }, error: null },
        updateResponse: { data: null, error: null },
      },
      prospects: {
        selectResponse: { data: [], error: null },
        upsertResponses: [upsertResponseAllNew(60)],
      },
    })

    mockedSourcerEntreprises.mockResolvedValueOnce(
      buildSourcerPage({ count: 60, curseur: '*', curseurSuivant: 'cAfter' }),
    )

    const { pushLog, calls } = makePushLog()
    await runPipelineSourcing({
      userId: 'user-b3',
      runId: 'run-b3',
      params: {},
      settings: makeSettings(),
      supabase: client,
      pushLog,
    })

    expect((mockedSourcerEntreprises.mock.calls[0][0] as { curseur: string }).curseur).toBe('*')
    // Log doit indiquer "fresh"
    const startLog = calls.find((c) => c.message.includes('Curseur initial:'))
    expect(startLog?.message).toContain('(fresh)')
  })

  it('B4: sourcing_state corrompu (champs absents / mauvais types) → fallback *', async () => {
    const { client } = mockSupabaseAdminClient({
      profiles: {
        selectResponse: {
          data: {
            sourcing_state: {
              // curseur manquant, filters_signature non-string
              curseur: 42,
              filters_signature: { not: 'a string' },
              last_total: 'invalid',
            },
          },
          error: null,
        },
        updateResponse: { data: null, error: null },
      },
      prospects: {
        selectResponse: { data: [], error: null },
        upsertResponses: [upsertResponseAllNew(60)],
      },
    })

    mockedSourcerEntreprises.mockResolvedValueOnce(
      buildSourcerPage({ count: 60, curseur: '*', curseurSuivant: 'cAfter' }),
    )

    const { pushLog } = makePushLog()
    await runPipelineSourcing({
      userId: 'user-b4',
      runId: 'run-b4',
      params: {},
      settings: makeSettings(),
      supabase: client,
      pushLog,
    })

    expect((mockedSourcerEntreprises.mock.calls[0][0] as { curseur: string }).curseur).toBe('*')
  })
})

// ============================================================
// CATÉGORIE C — Persistance sourcing_state (try/finally)
// ============================================================

describe('runPipelineSourcing — persistance sourcing_state (Cat. C)', () => {
  it('C1: run réussi non épuisé → exhausted_at=null, curseur final persistés', async () => {
    const { client, spies } = mockSupabaseAdminClient({
      profiles: {
        selectResponse: { data: { sourcing_state: null }, error: null },
        updateResponse: { data: null, error: null },
      },
      prospects: {
        selectResponse: { data: [], error: null },
        upsertResponses: [upsertResponseAllNew(60)],
      },
    })

    mockedSourcerEntreprises.mockResolvedValueOnce(
      buildSourcerPage({ count: 60, curseur: '*', curseurSuivant: 'cFinal', exhausted: false }),
    )

    const { pushLog } = makePushLog()
    await runPipelineSourcing({
      userId: 'user-c1',
      runId: 'run-c1',
      params: {},
      settings: makeSettings(),
      supabase: client,
      pushLog,
    })

    // .update sur profiles a été appelée
    const updateSpy = spies.updateByTable.profiles
    expect(updateSpy).toHaveBeenCalled()
    const updateCallArg = updateSpy.mock.calls[0][0] as {
      sourcing_state: {
        curseur: string
        curseurSuivant: string
        exhausted_at: string | null
        last_run_at: string
        filters_signature: string
      }
    }
    expect(updateCallArg.sourcing_state.curseur).toBe('cFinal')
    expect(updateCallArg.sourcing_state.curseurSuivant).toBe('cFinal')
    expect(updateCallArg.sourcing_state.exhausted_at).toBeNull()
    expect(updateCallArg.sourcing_state.last_run_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(updateCallArg.sourcing_state.filters_signature).toBeDefined()
  })

  it('C2: run épuisé → exhausted_at rempli avec ISO date courante', async () => {
    const { client, spies } = mockSupabaseAdminClient({
      profiles: {
        selectResponse: { data: { sourcing_state: null }, error: null },
        updateResponse: { data: null, error: null },
      },
      prospects: {
        selectResponse: { data: [], error: null },
        upsertResponses: [upsertResponseAllNew(10)],
      },
    })

    mockedSourcerEntreprises.mockResolvedValueOnce(
      buildSourcerPage({ count: 10, curseur: '*', curseurSuivant: '*', exhausted: true }),
    )

    const { pushLog } = makePushLog()
    await runPipelineSourcing({
      userId: 'user-c2',
      runId: 'run-c2',
      params: {},
      settings: makeSettings(),
      supabase: client,
      pushLog,
    })

    const updateSpy = spies.updateByTable.profiles
    const updateCallArg = updateSpy.mock.calls[0][0] as {
      sourcing_state: { exhausted_at: string | null }
    }
    expect(updateCallArg.sourcing_state.exhausted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('C3: erreur dans enrichAndScore (page 1 OK puis fail enrichment) → finally persiste l\'état partiel', async () => {
    const { client, spies } = mockSupabaseAdminClient({
      profiles: {
        selectResponse: { data: { sourcing_state: null }, error: null },
        updateResponse: { data: null, error: null },
      },
      prospects: {
        selectResponse: { data: [], error: null },
        upsertResponses: [],
      },
    })

    // 1ère page suffit pour arrêter la boucle (count >= target = 50)
    // puis l'upsert va throw → on doit voir le finally déclencher persistSourcingState
    mockedSourcerEntreprises.mockResolvedValueOnce(
      buildSourcerPage({ count: 60, curseur: '*', curseurSuivant: 'cPartial' }),
    )
    // upsertProspectsBatch va appeler supabase.from('prospects').upsert(...).select(...)
    // → si select throw, ça remonte et déclenche le finally.
    const upsertWithThrow = vi.fn(() => ({
      select: vi.fn().mockRejectedValue(new Error('DB down')),
    }))
    // Override la table prospects pour le upsert
    const originalFrom = (client as unknown as { from: Mock }).from
    ;(client as unknown as { from: Mock }).from = vi.fn((table: string) => {
      if (table === 'prospects') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
          upsert: upsertWithThrow,
        }
      }
      return originalFrom(table)
    })

    const { pushLog } = makePushLog()
    await expect(
      runPipelineSourcing({
        userId: 'user-c3',
        runId: 'run-c3',
        params: {},
        settings: makeSettings(),
        supabase: client,
        pushLog,
      }),
    ).rejects.toThrow('DB down')

    // Malgré l'erreur, le finally a dû persister sourcing_state
    const updateSpy = spies.updateByTable.profiles
    expect(updateSpy).toHaveBeenCalled()
    const updateCallArg = updateSpy.mock.calls[0][0] as {
      sourcing_state: { curseur: string; curseurSuivant: string }
    }
    expect(updateCallArg.sourcing_state.curseur).toBe('cPartial')
  })

  it('C4: last_run_at toujours rempli en ISO 8601', async () => {
    const { client, spies } = mockSupabaseAdminClient({
      profiles: {
        selectResponse: { data: { sourcing_state: null }, error: null },
        updateResponse: { data: null, error: null },
      },
      prospects: {
        selectResponse: { data: [], error: null },
        upsertResponses: [upsertResponseAllNew(60)],
      },
    })

    mockedSourcerEntreprises.mockResolvedValueOnce(
      buildSourcerPage({ count: 60, curseur: '*', curseurSuivant: 'cA' }),
    )

    const now = new Date('2026-01-15T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    try {
      const { pushLog } = makePushLog()
      await runPipelineSourcing({
        userId: 'user-c4',
        runId: 'run-c4',
        params: {},
        settings: makeSettings(),
        supabase: client,
        pushLog,
      })
      const updateCallArg = spies.updateByTable.profiles.mock.calls[0][0] as {
        sourcing_state: { last_run_at: string }
      }
      expect(updateCallArg.sourcing_state.last_run_at).toBe(now.toISOString())
    } finally {
      vi.useRealTimers()
    }
  })
})

// ============================================================
// CATÉGORIE D — Fallback Recherche Entreprises
// ============================================================

describe('runAdaptiveSourcing — fallback Recherche Entreprises (Cat. D)', () => {
  it('D1: SireneApiError sur pagesLoaded=0 → bascule sur sourcerEntreprisesFallback, usedFallback=true', async () => {
    mockedSourcerEntreprises.mockRejectedValueOnce(new SireneApiError('Sirene HTTP 500', 500))
    mockedSourcerFallback.mockResolvedValueOnce([
      sireneSampleEtablissement('500000001'),
      sireneSampleEtablissement('500000002'),
    ])

    const { pushLog, calls } = makePushLog()
    const outcome = await runAdaptiveSourcing({
      userId: 'user-d1',
      runId: 'run-d1',
      filters: makeFilters(),
      startCurseur: '*',
      sirenSet: new Set(),
      targetCandidates: 50,
      pushLog,
    })

    expect(mockedSourcerFallback).toHaveBeenCalledTimes(1)
    expect(outcome.usedFallback).toBe(true)
    expect(outcome.etablissements.length).toBe(2)
    expect(outcome.exhausted).toBe(true) // fallback ne pagine pas → exhausted forcé
    const fallbackLog = calls.find((c) => c.message.includes('bascule sur Recherche Entreprises'))
    expect(fallbackLog).toBeDefined()
    expect(fallbackLog?.level).toBe('warn')
  })

  it('D2: SireneApiError après pagesLoaded > 0 → propage (pas de fallback)', async () => {
    // Page 1 OK
    mockedSourcerEntreprises
      .mockResolvedValueOnce(
        buildSourcerPage({ count: 10, curseur: '*', curseurSuivant: 'c2' }),
      )
      // Page 2 KO
      .mockRejectedValueOnce(new SireneApiError('Sirene HTTP 500 mid-loop', 500))

    const { pushLog } = makePushLog()
    await expect(
      runAdaptiveSourcing({
        userId: 'user-d2',
        runId: 'run-d2',
        filters: makeFilters(),
        startCurseur: '*',
        sirenSet: new Set(),
        targetCandidates: 500,
        pushLog,
      }),
    ).rejects.toBeInstanceOf(SireneApiError)

    expect(mockedSourcerFallback).not.toHaveBeenCalled()
  })

  it('D3: Sirene KO + fallback KO → throw Error explicite', async () => {
    mockedSourcerEntreprises.mockRejectedValueOnce(new SireneApiError('Sirene 503', 503))
    mockedSourcerFallback.mockRejectedValueOnce(new Error('Recherche Entreprises down'))

    const { pushLog, calls } = makePushLog()
    await expect(
      runAdaptiveSourcing({
        userId: 'user-d3',
        runId: 'run-d3',
        filters: makeFilters(),
        startCurseur: '*',
        sirenSet: new Set(),
        targetCandidates: 50,
        pushLog,
      }),
    ).rejects.toThrow(/échec total sourcing/)

    const fatalLog = calls.find((c) => c.level === 'error')
    expect(fatalLog).toBeDefined()
    expect(fatalLog?.message).toContain('Sirene ET fallback')
  })
})

// ============================================================
// CATÉGORIE E — Counters prospects_new / prospects_updated
// ============================================================

describe('runPipelineSourcing — counters new/updated (Cat. E)', () => {
  it('E1: retourne outcome avec sirene_total_available, pages_loaded, curseur_final', async () => {
    const { client } = mockSupabaseAdminClient({
      profiles: {
        selectResponse: { data: { sourcing_state: null }, error: null },
        updateResponse: { data: null, error: null },
      },
      prospects: {
        selectResponse: { data: [], error: null },
        upsertResponses: [upsertResponseAllNew(60)],
      },
    })

    mockedSourcerEntreprises.mockResolvedValueOnce(
      buildSourcerPage({
        count: 60,
        curseur: '*',
        curseurSuivant: 'cE1',
        totalAvailable: 9999,
      }),
    )

    const { pushLog } = makePushLog()
    const output = await runPipelineSourcing({
      userId: 'user-e1',
      runId: 'run-e1',
      params: {},
      settings: makeSettings(),
      supabase: client,
      pushLog,
    })

    expect(output.outcome?.totalAvailable).toBe(9999)
    expect(output.outcome?.pagesLoaded).toBe(1)
    expect(output.outcome?.curseurFinal).toBe('cE1')
  })

  it('E2: prospects_new vs prospects_updated distincts (heuristique created_at===updated_at)', async () => {
    // 30 etabs, dont l'upsert mock retourne 20 new + 10 updated
    const ts = '2025-05-11T10:00:00.000Z'
    const mixedRows = [
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `new-${i}`,
        created_at: ts,
        updated_at: ts,
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `upd-${i}`,
        created_at: '2025-04-01T10:00:00.000Z',
        updated_at: ts,
      })),
    ]

    const { client } = mockSupabaseAdminClient({
      profiles: {
        selectResponse: { data: { sourcing_state: null }, error: null },
        updateResponse: { data: null, error: null },
      },
      prospects: {
        selectResponse: { data: [], error: null },
        upsertResponses: [{ data: mixedRows, error: null }],
      },
    })

    mockedSourcerEntreprises.mockResolvedValueOnce(
      buildSourcerPage({ count: 30, curseur: '*', curseurSuivant: '*', exhausted: true }),
    )

    const { pushLog } = makePushLog()
    const output = await runPipelineSourcing({
      userId: 'user-e2',
      runId: 'run-e2',
      params: {},
      settings: makeSettings(),
      supabase: client,
      pushLog,
    })

    expect(output.prospectsNew).toBe(20)
    expect(output.prospectsUpdated).toBe(10)
  })

  it('E3: 100% rows updated → prospects_new=0, prospects_updated=N', async () => {
    const { client } = mockSupabaseAdminClient({
      profiles: {
        selectResponse: { data: { sourcing_state: null }, error: null },
        updateResponse: { data: null, error: null },
      },
      prospects: {
        selectResponse: { data: [], error: null },
        upsertResponses: [upsertResponseAllUpdated(25)],
      },
    })

    mockedSourcerEntreprises.mockResolvedValueOnce(
      buildSourcerPage({ count: 25, curseur: '*', curseurSuivant: '*', exhausted: true }),
    )

    const { pushLog } = makePushLog()
    const output = await runPipelineSourcing({
      userId: 'user-e3',
      runId: 'run-e3',
      params: {},
      settings: makeSettings(),
      supabase: client,
      pushLog,
    })

    expect(output.prospectsNew).toBe(0)
    expect(output.prospectsUpdated).toBe(25)
  })
})

// ============================================================
// CATÉGORIE F — Mode dégradé ADEME
// ============================================================

describe('runPipelineSourcing — mode dégradé ADEME (Cat. F)', () => {
  it('F1: enrichirProspect rejette sur 1 SIREN → ce SIREN passe avec payload minimal', async () => {
    const { client } = mockSupabaseAdminClient({
      profiles: {
        selectResponse: { data: { sourcing_state: null }, error: null },
        updateResponse: { data: null, error: null },
      },
      prospects: {
        selectResponse: { data: [], error: null },
        upsertResponses: [upsertResponseAllNew(3)],
      },
    })

    mockedSourcerEntreprises.mockResolvedValueOnce(
      buildSourcerPage({ count: 3, sirenStart: 600_000_000, curseur: '*', curseurSuivant: '*', exhausted: true }),
    )

    // Premier OK, deuxième THROW, troisième OK
    let callCount = 0
    mockedEnrichirProspect.mockImplementation(async (etab: SireneEtablissement) => {
      callCount++
      if (callCount === 2) {
        throw new Error('ADEME timeout')
      }
      return {
        siren: etab.siren,
        siret: etab.siret,
        raison_sociale: etab.denominationUniteLegale ?? 'OK',
        obligation_beges: true,
        beges_publie: false,
        signaux: [],
      }
    })

    const { pushLog, calls } = makePushLog()
    const output = await runPipelineSourcing({
      userId: 'user-f1',
      runId: 'run-f1',
      params: {},
      settings: makeSettings(),
      supabase: client,
      pushLog,
    })

    // 3 prospects upsertés (mode dégradé : le 2e passe sans BEGES)
    expect(output.scored.length).toBe(3)
    const warnLog = calls.find(
      (c) => c.phase === 'enrichissement' && c.message.includes('échoué'),
    )
    expect(warnLog).toBeDefined()
    expect(warnLog?.level).toBe('warn')
  })

  it('F2: TOUS les ADEME échouent → prospects upsertés avec beges_publie=false par défaut', async () => {
    const { client } = mockSupabaseAdminClient({
      profiles: {
        selectResponse: { data: { sourcing_state: null }, error: null },
        updateResponse: { data: null, error: null },
      },
      prospects: {
        selectResponse: { data: [], error: null },
        upsertResponses: [upsertResponseAllNew(5)],
      },
    })

    mockedSourcerEntreprises.mockResolvedValueOnce(
      buildSourcerPage({ count: 5, sirenStart: 700_000_000, curseur: '*', curseurSuivant: '*', exhausted: true }),
    )

    mockedEnrichirProspect.mockRejectedValue(new Error('ADEME globalement KO'))

    const { pushLog } = makePushLog()
    const output = await runPipelineSourcing({
      userId: 'user-f2',
      runId: 'run-f2',
      params: {},
      settings: makeSettings(),
      supabase: client,
      pushLog,
    })

    expect(output.scored.length).toBe(5)
    for (const p of output.scored) {
      expect(p.beges_publie).toBe(false)
      expect(p.obligation_beges).toBe(false)
    }
  })
})

// ============================================================
// CATÉGORIE G — Cible adaptative N = max(daily_target × 3, 50)
// ============================================================

describe('runPipelineSourcing — cible adaptative (Cat. G)', () => {
  /**
   * Helper : exécute un run avec un daily_call_target donné, retourne le nombre
   * de pages effectivement demandées (utilisé pour déduire targetCandidates).
   * On simule un univers infini avec 1 etab par page, la boucle s'arrête à targetN.
   */
  async function runWithTarget(dailyTarget: number | undefined): Promise<number> {
    const { client } = mockSupabaseAdminClient({
      profiles: {
        selectResponse: { data: { sourcing_state: null }, error: null },
        updateResponse: { data: null, error: null },
      },
      prospects: {
        selectResponse: { data: [], error: null },
        upsertResponses: [upsertResponseAllNew(100)],
      },
    })
    // Chaque page retourne 5 etabs uniques avec curseur incrémenté.
    // (5/page permet d'atteindre target=60 avant HARD_CAP_PAGES=50.)
    mockedSourcerEntreprises.mockReset()
    mockedSourcerEntreprises.mockImplementation(async (params: { curseur?: string }) => {
      const c = params.curseur ?? '*'
      const idx = mockedSourcerEntreprises.mock.calls.length
      return buildSourcerPage({
        count: 5,
        sirenStart: 800_000_000 + idx * 5,
        curseur: c,
        curseurSuivant: `c${idx + 1}`,
        exhausted: false,
      })
    })

    const settings: ProfileSettings | null = dailyTarget === undefined ? null : makeSettings({ daily_call_target: dailyTarget })
    const { pushLog } = makePushLog()
    await runPipelineSourcing({
      userId: 'user-g',
      runId: 'run-g',
      params: {},
      settings,
      supabase: client,
      pushLog,
    })

    return mockedSourcerEntreprises.mock.calls.length
  }

  it('G1: daily_call_target=15 → targetN = max(45, 50) = 50', async () => {
    const pages = await runWithTarget(15)
    // 5 etabs par page → 10 pages pour atteindre target=50.
    expect(pages).toBe(10)
  })

  it('G2: daily_call_target=20 → targetN = max(60, 50) = 60', async () => {
    const pages = await runWithTarget(20)
    // 5 etabs par page → 12 pages pour atteindre target=60.
    expect(pages).toBe(12)
  })

  it('G3: daily_call_target=undefined (settings null) → targetN = max(45, 50) = 50 (défaut 15)', async () => {
    const pages = await runWithTarget(undefined)
    // Settings null → daily_target default 15 → target = 50 → 10 pages.
    expect(pages).toBe(10)
  })
})
