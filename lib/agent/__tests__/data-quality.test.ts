// ============================================================
// TESTS — Data Quality Gates (lib/agent/data-quality.ts)
// AAA : Arrange → Act → Assert. Aucun appel réseau (module pur).
// ============================================================

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DQ_THRESHOLDS,
  runDataQualityChecks,
  type RunQualityMetrics,
} from '../data-quality'

// ------------------------------------------------------------
// FIXTURE — un run sain "nominal" qui passe tous les checks au vert.
// ------------------------------------------------------------

function healthyMetrics(overrides: Partial<RunQualityMetrics> = {}): RunQualityMetrics {
  return {
    prospectsSourced: 50,
    prospectsSansContact: 20, // 40 % — sous le seuil warn (0.8)
    prospectsSansBeges: 35, // 70 % — sous le seuil warn (0.9)
    prospectsAvecBeges: 15, // 30 % de match — au-dessus du warn (0.1)
    usedFallback: false,
    universeEmpty: false,
    previousProspectsSourced: 48, // run stable
    ...overrides,
  }
}

function checkByName(report: ReturnType<typeof runDataQualityChecks>, name: string) {
  const found = report.checks.find((c) => c.name === name)
  if (!found) throw new Error(`Check ${name} introuvable dans le rapport`)
  return found
}

describe('runDataQualityChecks — cas nominal', () => {
  it('renvoie un statut global ok quand toutes les métriques sont saines', () => {
    // Arrange
    const metrics = healthyMetrics()

    // Act
    const report = runDataQualityChecks(metrics)

    // Assert
    expect(report.status).toBe('ok')
    expect(report.summary.critical).toBe(0)
    expect(report.summary.warn).toBe(0)
    expect(report.checks).toHaveLength(5)
  })
})

describe('runDataQualityChecks — volume sourcé', () => {
  it('émet warn quand le volume est sous le seuil warn mais au-dessus du critique', () => {
    // Arrange : 5 prospects (entre minSourcedCritical=1 et minSourcedWarn=10).
    // previousProspectsSourced=5 pour isoler le check volume (pas de chute).
    const metrics = healthyMetrics({ prospectsSourced: 5, prospectsAvecBeges: 2, prospectsSansBeges: 3, prospectsSansContact: 2, previousProspectsSourced: 5 })

    // Act
    const report = runDataQualityChecks(metrics)
    const volume = checkByName(report, 'SOURCED_VOLUME')

    // Assert
    expect(volume.status).toBe('warn')
    expect(volume.observed).toBe(5)
    expect(report.status).toBe('warn')
  })

  it('émet critical quand le volume est effondré (≤ minSourcedCritical)', () => {
    // Arrange
    const metrics = healthyMetrics({ prospectsSourced: 1, prospectsAvecBeges: 0, prospectsSansBeges: 1, prospectsSansContact: 1 })

    // Act
    const report = runDataQualityChecks(metrics)
    const volume = checkByName(report, 'SOURCED_VOLUME')

    // Assert
    expect(volume.status).toBe('critical')
    expect(report.status).toBe('critical')
  })

  it('skippe le check volume quand l\'univers Sirene est vide (pas une dégradation)', () => {
    // Arrange : 0 sourcé mais universeEmpty → état métier attendu
    const metrics = healthyMetrics({ prospectsSourced: 0, prospectsAvecBeges: 0, prospectsSansBeges: 0, prospectsSansContact: 0, universeEmpty: true, previousProspectsSourced: null })

    // Act
    const report = runDataQualityChecks(metrics)
    const volume = checkByName(report, 'SOURCED_VOLUME')

    // Assert
    expect(volume.skipped).toBe(true)
    expect(report.status).toBe('ok')
  })

  it('seuil limite : exactement minSourcedWarn reste ok', () => {
    // Arrange : observed === minSourcedWarn (10) → ok (la borne warn est stricte <)
    const metrics = healthyMetrics({ prospectsSourced: DEFAULT_DQ_THRESHOLDS.minSourcedWarn })

    // Act
    const volume = checkByName(runDataQualityChecks(metrics), 'SOURCED_VOLUME')

    // Assert
    expect(volume.status).toBe('ok')
  })
})

describe('runDataQualityChecks — taux sans contact', () => {
  it('émet warn au-delà du seuil warn', () => {
    // Arrange : 45/50 = 0.9 ≥ warn (0.8) mais < critical (0.97)
    const metrics = healthyMetrics({ prospectsSansContact: 45 })

    // Act
    const check = checkByName(runDataQualityChecks(metrics), 'SANS_CONTACT_RATE')

    // Assert
    expect(check.status).toBe('warn')
    expect(check.observed).toBeCloseTo(0.9, 4)
  })

  it('émet critical quand quasi aucun contact n\'est trouvé', () => {
    // Arrange : 50/50 = 1.0 ≥ critical (0.97)
    const metrics = healthyMetrics({ prospectsSansContact: 50 })

    // Act
    const report = runDataQualityChecks(metrics)
    const check = checkByName(report, 'SANS_CONTACT_RATE')

    // Assert
    expect(check.status).toBe('critical')
    expect(report.status).toBe('critical')
  })

  it('seuil limite : exactement maxSansContactRateWarn déclenche warn (borne ≥)', () => {
    // Arrange : 40/50 = 0.8 === warn
    const metrics = healthyMetrics({ prospectsSansContact: 40 })

    // Act
    const check = checkByName(runDataQualityChecks(metrics), 'SANS_CONTACT_RATE')

    // Assert
    expect(check.status).toBe('warn')
  })
})

describe('runDataQualityChecks — mode dégradé BEGES', () => {
  it('émet warn au-delà du seuil', () => {
    // Arrange : 46/50 = 0.92 ≥ warn (0.9) < critical (0.99)
    const metrics = healthyMetrics({ prospectsSansBeges: 46, prospectsAvecBeges: 4 })

    // Act
    const check = checkByName(runDataQualityChecks(metrics), 'SANS_BEGES_RATE')

    // Assert
    expect(check.status).toBe('warn')
  })

  it('émet critical quand quasi tous les prospects sont en mode dégradé', () => {
    // Arrange : 50/50 = 1.0 ≥ critical (0.99)
    const metrics = healthyMetrics({ prospectsSansBeges: 50, prospectsAvecBeges: 0 })

    // Act
    const check = checkByName(runDataQualityChecks(metrics), 'SANS_BEGES_RATE')

    // Assert
    expect(check.status).toBe('critical')
  })
})

describe('runDataQualityChecks — taux de match ADEME', () => {
  it('émet critical quand le taux de match est quasi-nul sur un volume conséquent', () => {
    // Arrange : 0/50 = 0 ≤ critical (0.02)
    const metrics = healthyMetrics({ prospectsAvecBeges: 0, prospectsSansBeges: 50 })

    // Act
    const report = runDataQualityChecks(metrics)
    const check = checkByName(report, 'ADEME_MATCH_RATE')

    // Assert
    expect(check.status).toBe('critical')
    expect(report.status).toBe('critical')
  })

  it('émet warn quand le taux de match est bas mais non nul', () => {
    // Arrange : 2/50 = 0.04 < warn (0.1) mais > critical (0.02)
    const metrics = healthyMetrics({ prospectsAvecBeges: 2, prospectsSansBeges: 48 })

    // Act
    const check = checkByName(runDataQualityChecks(metrics), 'ADEME_MATCH_RATE')

    // Assert
    expect(check.status).toBe('warn')
  })

  it('skippe le check quand le volume est insuffisant pour être significatif', () => {
    // Arrange : 8 prospects (< minSourcedWarn=10), 0 match → ne doit PAS alerter
    const metrics = healthyMetrics({ prospectsSourced: 8, prospectsAvecBeges: 0, prospectsSansBeges: 8, prospectsSansContact: 4 })

    // Act
    const check = checkByName(runDataQualityChecks(metrics), 'ADEME_MATCH_RATE')

    // Assert
    expect(check.skipped).toBe(true)
  })
})

describe('runDataQualityChecks — chute vs run précédent', () => {
  it('émet critical sur une chute brutale du volume', () => {
    // Arrange : 10 vs 100 → drop 0.9 ≥ critical (0.8)
    const metrics = healthyMetrics({ prospectsSourced: 10, prospectsAvecBeges: 3, prospectsSansBeges: 7, prospectsSansContact: 4, previousProspectsSourced: 100 })

    // Act
    const report = runDataQualityChecks(metrics)
    const check = checkByName(report, 'DROP_VS_PREVIOUS')

    // Assert
    expect(check.status).toBe('critical')
    expect(check.observed).toBeCloseTo(0.9, 4)
  })

  it('émet warn sur une baisse notable mais non critique', () => {
    // Arrange : 30 vs 60 → drop 0.5 ≥ warn (0.5) < critical (0.8)
    const metrics = healthyMetrics({ prospectsSourced: 30, prospectsAvecBeges: 10, prospectsSansBeges: 20, prospectsSansContact: 12, previousProspectsSourced: 60 })

    // Act
    const check = checkByName(runDataQualityChecks(metrics), 'DROP_VS_PREVIOUS')

    // Assert
    expect(check.status).toBe('warn')
  })

  it('skippe quand il n\'y a pas de run précédent', () => {
    // Arrange
    const metrics = healthyMetrics({ previousProspectsSourced: null })

    // Act
    const check = checkByName(runDataQualityChecks(metrics), 'DROP_VS_PREVIOUS')

    // Assert
    expect(check.skipped).toBe(true)
  })

  it('skippe quand le run a basculé sur le fallback (volume non comparable)', () => {
    // Arrange : grosse baisse mais usedFallback → non comparable
    const metrics = healthyMetrics({ prospectsSourced: 5, prospectsAvecBeges: 1, prospectsSansBeges: 4, prospectsSansContact: 3, usedFallback: true, previousProspectsSourced: 100 })

    // Act
    const check = checkByName(runDataQualityChecks(metrics), 'DROP_VS_PREVIOUS')

    // Assert
    expect(check.skipped).toBe(true)
  })
})

describe('runDataQualityChecks — métriques vides / cas limites', () => {
  it('ne throw pas et marque les checks de taux comme skippés quand tout est à zéro', () => {
    // Arrange
    const metrics: RunQualityMetrics = {
      prospectsSourced: 0,
      prospectsSansContact: 0,
      prospectsSansBeges: 0,
      prospectsAvecBeges: 0,
      usedFallback: false,
      universeEmpty: false,
      previousProspectsSourced: null,
    }

    // Act
    const report = runDataQualityChecks(metrics)

    // Assert : volume=critical (0 ≤ 1), les taux skippés, drop skippé
    expect(checkByName(report, 'SANS_CONTACT_RATE').skipped).toBe(true)
    expect(checkByName(report, 'SANS_BEGES_RATE').skipped).toBe(true)
    expect(checkByName(report, 'ADEME_MATCH_RATE').skipped).toBe(true)
    expect(checkByName(report, 'DROP_VS_PREVIOUS').skipped).toBe(true)
    expect(checkByName(report, 'SOURCED_VOLUME').status).toBe('critical')
    expect(report.summary.skipped).toBe(4)
  })

  it('le statut global est le max de gravité des checks non-skippés', () => {
    // Arrange : volume warn + sans-contact critical → global critical
    const metrics = healthyMetrics({ prospectsSourced: 5, prospectsSansContact: 5, prospectsSansBeges: 3, prospectsAvecBeges: 2 })

    // Act
    const report = runDataQualityChecks(metrics)

    // Assert
    expect(report.status).toBe('critical')
  })

  it('respecte les seuils surchargés', () => {
    // Arrange : 20 prospects, défaut → ok ; mais minSourcedWarn surchargé à 25 → warn
    const metrics = healthyMetrics({ prospectsSourced: 20, prospectsAvecBeges: 8, prospectsSansBeges: 12, prospectsSansContact: 8, previousProspectsSourced: 20 })

    // Act
    const report = runDataQualityChecks(metrics, { minSourcedWarn: 25 })
    const volume = checkByName(report, 'SOURCED_VOLUME')

    // Assert
    expect(volume.status).toBe('warn')
    expect(volume.threshold).toBe(25)
  })
})
