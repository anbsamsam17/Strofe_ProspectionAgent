// ============================================================
// TESTS — lib/agent/blacklist-checker (GLN-061)
// ------------------------------------------------------------
// Couvre :
//   - normalizeBlacklistDomain : lowercase, retire @ initial, retire schéma
//     URL, valide format xxx.yy, retourne null pour invalides.
//   - extractEmailDomain : domaine email valide, null pour mal formé.
//   - checkBlacklistedDomains :
//       * 0 entrées blacklist → matched=0
//       * 1 match → update statut do_not_contact + note
//       * 42P01 (table absente) → skipped=true
// ============================================================

import { describe, expect, it, vi } from 'vitest'

import {
  checkBlacklistedDomains,
  extractEmailDomain,
  normalizeBlacklistDomain,
} from './blacklist-checker'

// ── normalizeBlacklistDomain ─────────────────────────────────────────────────

describe('normalizeBlacklistDomain', () => {
  it('lowercase un domaine en majuscules', () => {
    expect(normalizeBlacklistDomain('Greenly.Earth')).toBe('greenly.earth')
  })

  it('retire un @ initial', () => {
    expect(normalizeBlacklistDomain('@greenly.earth')).toBe('greenly.earth')
  })

  it('retire un schéma URL', () => {
    expect(normalizeBlacklistDomain('https://greenly.earth')).toBe('greenly.earth')
  })

  it('retire le chemin éventuel', () => {
    expect(normalizeBlacklistDomain('greenly.earth/about')).toBe('greenly.earth')
  })

  it('tolère les sous-domaines', () => {
    expect(normalizeBlacklistDomain('mail.entreprise.fr')).toBe(
      'mail.entreprise.fr',
    )
  })

  it('retourne null pour un domaine sans TLD', () => {
    expect(normalizeBlacklistDomain('pas-un-domaine')).toBeNull()
  })

  it('retourne null pour TLD trop court (1 caractère)', () => {
    expect(normalizeBlacklistDomain('foo.x')).toBeNull()
  })

  it('retourne null pour une chaîne vide', () => {
    expect(normalizeBlacklistDomain('')).toBeNull()
  })

  it('retourne null pour caractères interdits (espaces internes)', () => {
    expect(normalizeBlacklistDomain('foo bar.com')).toBeNull()
  })
})

// ── extractEmailDomain ───────────────────────────────────────────────────────

describe('extractEmailDomain', () => {
  it('extrait le domaine d\'un email simple', () => {
    expect(extractEmailDomain('alice@greenly.earth')).toBe('greenly.earth')
  })

  it('lowercase le résultat', () => {
    expect(extractEmailDomain('Alice@Greenly.EARTH')).toBe('greenly.earth')
  })

  it('retourne null pour null/undefined', () => {
    expect(extractEmailDomain(null)).toBeNull()
    expect(extractEmailDomain(undefined)).toBeNull()
  })

  it('retourne null pour email sans @', () => {
    expect(extractEmailDomain('pas-un-email')).toBeNull()
  })

  it('retourne null pour @ en position 0 (local-part vide)', () => {
    expect(extractEmailDomain('@greenly.earth')).toBeNull()
  })

  it('retourne null pour domaine vide après @', () => {
    expect(extractEmailDomain('alice@')).toBeNull()
  })
})

// ── checkBlacklistedDomains ──────────────────────────────────────────────────

interface MockChainable {
  select: ReturnType<typeof vi.fn>
  eq?: ReturnType<typeof vi.fn>
  is?: ReturnType<typeof vi.fn>
  not?: ReturnType<typeof vi.fn>
  neq?: ReturnType<typeof vi.fn>
  update?: ReturnType<typeof vi.fn>
}

function makeMockSupabase(opts: {
  blacklistData: Array<{ domain: string }>
  blacklistError?: { message: string; code?: string }
  prospectsData: Array<{
    id: string
    contact_email: string | null
    statut: string
    notes?: string | null
  }>
  prospectsError?: { message: string }
  updateError?: { message: string }
}) {
  const fromCalls: string[] = []
  const updateCalls: Array<{ id: string; payload: Record<string, unknown> }> = []

  function from(table: string): MockChainable {
    fromCalls.push(table)
    if (table === 'domain_blacklist') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() =>
            Promise.resolve({
              data: opts.blacklistError ? null : opts.blacklistData,
              error: opts.blacklistError ?? null,
            }),
          ),
        })),
      }
    }
    // prospects table
    // chain: .select().eq().is().not().neq().neq()
    const chainable: Record<string, unknown> = {}
    chainable.select = vi.fn(() => chainable)
    chainable.eq = vi.fn(() => chainable)
    chainable.is = vi.fn(() => chainable)
    chainable.not = vi.fn(() => chainable)
    chainable.neq = vi.fn(() => {
      // 2 .neq() chainés - on intercepte le 2e qui clôt la chaîne.
      // Solution : on retourne un thenable au 2e appel.
      // Pour simplifier, on rend chaque appel thenable.
      const thenable = {
        ...chainable,
        then: (resolve: (v: unknown) => void) => {
          resolve({
            data: opts.prospectsError ? null : opts.prospectsData,
            error: opts.prospectsError ?? null,
          })
        },
      }
      return thenable
    })
    chainable.update = vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn((_col: string, val: string) => {
        updateCalls.push({ id: val, payload })
        return Promise.resolve({ error: opts.updateError ?? null })
      }),
    }))
    return chainable as unknown as MockChainable
  }

  return {
    supabase: { from } as unknown as Parameters<typeof checkBlacklistedDomains>[1],
    fromCalls,
    updateCalls,
  }
}

describe('checkBlacklistedDomains', () => {
  const USER_ID = 'user-1'

  it('retourne matched=0 si la blacklist du user est vide', async () => {
    const { supabase } = makeMockSupabase({
      blacklistData: [],
      prospectsData: [],
    })
    const result = await checkBlacklistedDomains(USER_ID, supabase)
    expect(result.matched).toBe(0)
    expect(result.skipped).toBe(false)
  })

  it('skip si la table domain_blacklist n\'existe pas (code 42P01)', async () => {
    const { supabase } = makeMockSupabase({
      blacklistData: [],
      blacklistError: { message: 'relation does not exist', code: '42P01' },
      prospectsData: [],
    })
    const result = await checkBlacklistedDomains(USER_ID, supabase)
    expect(result.skipped).toBe(true)
    expect(result.matched).toBe(0)
  })

  it('matche un prospect dont l\'email tombe sur un domaine blacklisté', async () => {
    const { supabase, updateCalls } = makeMockSupabase({
      blacklistData: [{ domain: 'greenly.earth' }],
      prospectsData: [
        {
          id: 'p1',
          contact_email: 'alice@greenly.earth',
          statut: 'qualified',
          notes: 'RDV pris le 12/03 — rappeler en avril',
        },
        { id: 'p2', contact_email: 'bob@autre.fr', statut: 'qualified' },
      ],
    })
    const result = await checkBlacklistedDomains(USER_ID, supabase)
    expect(result.matched).toBe(1)
    expect(result.matches[0].prospect_id).toBe('p1')
    expect(result.matches[0].matched_domain).toBe('greenly.earth')
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].id).toBe('p1')
    expect(updateCalls[0].payload.statut).toBe('do_not_contact')
    expect(updateCalls[0].payload.notes).toContain('greenly.earth')
    // Append : la note consultant existante doit être préservée (pas écrasée).
    expect(updateCalls[0].payload.notes).toContain(
      'RDV pris le 12/03 — rappeler en avril',
    )
    expect(updateCalls[0].payload.notes).toBe(
      'RDV pris le 12/03 — rappeler en avril | Blacklist domaine: greenly.earth',
    )
  })

  it('n\'ajoute pas de séparateur si le prospect n\'a pas de note existante', async () => {
    const { supabase, updateCalls } = makeMockSupabase({
      blacklistData: [{ domain: 'greenly.earth' }],
      prospectsData: [
        {
          id: 'p1',
          contact_email: 'alice@greenly.earth',
          statut: 'qualified',
          notes: null,
        },
      ],
    })
    const result = await checkBlacklistedDomains(USER_ID, supabase)
    expect(result.matched).toBe(1)
    expect(updateCalls[0].payload.notes).toBe('Blacklist domaine: greenly.earth')
  })

  it('matche en case-insensitive sur l\'email', async () => {
    const { supabase } = makeMockSupabase({
      blacklistData: [{ domain: 'greenly.earth' }],
      prospectsData: [
        { id: 'p1', contact_email: 'Alice@GREENLY.EARTH', statut: 'qualified' },
      ],
    })
    const result = await checkBlacklistedDomains(USER_ID, supabase)
    expect(result.matched).toBe(1)
  })

  it('ignore les prospects sans contact_email', async () => {
    const { supabase, updateCalls } = makeMockSupabase({
      blacklistData: [{ domain: 'greenly.earth' }],
      prospectsData: [
        { id: 'p1', contact_email: null, statut: 'qualified' },
      ],
    })
    const result = await checkBlacklistedDomains(USER_ID, supabase)
    expect(result.matched).toBe(0)
    expect(updateCalls).toHaveLength(0)
  })

  it('throw si erreur DB autre que 42P01/42501', async () => {
    const { supabase } = makeMockSupabase({
      blacklistData: [],
      blacklistError: { message: 'connection lost', code: '08000' },
      prospectsData: [],
    })
    await expect(checkBlacklistedDomains(USER_ID, supabase)).rejects.toThrow(
      'erreur lecture blacklist',
    )
  })
})
