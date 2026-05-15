// ============================================================
// TESTS UNITAIRES — contact-persistence.ts
//
// Couvre :
//   - upsertContact : insert nouveau / merge + append source_chain /
//     dédup par email / dédup par nom+prenom si email absent.
//   - computeProspectCompleteness : 0/33/100 et "max par canal".
//   - computeTier : combinaisons obligation_beges × beges_publie × beges_valide.
//   - refreshProspectAggregates : update agrégé sur prospects.
//
// Mock Supabase via chainables — pattern aligné sur sourcing-runner.test.ts.
// Vitest — pattern AAA (Arrange / Act / Assert).
// ============================================================

import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  computeProspectCompleteness,
  computeTier,
  refreshProspectAggregates,
  upsertContact,
} from '../contact-persistence'

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — mock Supabase chainable multi-table
// ─────────────────────────────────────────────────────────────────────────────

interface ChainResult<T = unknown> {
  data: T | null
  error: { message: string } | null
}

interface TableConfig {
  /** Réponse de la terminaison `.maybeSingle()` (lecture unitaire). */
  selectMaybeSingle?: ChainResult
  /** Réponse de la terminaison `.single()` (insert/select). */
  selectSingle?: ChainResult
  /** Réponse résolue quand le chain est awaitable (await sur `.eq().order()` etc.). */
  selectList?: ChainResult
  /** Réponse de `.update(...)`. */
  updateResult?: ChainResult
  /** Réponse de `.insert(...).select().single()`. */
  insertSingle?: ChainResult
}

interface BuildOpts {
  contacts?: TableConfig
  prospects?: TableConfig
}

interface BuildResult {
  client: SupabaseClient
  spies: {
    from: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    insert: ReturnType<typeof vi.fn>
  }
}

function build(opts: BuildOpts = {}): BuildResult {
  const updateSpy = vi.fn()
  const insertSpy = vi.fn()

  const fromSpy = vi.fn((table: string) => {
    const cfg: TableConfig =
      (table === 'prospect_contacts' ? opts.contacts : opts.prospects) ?? {}

    const chain: Record<string, unknown> = {}
    const back = (key: string) => {
      chain[key] = vi.fn().mockReturnValue(chain)
    }
    back('select')
    back('eq')
    back('ilike')
    back('in')
    back('limit')
    back('order')

    chain.maybeSingle = vi
      .fn()
      .mockResolvedValue(cfg.selectMaybeSingle ?? { data: null, error: null })
    chain.single = vi
      .fn()
      .mockResolvedValue(cfg.selectSingle ?? { data: null, error: null })

    // UPDATE — on retourne un chainable qui se résout sur .eq() final.
    chain.update = vi.fn((payload: unknown) => {
      updateSpy(table, payload)
      const upd: Record<string, unknown> = {}
      upd.eq = vi.fn().mockReturnValue(upd)
      upd.then = (resolve: (v: ChainResult) => void) => {
        const r = cfg.updateResult ?? { data: null, error: null }
        resolve(r)
        return Promise.resolve(r)
      }
      return upd
    })

    // INSERT — supporte `.insert(row)` direct (await) ET `.insert(row).select().single()`.
    chain.insert = vi.fn((payload: unknown) => {
      insertSpy(table, payload)
      const ins: Record<string, unknown> = {}
      ins.select = vi.fn().mockReturnValue(ins)
      ins.single = vi
        .fn()
        .mockResolvedValue(cfg.insertSingle ?? { data: null, error: null })
      ins.then = (resolve: (v: ChainResult) => void) => {
        const r = cfg.insertSingle ?? { data: null, error: null }
        resolve(r)
        return Promise.resolve(r)
      }
      return ins
    })

    // Thenable pour await sur la chaîne de SELECT (`.eq().order()` etc.)
    chain.then = (resolve: (v: ChainResult) => void) => {
      const r = cfg.selectList ?? { data: [], error: null }
      resolve(r)
      return Promise.resolve(r)
    }

    return chain
  })

  return {
    client: { from: fromSpy } as unknown as SupabaseClient,
    spies: { from: fromSpy, update: updateSpy, insert: insertSpy },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// computeTier — fonction pure
// ─────────────────────────────────────────────────────────────────────────────

describe('computeTier', () => {
  it('hot : obligation=true ET beges_publie=false (jamais publié)', () => {
    expect(
      computeTier({
        obligation_beges: true,
        beges_publie: false,
        beges_valide: null,
      }),
    ).toBe('hot')
  })

  it('cold : obligation=false (pas concerné, quel que soit le reste)', () => {
    expect(
      computeTier({
        obligation_beges: false,
        beges_publie: false,
        beges_valide: false,
      }),
    ).toBe('cold')
  })

  it('hot : obligation=true ET beges_publie=true ET beges_valide=false (expiré)', () => {
    expect(
      computeTier({
        obligation_beges: true,
        beges_publie: true,
        beges_valide: false,
      }),
    ).toBe('hot')
  })

  it('cold : obligation=true ET beges_publie=true ET beges_valide=true (à jour)', () => {
    expect(
      computeTier({
        obligation_beges: true,
        beges_publie: true,
        beges_valide: true,
      }),
    ).toBe('cold')
  })

  it('cold : obligation_beges=null (donnée manquante)', () => {
    expect(
      computeTier({
        obligation_beges: null,
        beges_publie: false,
        beges_valide: null,
      }),
    ).toBe('cold')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// computeProspectCompleteness
// ─────────────────────────────────────────────────────────────────────────────

describe('computeProspectCompleteness', () => {
  it('retourne 0 quand aucun contact attaché au prospect', async () => {
    const { client } = build({
      contacts: { selectList: { data: [], error: null } },
    })

    const score = await computeProspectCompleteness(client, 'prospect-1')

    expect(score).toBe(0)
  })

  it('retourne 33 pour 1 contact avec email seul', async () => {
    const { client } = build({
      contacts: {
        selectList: {
          data: [{ email: 'jean@acme.fr', telephone: null, linkedin: null, nom: null, prenom: null }],
          error: null,
        },
      },
    })

    const score = await computeProspectCompleteness(client, 'prospect-1')

    expect(score).toBe(33)
  })

  it('retourne 100 pour 1 contact complet (email + tel + linkedin + nom+prenom)', async () => {
    const { client } = build({
      contacts: {
        selectList: {
          data: [
            {
              email: 'jean@acme.fr',
              telephone: '0102030405',
              linkedin: 'https://linkedin.com/in/jean',
              nom: 'Dupont',
              prenom: 'Jean',
            },
          ],
          error: null,
        },
      },
    })

    const score = await computeProspectCompleteness(client, 'prospect-1')

    // 33 + 33 + 33 + 1 (bonus identité) = 100
    expect(score).toBe(100)
  })

  it('agrège en "max par canal" — 2 contacts partiels = canaux uniques', async () => {
    // Contact 1 : email seul. Contact 2 : téléphone seul.
    // Attendu : 33 (email) + 33 (tel) = 66 — pas 33+33 par contact, mais par canal.
    const { client } = build({
      contacts: {
        selectList: {
          data: [
            { email: 'jean@acme.fr', telephone: null, linkedin: null, nom: null, prenom: null },
            { email: null, telephone: '0102030405', linkedin: null, nom: null, prenom: null },
          ],
          error: null,
        },
      },
    })

    const score = await computeProspectCompleteness(client, 'prospect-1')

    expect(score).toBe(66)
  })

  it('retourne 0 sur erreur DB (fail-safe)', async () => {
    const { client } = build({
      contacts: {
        selectList: { data: null, error: { message: 'db down' } },
      },
    })

    const score = await computeProspectCompleteness(client, 'prospect-1')

    expect(score).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// upsertContact
// ─────────────────────────────────────────────────────────────────────────────

describe('upsertContact', () => {
  it('INSERT un nouveau contact quand aucun match (email key, fetch user_id du prospect)', async () => {
    const { client, spies } = build({
      contacts: {
        // SELECT existant par email → rien
        selectMaybeSingle: { data: null, error: null },
        // INSERT … .select('id').single() → renvoie l'id créé
        insertSingle: { data: { id: 'contact-new-1' }, error: null },
      },
      prospects: {
        // SELECT user_id du prospect parent
        selectMaybeSingle: { data: { user_id: 'user-1' }, error: null },
      },
    })

    const result = await upsertContact(client, {
      prospect_id: 'prospect-1',
      email: 'jean@acme.fr',
      nom: 'Dupont',
      prenom: 'Jean',
      source: 're',
    })

    expect(result.ok).toBe(true)
    expect(result.contactId).toBe('contact-new-1')
    expect(result.error).toBeNull()
    // INSERT a bien été appelé sur prospect_contacts avec source_chain initialisé.
    expect(spies.insert).toHaveBeenCalled()
    const [insertedTable, payload] = spies.insert.mock.calls[0]
    expect(insertedTable).toBe('prospect_contacts')
    const p = payload as Record<string, unknown>
    expect(p.user_id).toBe('user-1')
    expect(p.prospect_id).toBe('prospect-1')
    expect(p.email).toBe('jean@acme.fr')
    const chain = p.source_chain as Array<{ source: string; result: string }>
    expect(chain).toHaveLength(1)
    expect(chain[0].source).toBe('re')
    expect(chain[0].result).toBe('hit')
  })

  it('UPDATE + append source_chain quand un contact match par email', async () => {
    const { client, spies } = build({
      contacts: {
        // SELECT existant → un contact avec source_chain déjà 1 entrée
        selectMaybeSingle: {
          data: {
            id: 'contact-existing-1',
            source_chain: [{ source: 'pappers', at: '2026-05-14T10:00:00Z', result: 'hit' }],
          },
          error: null,
        },
        updateResult: { data: null, error: null },
      },
    })

    const result = await upsertContact(client, {
      prospect_id: 'prospect-1',
      email: 'jean@acme.fr',
      telephone: '0102030405',
      source: 'hunter-pattern',
    })

    expect(result.ok).toBe(true)
    expect(result.contactId).toBe('contact-existing-1')
    // UPDATE appelé avec source_chain de longueur 2 (1 existante + 1 ajoutée)
    expect(spies.update).toHaveBeenCalled()
    const [updatedTable, payload] = spies.update.mock.calls[0]
    expect(updatedTable).toBe('prospect_contacts')
    const p = payload as Record<string, unknown>
    const chain = p.source_chain as Array<{ source: string }>
    expect(chain).toHaveLength(2)
    expect(chain[0].source).toBe('pappers')
    expect(chain[1].source).toBe('hunter-pattern')
    expect(p.telephone).toBe('0102030405')
  })

  it('dédup par nom+prenom si email absent (ON CONFLICT alternatif)', async () => {
    const { client, spies } = build({
      contacts: {
        // Match trouvé via nom+prenom (pas d'email)
        selectMaybeSingle: {
          data: { id: 'contact-byname-1', source_chain: [] },
          error: null,
        },
        updateResult: { data: null, error: null },
      },
    })

    const result = await upsertContact(client, {
      prospect_id: 'prospect-1',
      nom: 'Dupont',
      prenom: 'Jean',
      telephone: '0102030405',
      source: 'inpi',
    })

    expect(result.ok).toBe(true)
    expect(result.contactId).toBe('contact-byname-1')
    // Pas d'INSERT — c'était un UPDATE par dédup nom/prenom
    expect(spies.insert).not.toHaveBeenCalled()
    expect(spies.update).toHaveBeenCalled()
  })

  it('retourne ok=false et error si la lecture DB échoue', async () => {
    const { client } = build({
      contacts: {
        selectMaybeSingle: { data: null, error: { message: 'db down' } },
      },
    })

    const result = await upsertContact(client, {
      prospect_id: 'prospect-1',
      email: 'jean@acme.fr',
      source: 're',
    })

    expect(result.ok).toBe(false)
    expect(result.contactId).toBeNull()
    expect(result.error).toBe('db down')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// refreshProspectAggregates
// ─────────────────────────────────────────────────────────────────────────────

describe('refreshProspectAggregates', () => {
  it('UPDATE prospects.{contact_completeness, contact_tier, last_enrichment_run_at, contact_source_origin}', async () => {
    const { client, spies } = build({
      contacts: {
        // 1er call dans computeProspectCompleteness → liste contacts pour score
        // 2ème call dans refreshProspectAggregates → liste contacts pour origin
        // Même selectList suffit (les deux requêtes la consomment).
        selectList: {
          data: [
            {
              email: 'jean@acme.fr',
              telephone: '0102030405',
              linkedin: null,
              nom: 'Dupont',
              prenom: 'Jean',
              source: 're',
              source_chain: [{ source: 're', at: '2026-05-15T10:00:00Z', result: 'hit' }],
              created_at: '2026-05-15T10:00:00Z',
            },
          ],
          error: null,
        },
      },
      prospects: {
        updateResult: { data: null, error: null },
      },
    })

    await refreshProspectAggregates(client, 'prospect-1', 'hot')

    expect(spies.update).toHaveBeenCalled()
    const [updatedTable, payload] = spies.update.mock.calls[0]
    expect(updatedTable).toBe('prospects')
    const p = payload as Record<string, unknown>
    expect(p.contact_tier).toBe('hot')
    // 33 (email) + 33 (tel) + 1 (identité) = 67
    expect(p.contact_completeness).toBe(67)
    expect(p.contact_source_origin).toBe('re')
    expect(typeof p.last_enrichment_run_at).toBe('string')
  })
})
