// ============================================================
// TESTS UNITAIRES — lib/agent/pipeline-metrics.ts
//
// Cibles :
//   - getPipelineMetricsDaily : mapping snake_case → camelCase,
//     coercion numeric (string PostgREST → number), NULL → null,
//     application des filtres (userId, fromDay, toDay, limit),
//     tri day DESC, cas d'erreur Supabase, exception réseau.
// ============================================================

import { describe, expect, it, vi, type Mock } from 'vitest'
import type { SupabaseAdminClient } from '@/lib/supabase/server'

import {
  getPipelineMetricsDaily,
  type PipelineMetricsDaily,
} from '../pipeline-metrics'

// ------------------------------------------------------------
// HELPERS — mock client Supabase (query builder chainable)
// ------------------------------------------------------------

interface MockSupabaseConfig {
  /** Réponse finale résolue par `.limit()` (terminal de la chaîne). */
  response?: {
    data: unknown
    error: { message: string } | null
  }
  /** Si défini, `.limit()` rejette avec cette erreur (exception réseau). */
  reject?: Error
}

interface MockSupabase {
  client: SupabaseAdminClient
  from: Mock
  select: Mock
  eq: Mock
  gte: Mock
  lte: Mock
  order: Mock
  limit: Mock
}

function makeMockSupabase(config: MockSupabaseConfig = {}): MockSupabase {
  const response = config.response ?? { data: [], error: null }

  // Le builder est chainable : eq/gte/lte/order renvoient `builder`,
  // `limit` est le terminal (thenable) qui résout `response`.
  const builder: Record<string, Mock> = {}

  const chain = (): typeof builder => builder

  builder.eq = vi.fn(chain)
  builder.gte = vi.fn(chain)
  builder.lte = vi.fn(chain)
  builder.order = vi.fn(chain)
  builder.limit = vi.fn(async () => {
    if (config.reject) throw config.reject
    return response
  })

  const select = vi.fn(() => builder)
  const from = vi.fn(() => ({ select }))

  const client = { from } as unknown as SupabaseAdminClient

  return {
    client,
    from,
    select,
    eq: builder.eq,
    gte: builder.gte,
    lte: builder.lte,
    order: builder.order,
    limit: builder.limit,
  }
}

/** Row brute typique renvoyée par la vue (numeric sérialisés en string). */
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    day: '2026-06-24',
    user_id: '11111111-1111-1111-1111-111111111111',
    runs_total: 4,
    runs_completed: 3,
    runs_failed: 1,
    runs_running: 0,
    success_rate: '0.7500',
    lists_generated: 3,
    total_sourced: 1200,
    total_qualified: 180,
    qualification_rate: '0.1500',
    avg_duration_seconds: '42.50',
    median_duration_seconds: '40.00',
    ...overrides,
  }
}

// ------------------------------------------------------------
// TESTS — mapping & typage
// ------------------------------------------------------------

describe('getPipelineMetricsDaily — mapping & typage', () => {
  it('mappe snake_case → camelCase et coerce les numeric (string → number)', async () => {
    const { client } = makeMockSupabase({
      response: { data: [makeRow()], error: null },
    })

    const result = await getPipelineMetricsDaily(client)
    expect(result).toHaveLength(1)

    const m: PipelineMetricsDaily = result[0]
    expect(m.day).toBe('2026-06-24')
    expect(m.userId).toBe('11111111-1111-1111-1111-111111111111')
    expect(m.runsTotal).toBe(4)
    expect(m.runsCompleted).toBe(3)
    expect(m.runsFailed).toBe(1)
    expect(m.runsRunning).toBe(0)
    // numeric PostgREST renvoyé en string → coercé en number
    expect(m.successRate).toBe(0.75)
    expect(m.listsGenerated).toBe(3)
    expect(m.totalSourced).toBe(1200)
    expect(m.totalQualified).toBe(180)
    expect(m.qualificationRate).toBe(0.15)
    expect(m.avgDurationSeconds).toBe(42.5)
    expect(m.medianDurationSeconds).toBe(40)
  })

  it('coerce les COUNT/SUM renvoyés en number natif (pas seulement string)', async () => {
    const { client } = makeMockSupabase({
      response: {
        data: [makeRow({ runs_total: 7, total_sourced: 999, success_rate: 1 })],
        error: null,
      },
    })

    const [m] = await getPipelineMetricsDaily(client)
    expect(m.runsTotal).toBe(7)
    expect(m.totalSourced).toBe(999)
    expect(m.successRate).toBe(1)
  })

  it('mappe les ratios/durées NULL (division par zéro / aucun run terminé) → null', async () => {
    const { client } = makeMockSupabase({
      response: {
        data: [
          makeRow({
            total_sourced: 0,
            total_qualified: 0,
            qualification_rate: null,
            avg_duration_seconds: null,
            median_duration_seconds: null,
          }),
        ],
        error: null,
      },
    })

    const [m] = await getPipelineMetricsDaily(client)
    expect(m.qualificationRate).toBeNull()
    expect(m.avgDurationSeconds).toBeNull()
    expect(m.medianDurationSeconds).toBeNull()
    // Les compteurs restent à 0 (pas null)
    expect(m.totalSourced).toBe(0)
    expect(m.totalQualified).toBe(0)
  })

  it('préserve l\'ordre des lignes renvoyées par la vue (tri day DESC)', async () => {
    const { client } = makeMockSupabase({
      response: {
        data: [
          makeRow({ day: '2026-06-24' }),
          makeRow({ day: '2026-06-23' }),
          makeRow({ day: '2026-06-22' }),
        ],
        error: null,
      },
    })

    const result = await getPipelineMetricsDaily(client)
    expect(result.map((r) => r.day)).toEqual(['2026-06-24', '2026-06-23', '2026-06-22'])
  })

  it('retourne [] quand la vue ne renvoie aucune ligne', async () => {
    const { client } = makeMockSupabase({ response: { data: [], error: null } })
    const result = await getPipelineMetricsDaily(client)
    expect(result).toEqual([])
  })

  it('tolère data=null (renvoie [])', async () => {
    const { client } = makeMockSupabase({ response: { data: null, error: null } })
    const result = await getPipelineMetricsDaily(client)
    expect(result).toEqual([])
  })
})

// ------------------------------------------------------------
// TESTS — ciblage de la vue & filtres
// ------------------------------------------------------------

describe('getPipelineMetricsDaily — query & filtres', () => {
  it('cible la vue pipeline_metrics_daily, trie day DESC et applique la limite par défaut (90)', async () => {
    const { client, from, order, limit } = makeMockSupabase({
      response: { data: [], error: null },
    })

    await getPipelineMetricsDaily(client)

    expect(from).toHaveBeenCalledWith('pipeline_metrics_daily')
    expect(order).toHaveBeenCalledWith('day', { ascending: false })
    expect(limit).toHaveBeenCalledWith(90)
  })

  it('n\'applique PAS .eq(user_id) quand userId est absent (RLS implicite côté SSR)', async () => {
    const { client, eq } = makeMockSupabase({ response: { data: [], error: null } })
    await getPipelineMetricsDaily(client)
    expect(eq).not.toHaveBeenCalled()
  })

  it('applique .eq(user_id) quand userId est fourni (ciblage admin)', async () => {
    const { client, eq } = makeMockSupabase({ response: { data: [], error: null } })
    await getPipelineMetricsDaily(client, { userId: 'user-42' })
    expect(eq).toHaveBeenCalledWith('user_id', 'user-42')
  })

  it('applique la fenêtre fromDay/toDay (gte/lte sur day) et la limite custom', async () => {
    const { client, gte, lte, limit } = makeMockSupabase({
      response: { data: [], error: null },
    })

    await getPipelineMetricsDaily(client, {
      fromDay: '2026-06-01',
      toDay: '2026-06-30',
      limit: 10,
    })

    expect(gte).toHaveBeenCalledWith('day', '2026-06-01')
    expect(lte).toHaveBeenCalledWith('day', '2026-06-30')
    expect(limit).toHaveBeenCalledWith(10)
  })
})

// ------------------------------------------------------------
// TESTS — cas d'erreur
// ------------------------------------------------------------

describe('getPipelineMetricsDaily — erreurs', () => {
  it('retourne [] sur erreur Supabase (vue absente / droits / réseau)', async () => {
    const { client } = makeMockSupabase({
      response: {
        data: null,
        error: { message: 'relation "pipeline_metrics_daily" does not exist' },
      },
    })

    const result = await getPipelineMetricsDaily(client)
    expect(result).toEqual([])
  })

  it('retourne [] sur exception inattendue (rejet réseau de .limit())', async () => {
    const { client } = makeMockSupabase({ reject: new Error('network failure') })
    const result = await getPipelineMetricsDaily(client)
    expect(result).toEqual([])
  })
})
