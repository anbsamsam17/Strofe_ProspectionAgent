// ============================================================
// TESTS UNITAIRES — scoring.ts (refonte 2026-05-14)
// Vitest — pattern AAA (Arrange / Act / Assert)
//
// 3 piliers configurables (taille / BEGES / contact), défauts 30/30/40.
// Pas de mock externe : `calculerScore`, `getScoreDetails`,
// `determinerPriorite`, `normalizeScoringWeights` sont des fonctions pures.
// ============================================================

import { describe, expect, it } from 'vitest'
import type { Prospect, ScoringWeights } from '@/lib/types'
import {
  calculerScore,
  DEFAULT_SCORING_WEIGHTS,
  determinerPriorite,
  getScoreDetails,
  normalizeScoringWeights,
} from '../scoring'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProspect(overrides: Partial<Prospect> = {}): Partial<Prospect> {
  return {
    siren: '123456789',
    raison_sociale: 'Test SAS',
    effectif_min: 250,
    effectif_max: 500,       // dans le plateau optimal [450, 600]
    obligation_beges: true,
    beges_publie: false,     // → infraction L. 229-25
    contact_telephone: '0556000000',
    signaux: [],
    statut: 'sourced',
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PILIER 1 — TAILLE
// ─────────────────────────────────────────────────────────────────────────────

describe('Pilier Taille — sous-score 0-100', () => {
  it('renvoie 0 pour un effectif < 250 (sous-seuil)', () => {
    const details = getScoreDetails(makeProspect({ effectif_max: 100 }), false)
    expect(details.taille).toBe(0)
  })

  it('renvoie ~50 dans le ramp d\'entrée à effectif 350 (mi-pente)', () => {
    const details = getScoreDetails(makeProspect({ effectif_max: 350 }), false)
    // ramp [250, 450] linéaire 0 → 100 → à 350 on est à 50
    expect(details.taille).toBe(50)
  })

  it('renvoie 100 à effectif 500 (plateau optimal "juste au-dessus de 500")', () => {
    const details = getScoreDetails(makeProspect({ effectif_max: 500 }), false)
    expect(details.taille).toBe(100)
  })

  it('renvoie 100 à effectif 450 (début plateau)', () => {
    const details = getScoreDetails(makeProspect({ effectif_max: 450 }), false)
    expect(details.taille).toBe(100)
  })

  it('renvoie 100 à effectif 600 (fin plateau)', () => {
    const details = getScoreDetails(makeProspect({ effectif_max: 600 }), false)
    expect(details.taille).toBe(100)
  })

  it('décroît vers ~80 à effectif 1000 (début décroissance)', () => {
    const details = getScoreDetails(makeProspect({ effectif_max: 1000 }), false)
    // décroissance [600, 5000] de 100 → 20 (drop 80 sur range 4400)
    // à 1000 : 100 - 80 * (400/4400) = 100 - 7.27 ≈ 93
    // Note : 1000 est proche du début de la pente, donc plutôt ~92-93.
    expect(details.taille).toBeGreaterThanOrEqual(85)
    expect(details.taille).toBeLessThanOrEqual(95)
  })

  it('décroît vers ~57 à effectif 3000 (milieu décroissance)', () => {
    const details = getScoreDetails(makeProspect({ effectif_max: 3000 }), false)
    // à 3000 : 100 - 80 * (2400/4400) ≈ 56.4
    expect(details.taille).toBeGreaterThanOrEqual(50)
    expect(details.taille).toBeLessThanOrEqual(65)
  })

  it('renvoie 20 au plancher CAC40 (effectif >= 5000)', () => {
    const details1 = getScoreDetails(makeProspect({ effectif_max: 5000 }), false)
    const details2 = getScoreDetails(makeProspect({ effectif_max: 8000 }), false)
    expect(details1.taille).toBe(20)
    expect(details2.taille).toBe(20)
  })

  it('utilise effectif_min en fallback si effectif_max absent', () => {
    const details = getScoreDetails(
      makeProspect({ effectif_max: undefined, effectif_min: 500 }),
      false,
    )
    expect(details.taille).toBe(100)
  })

  it('renvoie 0 si effectif absent partout', () => {
    const details = getScoreDetails(
      makeProspect({ effectif_max: undefined, effectif_min: undefined }),
      false,
    )
    expect(details.taille).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PILIER 2 — BEGES
// ─────────────────────────────────────────────────────────────────────────────

describe('Pilier BEGES — sous-score 0-100', () => {
  it('renvoie 100 pour obligation + non publié (infraction L. 229-25)', () => {
    const details = getScoreDetails(
      makeProspect({ obligation_beges: true, beges_publie: false }),
      false,
    )
    expect(details.beges).toBe(100)
  })

  it('renvoie 100 pour BEGES publié mais expiré (renouvellement quadriennal dépassé)', () => {
    const details = getScoreDetails(
      makeProspect({
        obligation_beges: true,
        beges_publie: true,
        beges_valide: false,
      }),
      false,
    )
    expect(details.beges).toBe(100)
  })

  it('renvoie 50 pour entreprise proche du seuil (effectif 450) sans obligation', () => {
    const details = getScoreDetails(
      makeProspect({
        obligation_beges: false,
        beges_publie: false,
        effectif_max: 450,
      }),
      false,
    )
    expect(details.beges).toBe(50)
  })

  it('renvoie 50 pour effectif 499 sans obligation (borne haute anticipation)', () => {
    const details = getScoreDetails(
      makeProspect({
        obligation_beges: false,
        beges_publie: false,
        effectif_max: 499,
      }),
      false,
    )
    expect(details.beges).toBe(50)
  })

  it('renvoie 0 pour effectif 500 sans obligation (au-delà de la zone d\'anticipation)', () => {
    const details = getScoreDetails(
      makeProspect({
        obligation_beges: false,
        beges_publie: false,
        effectif_max: 500,
      }),
      false,
    )
    expect(details.beges).toBe(0)
  })

  it('renvoie 0 pour BEGES publié et valide (à jour)', () => {
    const details = getScoreDetails(
      makeProspect({
        obligation_beges: true,
        beges_publie: true,
        beges_valide: true,
      }),
      false,
    )
    expect(details.beges).toBe(0)
  })

  it('renvoie 0 pour PME sans obligation et hors zone d\'anticipation', () => {
    const details = getScoreDetails(
      makeProspect({
        obligation_beges: false,
        beges_publie: false,
        effectif_max: 100,
      }),
      false,
    )
    expect(details.beges).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PILIER 3 — CONTACT
// ─────────────────────────────────────────────────────────────────────────────

describe('Pilier Contact — sous-score 0-100', () => {
  it('renvoie 100 si téléphone direct présent', () => {
    const details = getScoreDetails(
      makeProspect({
        contact_telephone: '0145000000',
        contact_email: undefined,
        contact_linkedin: undefined,
      }),
      false,
    )
    expect(details.contact).toBe(100)
  })

  it('renvoie 50 si email présent sans téléphone', () => {
    const details = getScoreDetails(
      makeProspect({
        contact_telephone: undefined,
        contact_email: 'contact@example.fr',
        contact_linkedin: undefined,
      }),
      false,
    )
    expect(details.contact).toBe(50)
  })

  it('renvoie 25 si LinkedIn présent sans email ni téléphone', () => {
    const details = getScoreDetails(
      makeProspect({
        contact_telephone: undefined,
        contact_email: undefined,
        contact_linkedin: 'https://linkedin.com/in/test',
      }),
      false,
    )
    expect(details.contact).toBe(25)
  })

  it('renvoie 0 si aucun canal de contact', () => {
    const details = getScoreDetails(
      makeProspect({
        contact_telephone: undefined,
        contact_email: undefined,
        contact_linkedin: undefined,
      }),
      false,
    )
    expect(details.contact).toBe(0)
  })

  it('téléphone l\'emporte sur email + LinkedIn cumulés', () => {
    const details = getScoreDetails(
      makeProspect({
        contact_telephone: '0145000000',
        contact_email: 'a@b.fr',
        contact_linkedin: 'https://linkedin.com/in/x',
      }),
      false,
    )
    expect(details.contact).toBe(100)
  })

  it('email l\'emporte sur LinkedIn quand pas de téléphone', () => {
    const details = getScoreDetails(
      makeProspect({
        contact_telephone: undefined,
        contact_email: 'a@b.fr',
        contact_linkedin: 'https://linkedin.com/in/x',
      }),
      false,
    )
    expect(details.contact).toBe(50)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PONDÉRATION — normalizeScoringWeights
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeScoringWeights', () => {
  it('retourne les défauts 30/30/40 si undefined', () => {
    expect(normalizeScoringWeights()).toEqual(DEFAULT_SCORING_WEIGHTS)
    expect(normalizeScoringWeights(undefined)).toEqual(DEFAULT_SCORING_WEIGHTS)
  })

  it('retourne les défauts 30/30/40 si tous les poids valent 0', () => {
    expect(normalizeScoringWeights({ taille: 0, beges: 0, contact: 0 })).toEqual(
      DEFAULT_SCORING_WEIGHTS,
    )
  })

  it('passe inchangé si somme déjà = 100', () => {
    const w: ScoringWeights = { taille: 40, beges: 30, contact: 30 }
    expect(normalizeScoringWeights(w)).toEqual(w)
  })

  it('re-projette une pondération non-normalisée 1/1/2 vers 25/25/50', () => {
    expect(normalizeScoringWeights({ taille: 1, beges: 1, contact: 2 })).toEqual({
      taille: 25,
      beges: 25,
      contact: 50,
    })
  })

  it('re-projette 25/25/25 vers ~33/33/34 (somme = 100 préservée)', () => {
    const result = normalizeScoringWeights({ taille: 25, beges: 25, contact: 25 })
    expect(result.taille + result.beges + result.contact).toBe(100)
    // contact reçoit le reste (compense l'arrondi)
    expect(result.taille).toBe(33)
    expect(result.beges).toBe(33)
    expect(result.contact).toBe(34)
  })

  it('clamp les valeurs négatives / non-finies à 0', () => {
    // Cast : on teste un input mal formé du runtime (JSON.parse user input).
    const garbage = { taille: -10, beges: Number.NaN, contact: 20 } as unknown as ScoringWeights
    expect(normalizeScoringWeights(garbage)).toEqual({ taille: 0, beges: 0, contact: 100 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SCORE GLOBAL — pondération par défaut
// ─────────────────────────────────────────────────────────────────────────────

describe('calculerScore — pondération par défaut 30/30/40', () => {
  it('compose correctement un cas connu (taille 100 + BEGES 100 + contact 100)', () => {
    const prospect = makeProspect({
      effectif_max: 500, // taille 100
      obligation_beges: true,
      beges_publie: false, // BEGES 100
      contact_telephone: '0145000000', // contact 100
    })
    const score = calculerScore(prospect, false)
    // (100*30 + 100*30 + 100*40) / 100 = 100
    expect(score).toBe(100)
  })

  it('compose correctement (taille 0 + BEGES 0 + contact 100) = 40', () => {
    const prospect = makeProspect({
      effectif_max: 100,
      obligation_beges: false,
      beges_publie: true,
      beges_valide: true,
      contact_telephone: '0145000000',
    })
    const score = calculerScore(prospect, false)
    // (0*30 + 0*30 + 100*40) / 100 = 40
    expect(score).toBe(40)
  })

  it('compose correctement (taille 100 + BEGES 0 + contact 0) = 30', () => {
    const prospect = makeProspect({
      effectif_max: 500,
      obligation_beges: true,
      beges_publie: true,
      beges_valide: true,
      contact_telephone: undefined,
      contact_email: undefined,
      contact_linkedin: undefined,
    })
    const score = calculerScore(prospect, false)
    // (100*30 + 0*30 + 0*40) / 100 = 30
    expect(score).toBe(30)
  })

  it('compose correctement (taille 100 + BEGES 100 + contact 50) = 80', () => {
    const prospect = makeProspect({
      effectif_max: 500,             // taille 100
      obligation_beges: true,
      beges_publie: false,           // BEGES 100
      contact_telephone: undefined,
      contact_email: 'a@b.fr',       // contact 50
      contact_linkedin: undefined,
    })
    const score = calculerScore(prospect, false)
    // (100*30 + 100*30 + 50*40) / 100 = 30 + 30 + 20 = 80
    expect(score).toBe(80)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SCORE GLOBAL — pondération custom
// ─────────────────────────────────────────────────────────────────────────────

describe('calculerScore — pondération custom', () => {
  it('un user qui privilégie la taille (50/25/25) déprime le score d\'un prospect contact-only', () => {
    const prospect = makeProspect({
      effectif_max: 100,             // taille 0
      obligation_beges: false,
      beges_publie: true,
      beges_valide: true,             // BEGES 0
      contact_telephone: '0145000000', // contact 100
    })
    const scoreDefault = calculerScore(prospect, false)
    const scoreCustom = calculerScore(prospect, false, {
      taille: 50,
      beges: 25,
      contact: 25,
    })
    // Default 30/30/40 → 40 ; custom 50/25/25 → 25
    expect(scoreDefault).toBe(40)
    expect(scoreCustom).toBe(25)
    expect(scoreCustom).toBeLessThan(scoreDefault)
  })

  it('normalise une pondération 1/1/2 et applique le résultat', () => {
    const prospect = makeProspect({
      effectif_max: 500,             // taille 100
      obligation_beges: true,
      beges_publie: false,           // BEGES 100
      contact_telephone: '0145000000', // contact 100
    })
    const score = calculerScore(prospect, false, { taille: 1, beges: 1, contact: 2 })
    // Normalisé 25/25/50 → (100*25 + 100*25 + 100*50) / 100 = 100
    expect(score).toBe(100)
  })

  it('expose les weights normalisés dans ScoreDetails', () => {
    const details = getScoreDetails(makeProspect(), false, {
      taille: 1, beges: 1, contact: 2,
    })
    expect(details.weights).toEqual({ taille: 25, beges: 25, contact: 50 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PÉNALITÉS
// ─────────────────────────────────────────────────────────────────────────────

describe('calculerScore — pénalités', () => {
  it('applique -20 si déjà contacté', () => {
    const prospect = makeProspect({
      effectif_max: 500,
      obligation_beges: true,
      beges_publie: false,
      contact_telephone: '0145000000',
    })
    const detailsNoContact = getScoreDetails(prospect, false)
    const detailsDejaContacte = getScoreDetails(prospect, true)

    expect(detailsNoContact.deja_contacte_penalty).toBe(0)
    expect(detailsDejaContacte.deja_contacte_penalty).toBe(-20)

    // Score brut = 100 ; avec pénalité = 80
    expect(calculerScore(prospect, false)).toBe(100)
    expect(calculerScore(prospect, true)).toBe(80)
  })

  it('applique -50 si statut = rejected', () => {
    const prospect = makeProspect({
      effectif_max: 500,
      obligation_beges: true,
      beges_publie: false,
      contact_telephone: '0145000000',
      statut: 'rejected',
    })
    const details = getScoreDetails(prospect, false)
    expect(details.rejete_penalty).toBe(-50)
    // Score brut = 100 ; avec pénalité = 50
    expect(calculerScore(prospect, false)).toBe(50)
  })

  it('cumule pénalités déjà contacté + rejeté', () => {
    const prospect = makeProspect({
      effectif_max: 500,
      obligation_beges: true,
      beges_publie: false,
      contact_telephone: '0145000000',
      statut: 'rejected',
    })
    const details = getScoreDetails(prospect, true)
    expect(details.deja_contacte_penalty).toBe(-20)
    expect(details.rejete_penalty).toBe(-50)
    // Score brut = 100 ; avec pénalités = 100 - 20 - 50 = 30
    expect(calculerScore(prospect, true)).toBe(30)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// CLAMP — bornes [0, 100]
// ─────────────────────────────────────────────────────────────────────────────

describe('calculerScore — clamp [0, 100]', () => {
  it('ne retourne jamais un score négatif', () => {
    const prospect = makeProspect({
      effectif_max: 100,           // taille 0
      obligation_beges: false,
      beges_publie: true,
      beges_valide: true,          // BEGES 0
      contact_telephone: undefined,
      contact_email: undefined,
      contact_linkedin: undefined, // contact 0
      statut: 'rejected',          // -50
    })
    const score = calculerScore(prospect, true) // -20 supplémentaire
    expect(score).toBe(0)
    expect(score).toBeGreaterThanOrEqual(0)
  })

  it('ne dépasse jamais 100 même avec piliers max', () => {
    const prospect = makeProspect({
      effectif_max: 500,
      obligation_beges: true,
      beges_publie: false,
      contact_telephone: '0145000000',
    })
    const score = calculerScore(prospect, false)
    expect(score).toBeLessThanOrEqual(100)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PRIORITÉ — seuils
// ─────────────────────────────────────────────────────────────────────────────

describe('determinerPriorite', () => {
  it('retourne "haute" pour score >= 60', () => {
    expect(determinerPriorite(60)).toBe('haute')
    expect(determinerPriorite(80)).toBe('haute')
    expect(determinerPriorite(100)).toBe('haute')
  })

  it('retourne "moyenne" pour score entre 30 et 59', () => {
    expect(determinerPriorite(30)).toBe('moyenne')
    expect(determinerPriorite(45)).toBe('moyenne')
    expect(determinerPriorite(59)).toBe('moyenne')
  })

  it('retourne "basse" pour score < 30', () => {
    expect(determinerPriorite(0)).toBe('basse')
    expect(determinerPriorite(15)).toBe('basse')
    expect(determinerPriorite(29)).toBe('basse')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// COHÉRENCE — getScoreDetails ↔ calculerScore
// ─────────────────────────────────────────────────────────────────────────────

describe('cohérence getScoreDetails ↔ calculerScore', () => {
  it('le score reconstruit à partir des détails correspond à calculerScore', () => {
    const prospect = makeProspect({
      effectif_max: 500,
      obligation_beges: true,
      beges_publie: false,
      contact_email: 'a@b.fr',
      contact_telephone: undefined,
    })
    const details = getScoreDetails(prospect, false)
    const reconstructed =
      Math.round(
        (details.taille * details.weights.taille +
          details.beges * details.weights.beges +
          details.contact * details.weights.contact) /
          100,
      ) +
      details.deja_contacte_penalty +
      details.rejete_penalty
    const clamped = Math.max(0, Math.min(100, reconstructed))

    expect(clamped).toBe(calculerScore(prospect, false))
  })
})
