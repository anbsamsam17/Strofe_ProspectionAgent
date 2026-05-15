// ============================================================
// TESTS UNITAIRES — quotas.ts
// Vitest — pattern AAA (Arrange / Act / Assert)
//
// Le client Supabase est entièrement mocké via une fluent chain.
// Aucun appel réseau. Stratégie : on capture chaque appel chain
// (from / select / eq / update / upsert / maybeSingle) et on contrôle
// la valeur retournée selon les besoins du test.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  consumeQuota,
  getAllQuotas,
  getQuotaState,
  QUOTA_LIMITS,
  QUOTA_PROVIDERS,
  refundQuota,
  withQuota,
} from '../quotas'

// ------------------------------------------------------------
// HARNESS — un mock de SupabaseClient minimal, chainable, contrôlable
// ------------------------------------------------------------

interface RowState {
  used_count: number
  limit_count: number
  month_start: string
}

/**
 * Crée un mock Supabase qui retourne une "fake row" courante pour les .select(),
 * accepte .update() (qui modifie la row courante) et .upsert() (no-op marqué).
 *
 * - `row` : la ligne renvoyée par .select().eq(...).maybeSingle()
 *           (null = pas de ligne en base)
 * - `updateBehavior` : 'success' | 'race-lost' | 'error'
 */
function createSupabaseMock(opts: {
  row: RowState | null
  selectError?: { message: string } | null
  updateBehavior?: 'success' | 'race-lost' | 'error'
  upsertError?: { message: string } | null
}) {
  const calls = {
    from: [] as string[],
    upsert: [] as Array<{ payload: unknown; options: unknown }>,
    update: [] as Array<Record<string, unknown>>,
    select: [] as string[],
  }
  let currentRow: RowState | null = opts.row ? { ...opts.row } : null

  // Pour cibler le bon comportement : un appel select-then-maybeSingle => lecture,
  // un appel update-then-select => écriture.
  function makeChain(mode: 'select' | 'update' | 'upsert') {
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockImplementation(() => chain),
      maybeSingle: vi.fn().mockImplementation(async () => {
        if (mode !== 'select') return { data: null, error: null }
        if (opts.selectError) return { data: null, error: opts.selectError }
        return { data: currentRow, error: null }
      }),
      // Promise resolution pour le pattern `.update(...).eq(...).eq(...).select(...)`
      // qui n'a pas de .maybeSingle final — on rend la chain awaitable.
      then: undefined as unknown,
    }
    // Le UPDATE final renvoie via .select(...) qui est awaité directement
    if (mode === 'update') {
      // `.select(...)` retourne une promesse résolue
      ;(chain as Record<string, unknown>).select = vi.fn().mockImplementation(async () => {
        if (opts.updateBehavior === 'error') {
          return { data: null, error: { message: 'update failed' } }
        }
        if (opts.updateBehavior === 'race-lost') {
          return { data: [], error: null }
        }
        // success
        return {
          data: currentRow
            ? [{ used_count: currentRow.used_count, limit_count: currentRow.limit_count }]
            : [],
          error: null,
        }
      })
    } else {
      ;(chain as Record<string, unknown>).select = vi.fn().mockImplementation(() => chain)
    }
    return chain
  }

  const client = {
    from: vi.fn().mockImplementation((table: string) => {
      calls.from.push(table)
      return {
        select: vi.fn().mockImplementation((cols: string) => {
          calls.select.push(cols)
          return makeChain('select')
        }),
        update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          calls.update.push(payload)
          // applique l'update à currentRow pour les lectures suivantes
          if (currentRow && opts.updateBehavior !== 'error' && opts.updateBehavior !== 'race-lost') {
            currentRow = { ...currentRow, ...payload } as RowState
          }
          return makeChain('update')
        }),
        upsert: vi.fn().mockImplementation(async (payload: unknown, options: unknown) => {
          calls.upsert.push({ payload, options })
          if (opts.upsertError) return { data: null, error: opts.upsertError }
          return { data: null, error: null }
        }),
      }
    }),
  }

  return { client: client as unknown as SupabaseClient, calls, getCurrentRow: () => currentRow }
}

const USER_ID = 'user-abcd-1234'

function currentMonthStart(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ------------------------------------------------------------
// getQuotaState
// ------------------------------------------------------------

describe('getQuotaState', () => {
  it('crée la ligne (upsert) avec used=0 si absente et retourne un état neuf', async () => {
    const { client, calls } = createSupabaseMock({ row: null })

    const state = await getQuotaState(client, USER_ID, 'pappers')

    expect(state).toEqual({
      provider: 'pappers',
      used: 0,
      remaining: QUOTA_LIMITS.pappers,
      limit: QUOTA_LIMITS.pappers,
      monthStart: currentMonthStart(),
      exhausted: false,
    })
    // Upsert appelé avec onConflict + ignoreDuplicates
    expect(calls.upsert).toHaveLength(1)
    const upsertCall = calls.upsert[0]
    expect((upsertCall.payload as Record<string, unknown>).user_id).toBe(USER_ID)
    expect((upsertCall.payload as Record<string, unknown>).provider).toBe('pappers')
    expect((upsertCall.payload as Record<string, unknown>).used_count).toBe(0)
    expect((upsertCall.options as Record<string, unknown>).onConflict).toBe(
      'user_id,provider,month_start',
    )
  })

  it('retourne l\'état existant si la ligne existe pour le mois courant', async () => {
    const { client, calls } = createSupabaseMock({
      row: { used_count: 42, limit_count: 100, month_start: currentMonthStart() },
    })

    const state = await getQuotaState(client, USER_ID, 'pappers')

    expect(state).toEqual({
      provider: 'pappers',
      used: 42,
      remaining: 58,
      limit: 100,
      monthStart: currentMonthStart(),
      exhausted: false,
    })
    // Pas d'upsert (ligne déjà là)
    expect(calls.upsert).toHaveLength(0)
  })

  it('crée une nouvelle ligne quand le month_start en base est antérieur (reset mensuel)', async () => {
    // Le mock filtre déjà par month_start = mois courant → la ligne "ancienne" n'est
    // simplement pas retournée par le select (row=null), ce qui déclenche l'upsert.
    const { client, calls } = createSupabaseMock({ row: null })

    const state = await getQuotaState(client, USER_ID, 'hunter')

    expect(state.used).toBe(0)
    expect(state.remaining).toBe(QUOTA_LIMITS.hunter)
    expect(state.exhausted).toBe(false)
    expect(calls.upsert).toHaveLength(1)
    // Le payload upsert porte le month_start du mois courant
    expect((calls.upsert[0].payload as Record<string, unknown>).month_start).toBe(
      currentMonthStart(),
    )
  })

  it('marque exhausted=true quand used >= limit', async () => {
    const { client } = createSupabaseMock({
      row: { used_count: 25, limit_count: 25, month_start: currentMonthStart() },
    })

    const state = await getQuotaState(client, USER_ID, 'hunter')

    expect(state.exhausted).toBe(true)
    expect(state.remaining).toBe(0)
  })
})

// ------------------------------------------------------------
// consumeQuota
// ------------------------------------------------------------

describe('consumeQuota', () => {
  it('incrémente used_count et retourne ok=true avec remaining décrémenté', async () => {
    const { client, calls } = createSupabaseMock({
      row: { used_count: 5, limit_count: 100, month_start: currentMonthStart() },
      updateBehavior: 'success',
    })

    const result = await consumeQuota(client, USER_ID, 'pappers')

    expect(result.ok).toBe(true)
    expect(result.remaining).toBe(94) // 100 - 6
    expect(calls.update).toHaveLength(1)
    expect(calls.update[0]).toEqual({ used_count: 6 })
  })

  it('retourne ok=false, remaining=0 quand le quota est déjà épuisé', async () => {
    const { client, calls } = createSupabaseMock({
      row: { used_count: 25, limit_count: 25, month_start: currentMonthStart() },
      updateBehavior: 'success',
    })

    const result = await consumeQuota(client, USER_ID, 'hunter')

    expect(result.ok).toBe(false)
    expect(result.remaining).toBe(0)
    // Aucun UPDATE — l'épuisement est détecté avant
    expect(calls.update).toHaveLength(0)
  })

  it('retourne ok=false en cas de race perdue (0 ligne mise à jour)', async () => {
    const { client, calls } = createSupabaseMock({
      row: { used_count: 10, limit_count: 100, month_start: currentMonthStart() },
      updateBehavior: 'race-lost',
    })

    const result = await consumeQuota(client, USER_ID, 'pappers')

    expect(result.ok).toBe(false)
    expect(result.remaining).toBe(0)
    expect(calls.update).toHaveLength(1)
  })

  it('refuse de consommer si amount > remaining', async () => {
    const { client, calls } = createSupabaseMock({
      row: { used_count: 99, limit_count: 100, month_start: currentMonthStart() },
      updateBehavior: 'success',
    })

    const result = await consumeQuota(client, USER_ID, 'pappers', 5)

    expect(result.ok).toBe(false)
    expect(result.remaining).toBe(1)
    expect(calls.update).toHaveLength(0)
  })
})

// ------------------------------------------------------------
// refundQuota
// ------------------------------------------------------------

describe('refundQuota', () => {
  it('décrémente used_count de 1 par défaut', async () => {
    const { client, calls } = createSupabaseMock({
      row: { used_count: 10, limit_count: 100, month_start: currentMonthStart() },
      updateBehavior: 'success',
    })

    await refundQuota(client, USER_ID, 'pappers')

    expect(calls.update).toHaveLength(1)
    expect(calls.update[0]).toEqual({ used_count: 9 })
  })

  it('plancher à 0 quand used_count est déjà à 0 (defense in depth)', async () => {
    const { client, calls } = createSupabaseMock({
      row: { used_count: 0, limit_count: 100, month_start: currentMonthStart() },
      updateBehavior: 'success',
    })

    await refundQuota(client, USER_ID, 'pappers', 5)

    // Pas d'update car newUsed (0) === current (0) — no-op
    expect(calls.update).toHaveLength(0)
  })

  it('ne descend jamais en dessous de 0 si amount > used_count', async () => {
    const { client, calls } = createSupabaseMock({
      row: { used_count: 2, limit_count: 100, month_start: currentMonthStart() },
      updateBehavior: 'success',
    })

    await refundQuota(client, USER_ID, 'pappers', 10)

    expect(calls.update).toHaveLength(1)
    expect(calls.update[0]).toEqual({ used_count: 0 })
  })

  it('no-op silencieux si la ligne n\'existe pas en base', async () => {
    const { client, calls } = createSupabaseMock({ row: null })

    await refundQuota(client, USER_ID, 'pappers')

    expect(calls.update).toHaveLength(0)
  })
})

// ------------------------------------------------------------
// withQuota
// ------------------------------------------------------------

describe('withQuota', () => {
  it('consume puis appelle fn — retourne { data, quotaExhausted:false } sur succès', async () => {
    const { client, calls } = createSupabaseMock({
      row: { used_count: 5, limit_count: 100, month_start: currentMonthStart() },
      updateBehavior: 'success',
    })
    const fn = vi.fn().mockResolvedValue({ payload: 'ok' })

    const result = await withQuota(client, USER_ID, 'pappers', fn)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(result.data).toEqual({ payload: 'ok' })
    expect(result.quotaExhausted).toBe(false)
    expect(result.error).toBeNull()
    // 1 update pour le consume, pas de refund
    expect(calls.update).toHaveLength(1)
    expect(calls.update[0]).toEqual({ used_count: 6 })
  })

  it('refund si fn throw — retourne { data:null, error:<msg> }', async () => {
    const { client, calls } = createSupabaseMock({
      row: { used_count: 5, limit_count: 100, month_start: currentMonthStart() },
      updateBehavior: 'success',
    })
    const fn = vi.fn().mockRejectedValue(new Error('boom'))

    const result = await withQuota(client, USER_ID, 'pappers', fn)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(result.data).toBeNull()
    expect(result.quotaExhausted).toBe(false)
    expect(result.error).toBe('boom')
    // 2 updates : consume +1 (5→6) puis refund -1 (6→5)
    expect(calls.update).toHaveLength(2)
    expect(calls.update[0]).toEqual({ used_count: 6 })
    expect(calls.update[1]).toEqual({ used_count: 5 })
  })

  it('quotaExhausted:true et fn non appelée si quota déjà épuisé', async () => {
    const { client, calls } = createSupabaseMock({
      row: { used_count: 25, limit_count: 25, month_start: currentMonthStart() },
      updateBehavior: 'success',
    })
    const fn = vi.fn()

    const result = await withQuota(client, USER_ID, 'hunter', fn)

    expect(fn).not.toHaveBeenCalled()
    expect(result.data).toBeNull()
    expect(result.quotaExhausted).toBe(true)
    expect(result.error).toBe('QUOTA_EXHAUSTED')
    expect(calls.update).toHaveLength(0)
  })
})

// ------------------------------------------------------------
// getAllQuotas
// ------------------------------------------------------------

describe('getAllQuotas', () => {
  it('retourne un QuotaState par provider, dans l\'ordre déclaré', async () => {
    const { client } = createSupabaseMock({ row: null })

    const all = await getAllQuotas(client, USER_ID)

    expect(all).toHaveLength(QUOTA_PROVIDERS.length)
    expect(all.map((s) => s.provider)).toEqual([...QUOTA_PROVIDERS])
    all.forEach((s) => {
      expect(s.used).toBe(0)
      expect(s.exhausted).toBe(false)
      expect(s.limit).toBe(QUOTA_LIMITS[s.provider])
      expect(s.monthStart).toBe(currentMonthStart())
    })
  })
})
