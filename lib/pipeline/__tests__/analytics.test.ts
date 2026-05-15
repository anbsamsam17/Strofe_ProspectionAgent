// ============================================================
// TESTS UNITAIRES — lib/pipeline/analytics.ts
// ============================================================

import { describe, expect, it } from 'vitest'
import type { AgentRun, Prospect, ProspectStatus } from '@/lib/types'
import {
  buildFunnel,
  formatDurationShort,
  sourcingMix,
  topSectors,
  toRunStat,
} from '../analytics'

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyCounts(): Record<ProspectStatus, number> {
  return {
    sourced: 0,
    qualified: 0,
    interested: 0,
    contacted: 0,
    rdv: 0,
    // TODO(agent-E/pipeline) : compteur dédié au statut offer_sent
    offer_sent: 0,
    converted: 0,
    rejected: 0,
    on_hold: 0,
    do_not_contact: 0,
  }
}

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: 'p1',
    user_id: 'u1',
    siren: '123456789',
    raison_sociale: 'Test SAS',
    secteur_libelle: 'Industrie',
    score_priorite: 50,
    score_details: {} as Prospect['score_details'],
    signaux: [],
    statut: 'sourced',
    source: 'sirene_api',
    beges_publie: false,
    obligation_beges: true,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'r1',
    user_id: 'u1',
    status: 'completed',
    prospects_sourced: 100,
    prospects_qualified: 30,
    list_generated: false,
    logs: [],
    started_at: '2026-05-01T22:00:00Z',
    completed_at: '2026-05-01T22:04:00Z',
    ...overrides,
  }
}

// ── buildFunnel ──────────────────────────────────────────────────────────────

describe('buildFunnel', () => {
  it('retourne 5 étages dans l\'ordre fixe sourced → qualified → contacted → rdv → converted', () => {
    const counts = emptyCounts()
    counts.sourced = 100
    counts.qualified = 50
    counts.contacted = 25
    counts.rdv = 5
    counts.converted = 2

    const stages = buildFunnel(counts)

    expect(stages.map((s) => s.step)).toEqual([
      'sourced',
      'qualified',
      'contacted',
      'rdv',
      'converted',
    ])
    // Logique cumulative (fix 2026-05-15) : chaque étage = soi + tous les étages aval
    // sourced = 100 + 50 + 25 + 5 + 2 = 182
    // qualified = 50 + 25 + 5 + 2 = 82
    // contacted = 25 + 5 + 2 = 32
    // rdv = 5 + 2 = 7
    // converted = 2
    expect(stages.map((s) => s.count)).toEqual([182, 82, 32, 7, 2])
  })

  it('fusionne interested dans le funnel cumulatif (compté dans qualified, contacted, rdv)', () => {
    const counts = emptyCounts()
    counts.sourced = 100
    counts.qualified = 30
    counts.interested = 20

    const stages = buildFunnel(counts)
    const qualified = stages.find((s) => s.step === 'qualified')

    // qualified cumulatif = qualified(30) + interested(20) + contacted(0) + offer_sent(0) + rdv(0) + converted(0) = 50
    expect(qualified?.count).toBe(50)
  })

  it('calcule stepConversionPct sur les counts cumulatifs', () => {
    const counts = emptyCounts()
    counts.sourced = 100
    counts.qualified = 50
    counts.contacted = 25
    counts.rdv = 10

    // Cumulatif :
    // sourced = 100+50+25+0+0+10+0 = 185
    // qualified = 50+25+0+0+10+0 = 85
    // contacted = 25+0+0+10+0 = 35
    // rdv = 0+0+10+0 = 10
    // converted = 0
    const stages = buildFunnel(counts)

    expect(stages[0].stepConversionPct).toBe(100) // sourced = base
    expect(stages[1].stepConversionPct).toBeCloseTo((85 / 185) * 100, 5) // ≈ 45.95%
    expect(stages[2].stepConversionPct).toBeCloseTo((35 / 85) * 100, 5) // ≈ 41.18%
    expect(stages[3].stepConversionPct).toBeCloseTo((10 / 35) * 100, 5) // ≈ 28.57%
  })

  it('calcule cumulativePct depuis sourced cumulatif (count[i] / count[0] * 100)', () => {
    const counts = emptyCounts()
    counts.sourced = 200
    counts.qualified = 50
    counts.contacted = 20
    counts.converted = 2

    // Cumulatif :
    // sourced = 200+50+20+0+0+0+2 = 272
    // qualified = 50+20+0+0+0+2 = 72
    // contacted = 20+0+0+0+2 = 22
    // rdv = 0+0+0+2 = 2
    // converted = 2
    const stages = buildFunnel(counts)

    expect(stages[0].cumulativePct).toBe(100)
    expect(stages[1].cumulativePct).toBeCloseTo((72 / 272) * 100, 5)
    expect(stages[2].cumulativePct).toBeCloseTo((22 / 272) * 100, 5)
    expect(stages[4].cumulativePct).toBeCloseTo((2 / 272) * 100, 5)
  })

  it('gère le cas vide sans division par zéro', () => {
    const stages = buildFunnel(emptyCounts())

    expect(stages).toHaveLength(5)
    expect(stages.every((s) => s.count === 0)).toBe(true)
    expect(stages.every((s) => Number.isFinite(s.cumulativePct))).toBe(true)
    expect(stages.every((s) => Number.isFinite(s.stepConversionPct))).toBe(true)
  })
})

// ── topSectors ───────────────────────────────────────────────────────────────

describe('topSectors', () => {
  it('agrège par secteur_libelle et trie par count DESC', () => {
    const prospects = [
      makeProspect({ id: '1', secteur_libelle: 'Industrie' }),
      makeProspect({ id: '2', secteur_libelle: 'Industrie' }),
      makeProspect({ id: '3', secteur_libelle: 'Industrie' }),
      makeProspect({ id: '4', secteur_libelle: 'Transport' }),
      makeProspect({ id: '5', secteur_libelle: 'Transport' }),
      makeProspect({ id: '6', secteur_libelle: 'Santé' }),
    ]

    const result = topSectors(prospects, 3)

    expect(result.map((r) => r.label)).toEqual(['Industrie', 'Transport', 'Santé'])
    expect(result.map((r) => r.count)).toEqual([3, 2, 1])
    expect(result[0].sharePct).toBeCloseTo(50, 2)
    expect(result[1].sharePct).toBeCloseTo(200 / 6, 2)
    expect(result[2].sharePct).toBeCloseTo(100 / 6, 2)
  })

  it('regroupe les prospects sans secteur sous "Secteur inconnu"', () => {
    const prospects = [
      makeProspect({ id: '1', secteur_libelle: undefined }),
      makeProspect({ id: '2', secteur_libelle: '' }),
      makeProspect({ id: '3', secteur_libelle: '   ' }),
    ]

    const result = topSectors(prospects, 5)

    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('Secteur inconnu')
    expect(result[0].count).toBe(3)
  })

  it('respecte la limite (default 5)', () => {
    const prospects = Array.from({ length: 10 }, (_, i) =>
      makeProspect({ id: String(i), secteur_libelle: `Secteur-${i}` }),
    )

    expect(topSectors(prospects)).toHaveLength(5)
    expect(topSectors(prospects, 3)).toHaveLength(3)
  })

  it('retourne [] sur liste vide', () => {
    expect(topSectors([])).toEqual([])
  })
})

// ── sourcingMix ──────────────────────────────────────────────────────────────

describe('sourcingMix', () => {
  it('compte sirene_api vs autre source depuis prospects.source', () => {
    const prospects = [
      makeProspect({ id: '1', source: 'sirene_api' }),
      makeProspect({ id: '2', source: 'sirene_api' }),
      makeProspect({ id: '3', source: 'recherche_entreprises' }),
    ]

    const mix = sourcingMix(prospects, [])

    expect(mix.sirene).toBe(2)
    expect(mix.recherche).toBe(1)
    expect(mix.sirenePct).toBeCloseTo(200 / 3, 2)
  })

  it('retombe sur agent_runs.logs.used_fallback si prospects sources vides', () => {
    const prospects: Prospect[] = []
    const runs: AgentRun[] = [
      makeRun({
        id: 'r1',
        prospects_sourced: 50,
        logs: [
          {
            timestamp: '2026-05-01T22:00:00Z',
            phase: 'sourcing',
            message: 'fallback',
            level: 'info',
            data: { used_fallback: true },
          },
        ],
      }),
      makeRun({
        id: 'r2',
        prospects_sourced: 30,
        logs: [
          {
            timestamp: '2026-05-02T22:00:00Z',
            phase: 'sourcing',
            message: 'sirene',
            level: 'info',
            data: { used_fallback: false },
          },
        ],
      }),
    ]

    const mix = sourcingMix(prospects, runs)

    expect(mix.sirene).toBe(30)
    expect(mix.recherche).toBe(50)
  })

  it('retourne 0/0/0 sur tout vide', () => {
    const mix = sourcingMix([], [])
    expect(mix).toEqual({ sirene: 0, recherche: 0, sirenePct: 0 })
  })
})

// ── toRunStat + formatDurationShort ──────────────────────────────────────────

describe('toRunStat', () => {
  it('calcule durationMs depuis started_at / completed_at', () => {
    const run = makeRun({
      started_at: '2026-05-01T22:00:00Z',
      completed_at: '2026-05-01T22:04:00Z',
    })
    expect(toRunStat(run).durationMs).toBe(4 * 60 * 1000)
  })

  it('retourne null si run pas complété', () => {
    const run = makeRun({ completed_at: undefined, status: 'running' })
    expect(toRunStat(run).durationMs).toBeNull()
  })

  it('retourne null si timestamps incohérents (end < start)', () => {
    const run = makeRun({
      started_at: '2026-05-01T22:04:00Z',
      completed_at: '2026-05-01T22:00:00Z',
    })
    expect(toRunStat(run).durationMs).toBeNull()
  })
})

describe('formatDurationShort', () => {
  it('formate des secondes < 60s', () => {
    expect(formatDurationShort(30_000)).toBe('30s')
    expect(formatDurationShort(0)).toBe('0s')
  })

  it('formate minutes + secondes', () => {
    expect(formatDurationShort(60_000)).toBe('1m')
    expect(formatDurationShort(125_000)).toBe('2m 5s')
  })

  it('retourne "—" sur null ou valeur invalide', () => {
    expect(formatDurationShort(null)).toBe('—')
    expect(formatDurationShort(-1)).toBe('—')
    expect(formatDurationShort(Number.NaN)).toBe('—')
  })
})
