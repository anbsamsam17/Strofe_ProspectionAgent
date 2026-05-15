// ============================================================
// TESTS UNITAIRES — opt-out-checker.ts
//
// Mock Supabase via chainables — pattern aligné sur sourcing-runner.test.ts.
// Vitest — pattern AAA (Arrange / Act / Assert).
// ============================================================

import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addOptOut, filterOptedOutSirens, isOptedOut } from '../opt-out-checker'

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — mock client Supabase chainable
// ─────────────────────────────────────────────────────────────────────────────

interface ChainResult<T = unknown> {
  data: T | null
  error: { message: string } | null
}

/**
 * Construit un client Supabase mocké pour `from('opt_out')`.
 * Chaque appel `.from('opt_out')` retourne un nouveau chainable configurable.
 *
 * - `selectResult`     : ce que retournera `.maybeSingle()` (SELECT par siren/email).
 * - `selectListResult` : ce que retournera la terminaison d'un `.select().eq().in()`.
 * - `insertResult`     : ce que retournera `.insert(...)`.
 */
interface MockConfig {
  selectResult?: ChainResult
  selectListResult?: ChainResult<Array<{ siren: string | null }>>
  insertResult?: ChainResult
}

function makeSupabase(config: MockConfig = {}) {
  const insertSpy = vi.fn().mockResolvedValue(config.insertResult ?? { data: null, error: null })

  const fromSpy = vi.fn(() => {
    // Chainable partagé entre .select, .eq, .ilike, .in, .limit, etc.
    // On distingue 2 terminaisons :
    //   - `.maybeSingle()` → selectResult
    //   - awaiting the chain (then) → selectListResult (pour .in())
    const chain: Record<string, unknown> = {}
    const stubReturn = (key: string) => {
      chain[key] = vi.fn().mockReturnValue(chain)
    }
    stubReturn('select')
    stubReturn('eq')
    stubReturn('ilike')
    stubReturn('in')
    stubReturn('limit')
    stubReturn('order')

    chain.maybeSingle = vi
      .fn()
      .mockResolvedValue(config.selectResult ?? { data: null, error: null })

    chain.single = vi
      .fn()
      .mockResolvedValue(config.selectResult ?? { data: null, error: null })

    chain.insert = insertSpy

    // Thenable pour les awaits directs (filterOptedOutSirens utilise `.in().then`)
    chain.then = (resolve: (v: ChainResult) => void) => {
      resolve(config.selectListResult ?? { data: [], error: null })
      return Promise.resolve(config.selectListResult ?? { data: [], error: null })
    }

    return chain
  })

  return {
    client: { from: fromSpy } as unknown as SupabaseClient,
    fromSpy,
    insertSpy,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// isOptedOut
// ─────────────────────────────────────────────────────────────────────────────

describe('isOptedOut', () => {
  it('retourne true si le SIREN est présent en opt_out', async () => {
    const { client } = makeSupabase({
      selectResult: { data: { id: 'opt-id-1' }, error: null },
    })

    const result = await isOptedOut(client, 'user-1', { siren: '123456789' })

    expect(result).toBe(true)
  })

  it('retourne false si le SIREN est absent', async () => {
    const { client } = makeSupabase({
      selectResult: { data: null, error: null },
    })

    const result = await isOptedOut(client, 'user-1', { siren: '999999999' })

    expect(result).toBe(false)
  })

  it('retourne true si l\'email est présent (case-insensitive)', async () => {
    const { client } = makeSupabase({
      selectResult: { data: { id: 'opt-id-2' }, error: null },
    })

    const result = await isOptedOut(client, 'user-1', { email: 'JEAN@ACME.FR' })

    expect(result).toBe(true)
  })

  it('retourne false si ni siren ni email fourni (no-op)', async () => {
    const { client, fromSpy } = makeSupabase()

    const result = await isOptedOut(client, 'user-1', {})

    expect(result).toBe(false)
    // Aucune requête DB ne doit être faite si options vide
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('fail-open : retourne false sur erreur DB', async () => {
    const { client } = makeSupabase({
      selectResult: { data: null, error: { message: 'connection lost' } },
    })

    const result = await isOptedOut(client, 'user-1', { siren: '123456789' })

    expect(result).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// filterOptedOutSirens
// ─────────────────────────────────────────────────────────────────────────────

describe('filterOptedOutSirens', () => {
  it('retire les SIREN matchés par opt_out', async () => {
    const { client } = makeSupabase({
      selectListResult: {
        data: [{ siren: '111111111' }, { siren: '333333333' }],
        error: null,
      },
    })

    const result = await filterOptedOutSirens(client, 'user-1', [
      '111111111',
      '222222222',
      '333333333',
      '444444444',
    ])

    expect(result).toEqual(['222222222', '444444444'])
  })

  it('retourne la liste inchangée si aucun match', async () => {
    const { client } = makeSupabase({
      selectListResult: { data: [], error: null },
    })

    const result = await filterOptedOutSirens(client, 'user-1', ['111111111', '222222222'])

    expect(result).toEqual(['111111111', '222222222'])
  })

  it('retourne tableau vide pour input vide (court-circuit)', async () => {
    const { client, fromSpy } = makeSupabase()

    const result = await filterOptedOutSirens(client, 'user-1', [])

    expect(result).toEqual([])
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('fail-open : retourne la liste inchangée sur erreur DB', async () => {
    const { client } = makeSupabase({
      selectListResult: { data: null, error: { message: 'db down' } },
    })

    const result = await filterOptedOutSirens(client, 'user-1', ['111111111'])

    expect(result).toEqual(['111111111'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// addOptOut
// ─────────────────────────────────────────────────────────────────────────────

describe('addOptOut', () => {
  it('insert OK retourne { ok: true } et passe le payload normalisé', async () => {
    const { client, insertSpy } = makeSupabase({
      insertResult: { data: null, error: null },
    })

    const result = await addOptOut(client, 'user-1', {
      siren: '123456789',
      email: 'JEAN@ACME.FR',
      reason: 'demande user',
    })

    expect(result).toEqual({ ok: true })
    expect(insertSpy).toHaveBeenCalledTimes(1)
    const payload = insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(payload.user_id).toBe('user-1')
    expect(payload.siren).toBe('123456789')
    // Email doit être lowercased pour matcher l'index lower(email)
    expect(payload.email).toBe('jean@acme.fr')
    expect(payload.reason).toBe('demande user')
  })

  it('retourne { ok: false } si ni siren ni email fourni', async () => {
    const { client, insertSpy } = makeSupabase()

    const result = await addOptOut(client, 'user-1', {})

    expect(result).toEqual({ ok: false })
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('retourne { ok: false } sur erreur DB', async () => {
    const { client } = makeSupabase({
      insertResult: { data: null, error: { message: 'constraint violation' } },
    })

    const result = await addOptOut(client, 'user-1', { siren: '123456789' })

    expect(result).toEqual({ ok: false })
  })
})
