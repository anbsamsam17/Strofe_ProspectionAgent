// ============================================================
// TESTS UNITAIRES — scoring.ts
// Vitest — pattern AAA (Arrange / Act / Assert)
// ============================================================

import { describe, expect, it } from 'vitest'
import type { Prospect } from '@/lib/types'
import {
  calculerScore,
  determinerPriorite,
  estSecteurPrioritaire,
  getScoreDetails,
} from '../scoring'

// ------------------------------------------------------------
// HELPERS DE TEST
// ------------------------------------------------------------

function makeProspect(overrides: Partial<Prospect> = {}): Partial<Prospect> {
  return {
    siren: '123456789',
    raison_sociale: 'Test SAS',
    secteur_naf: '10.11Z',
    effectif_min: 500,
    effectif_max: 999,
    obligation_beges: true,
    beges_publie: false,
    contact_telephone: '0556000000',
    signaux: [],
    statut: 'sourced',
    ...overrides,
  }
}

// ------------------------------------------------------------
// CAS 1 : Prospect idéal — score maximal
// Obligation BEGES + secteur prioritaire + BEGES non publié +
// contact trouvé + signaux (taille 500-999 = 6 pts)
// => 30 + 20 + 20 + 5 + 6 = 81 (plafonné à 100)
// ------------------------------------------------------------

describe('calculerScore — cas nominal', () => {
  it('attribue un score élevé au prospect idéal sans pénalité', () => {
    // Arrange
    const prospect = makeProspect()

    // Act
    const score = calculerScore(prospect, false)

    // Assert
    expect(score).toBe(81) // 30+20+20+5+6
    expect(score).toBeGreaterThanOrEqual(60)
    expect(score).toBeLessThanOrEqual(100)
  })
})

// ------------------------------------------------------------
// CAS 2 : Prospect rejeté — pénalité -50 appliquée
// ------------------------------------------------------------

describe('calculerScore — prospect rejeté', () => {
  it('applique la pénalité -50 quand le statut est rejected', () => {
    // Arrange
    const prospect = makeProspect({ statut: 'rejected' })

    // Act
    const score = calculerScore(prospect, false)
    const details = getScoreDetails(prospect, false)

    // Assert
    expect(details.penalite_rejete).toBe(-50)
    expect(score).toBe(31) // 81 - 50
  })
})

// ------------------------------------------------------------
// CAS 3 : Prospect déjà contacté — pénalité -20 appliquée
// ------------------------------------------------------------

describe('calculerScore — déjà contacté', () => {
  it('applique la pénalité -20 quand dejaContacte = true', () => {
    // Arrange
    const prospect = makeProspect()

    // Act
    const scoreNoContact = calculerScore(prospect, false)
    const scoreDejaContacte = calculerScore(prospect, true)
    const details = getScoreDetails(prospect, true)

    // Assert
    expect(details.penalite_deja_contacte).toBe(-20)
    expect(scoreDejaContacte).toBe(scoreNoContact - 20)
    expect(scoreDejaContacte).toBe(61)
  })
})

// ------------------------------------------------------------
// CAS 4 : Prospect sans obligation BEGES, secteur non prioritaire,
// BEGES déjà publié — score minimal
// ------------------------------------------------------------

describe('calculerScore — prospect faible priorité', () => {
  it('retourne un score bas pour un prospect non prioritaire', () => {
    // Arrange
    const prospect = makeProspect({
      obligation_beges: false,
      secteur_naf: '47.11F', // Grande distribution — hors secteur prioritaire
      beges_publie: true,
      contact_telephone: undefined,
      effectif_min: 200,
      effectif_max: 249, // Tranche 31 → 3 pts taille
      signaux: [],
    })

    // Act
    const score = calculerScore(prospect, false)
    const details = getScoreDetails(prospect, false)

    // Assert
    expect(details.obligation_beges).toBe(0)
    expect(details.secteur_prioritaire).toBe(0)
    expect(details.beges_non_publie).toBe(0)
    expect(details.contact_trouve).toBe(0)
    expect(details.taille_entreprise).toBe(3)
    expect(score).toBe(3)
  })
})

// ------------------------------------------------------------
// CAS 5 : Score clampé à 0 — cumul de pénalités
// ------------------------------------------------------------

describe('calculerScore — score plancher à 0', () => {
  it('ne retourne jamais un score négatif', () => {
    // Arrange : prospect rejeté + déjà contacté + aucun point
    const prospect = makeProspect({
      obligation_beges: false,
      secteur_naf: '47.11F',
      beges_publie: true,
      contact_telephone: undefined,
      effectif_min: 0,
      effectif_max: 0,
      signaux: [],
      statut: 'rejected',
    })

    // Act
    const score = calculerScore(prospect, true) // -50 + -20 = -70

    // Assert
    expect(score).toBe(0)
    expect(score).toBeGreaterThanOrEqual(0)
  })
})

// ------------------------------------------------------------
// CAS 6 : Signaux d'intention — plafond à 15 pts
// ------------------------------------------------------------

describe('calculerScore — signaux intention', () => {
  it('plafonne les signaux à 15 points même avec plusieurs signaux lourds', () => {
    // Arrange
    const prospect = makeProspect({
      obligation_beges: false,
      secteur_naf: '47.11F',
      beges_publie: true,
      contact_telephone: undefined,
      effectif_max: 0,
      signaux: [
        { type: 'job_posting', description: 'RSE', weight: 10 },
        { type: 'sustainability_report_missing', description: 'Rapport absent', weight: 10 },
        { type: 'press_release', description: 'Annonce', weight: 5 },
      ],
    })

    // Act
    const details = getScoreDetails(prospect, false)
    const score = calculerScore(prospect, false)

    // Assert
    expect(details.signaux_intention).toBe(15) // plafonné
    expect(score).toBe(15)
  })
})

// ------------------------------------------------------------
// CAS 7 : estSecteurPrioritaire — normalisation des codes NAF
// ------------------------------------------------------------

describe('estSecteurPrioritaire', () => {
  it('reconnaît un code NAF avec point comme prioritaire', () => {
    expect(estSecteurPrioritaire('01.21Z')).toBe(true)
    expect(estSecteurPrioritaire('30.30Z')).toBe(true)
    expect(estSecteurPrioritaire('52.10B')).toBe(true)
  })

  it('reconnaît un code NAF sans point (format compact) comme prioritaire', () => {
    expect(estSecteurPrioritaire('0121Z')).toBe(true)
    expect(estSecteurPrioritaire('4941A')).toBe(true)
  })

  it('retourne false pour un secteur hors liste prioritaire', () => {
    expect(estSecteurPrioritaire('47.11F')).toBe(false)
    expect(estSecteurPrioritaire('64.19Z')).toBe(false)
    expect(estSecteurPrioritaire('')).toBe(false)
  })
})

// ------------------------------------------------------------
// CAS 8 : determinerPriorite — seuils
// ------------------------------------------------------------

describe('determinerPriorite', () => {
  it('retourne "haute" pour score >= 60', () => {
    expect(determinerPriorite(60)).toBe('haute')
    expect(determinerPriorite(81)).toBe('haute')
    expect(determinerPriorite(100)).toBe('haute')
  })

  it('retourne "normale" pour score entre 30 et 59', () => {
    expect(determinerPriorite(30)).toBe('normale')
    expect(determinerPriorite(45)).toBe('normale')
    expect(determinerPriorite(59)).toBe('normale')
  })

  it('retourne "basse" pour score < 30', () => {
    expect(determinerPriorite(0)).toBe('basse')
    expect(determinerPriorite(15)).toBe('basse')
    expect(determinerPriorite(29)).toBe('basse')
  })
})

// ------------------------------------------------------------
// CAS 9 : Décomposition getScoreDetails — cohérence
// ------------------------------------------------------------

describe('getScoreDetails', () => {
  it('la somme des détails clampée correspond bien au score calculerScore', () => {
    // Arrange
    const prospect = makeProspect()

    // Act
    const details = getScoreDetails(prospect, false)
    const scoreFromDetails = Math.max(
      0,
      Math.min(
        100,
        details.obligation_beges +
          details.secteur_prioritaire +
          details.beges_non_publie +
          details.signaux_intention +
          details.taille_entreprise +
          details.contact_trouve +
          details.penalite_deja_contacte +
          details.penalite_rejete,
      ),
    )
    const scoreFromFn = calculerScore(prospect, false)

    // Assert
    expect(scoreFromDetails).toBe(scoreFromFn)
  })
})
