// ============================================================
// TESTS — lib/pipeline/forecast
// ------------------------------------------------------------
// Couvre :
//   - defaultProbabilityForStatus : 1 cas par statut canonique
//   - computeForecast : nominal + edge cases (null, 0, négatif, > 100)
//   - sumForecast : agrégation
//   - formatEuros : formatage FR
// ============================================================

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PROBABILITY_BY_STATUS,
  computeForecast,
  defaultProbabilityForStatus,
  formatEuros,
  sumForecast,
} from '../forecast'

// ------------------------------------------------------------
// defaultProbabilityForStatus — 1 cas par statut
// ------------------------------------------------------------

describe('defaultProbabilityForStatus', () => {
  it('sourced → 10%', () => {
    expect(defaultProbabilityForStatus('sourced')).toBe(10)
  })
  it('qualified → 25%', () => {
    expect(defaultProbabilityForStatus('qualified')).toBe(25)
  })
  it('contacted → 25%', () => {
    expect(defaultProbabilityForStatus('contacted')).toBe(25)
  })
  it('interested → 50%', () => {
    expect(defaultProbabilityForStatus('interested')).toBe(50)
  })
  it('rdv → 75%', () => {
    expect(defaultProbabilityForStatus('rdv')).toBe(75)
  })
  it('offer_sent → 60%', () => {
    expect(defaultProbabilityForStatus('offer_sent')).toBe(60)
  })
  it('converted → 100%', () => {
    expect(defaultProbabilityForStatus('converted')).toBe(100)
  })
  it('rejected → 0%', () => {
    expect(defaultProbabilityForStatus('rejected')).toBe(0)
  })
  it('do_not_contact → 0%', () => {
    expect(defaultProbabilityForStatus('do_not_contact')).toBe(0)
  })
  it('on_hold → 0%', () => {
    expect(defaultProbabilityForStatus('on_hold')).toBe(0)
  })

  it('statut inconnu → 0% (defensive)', () => {
    expect(defaultProbabilityForStatus('unknown_status_42')).toBe(0)
  })

  it('toutes les clés exposées sont alignées', () => {
    // Au cas où on ajouterait un statut sans MAJ le mapping.
    expect(DEFAULT_PROBABILITY_BY_STATUS).toBeDefined()
    expect(DEFAULT_PROBABILITY_BY_STATUS.sourced).toBe(10)
    expect(DEFAULT_PROBABILITY_BY_STATUS.converted).toBe(100)
  })
})

// ------------------------------------------------------------
// computeForecast — edge cases
// ------------------------------------------------------------

describe('computeForecast', () => {
  it('calcul nominal : 10 000 € × 50% = 5 000', () => {
    expect(computeForecast(10_000, 50)).toBe(5_000)
  })

  it('calcul arrondi entier (€ entier sans centimes)', () => {
    // 10000 * 33 / 100 = 3300 (entier déjà)
    expect(computeForecast(10_000, 33)).toBe(3_300)
    // 12345 * 50 / 100 = 6172.5 → arrondi 6173 (banker's round = round half to even ?
    // Math.round arrondit half up donc 6173)
    expect(computeForecast(12_345, 50)).toBe(6_173)
  })

  it('dealValue null/undefined → 0', () => {
    expect(computeForecast(null, 50)).toBe(0)
    expect(computeForecast(undefined, 50)).toBe(0)
  })

  it('dealProbability null/undefined → 0', () => {
    expect(computeForecast(10_000, null)).toBe(0)
    expect(computeForecast(10_000, undefined)).toBe(0)
  })

  it('dealValue <= 0 → 0', () => {
    expect(computeForecast(0, 50)).toBe(0)
    expect(computeForecast(-100, 50)).toBe(0)
  })

  it('dealProbability <= 0 → 0', () => {
    expect(computeForecast(10_000, 0)).toBe(0)
    expect(computeForecast(10_000, -10)).toBe(0)
  })

  it('dealProbability > 100 → clamp à 100', () => {
    // Defense contre données corrompues : si la DB renvoie 150, on ne génère
    // pas un forecast supérieur à la deal_value.
    expect(computeForecast(10_000, 150)).toBe(10_000)
  })

  it('valeurs non finies (NaN, Infinity) → 0', () => {
    expect(computeForecast(NaN, 50)).toBe(0)
    expect(computeForecast(10_000, NaN)).toBe(0)
    expect(computeForecast(Infinity, 50)).toBe(0)
    expect(computeForecast(10_000, Infinity)).toBe(0)
  })
})

// ------------------------------------------------------------
// sumForecast
// ------------------------------------------------------------

describe('sumForecast', () => {
  it('liste vide → 0', () => {
    expect(sumForecast([])).toBe(0)
  })

  it('somme un mix de prospects avec/sans deal_value', () => {
    const prospects = [
      { deal_value: 10_000, deal_probability: 50 }, // 5000
      { deal_value: 20_000, deal_probability: 25 }, // 5000
      { deal_value: null, deal_probability: 100 }, // 0
      { deal_value: 5_000, deal_probability: null }, // 0
      { deal_value: 100_000, deal_probability: 100 }, // 100000
    ]
    expect(sumForecast(prospects)).toBe(110_000)
  })
})

// ------------------------------------------------------------
// formatEuros
// ------------------------------------------------------------

describe('formatEuros', () => {
  it('formate avec séparateur FR et symbole €', () => {
    // Intl insère un NBSP (U+202F ou U+00A0) — on regex sur le motif.
    const result = formatEuros(12_500)
    expect(result).toMatch(/12.500.€/)
  })

  it('0 → "0 €"', () => {
    expect(formatEuros(0)).toBe('0 €')
  })

  it('arrondit à l\'entier', () => {
    const result = formatEuros(1234.7)
    expect(result).toMatch(/1.235.€/)
  })

  it('gère les grosses valeurs', () => {
    const result = formatEuros(1_234_567)
    expect(result).toMatch(/1.234.567.€/)
  })

  it('NaN/Infinity → "0 €" (defensive)', () => {
    expect(formatEuros(NaN)).toBe('0 €')
    expect(formatEuros(Infinity)).toBe('0 €')
  })
})
