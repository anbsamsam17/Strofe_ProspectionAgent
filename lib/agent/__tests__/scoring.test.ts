// ============================================================
// TESTS UNITAIRES — scoring.ts
// Vitest — pattern AAA (Arrange / Act / Assert)
// Tuning 2026-05-13 : BEGES expiré +25 > vierge +15, sweet spot 250-800 +15,
// téléphone +10, secteur mature +5, bonus_infraction_legale +20 (obligé sans
// BEGES publié = infraction L. 229-25). Voir memory/hindsight.md.
// ============================================================

import { describe, expect, it } from 'vitest'
import type { Prospect } from '@/lib/types'
import {
  calculerScore,
  determinerPriorite,
  estSecteurBegesMature,
  estSecteurPrioritaire,
  getScoreDetails,
} from '../scoring'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProspect(overrides: Partial<Prospect> = {}): Partial<Prospect> {
  return {
    siren: '123456789',
    raison_sociale: 'Test SAS',
    secteur_naf: '10.11Z', // agro → prioritaire + mature
    effectif_min: 500,
    effectif_max: 999,     // tranche 800-1999 → +10
    obligation_beges: true,
    beges_publie: false,
    contact_telephone: '0556000000',
    signaux: [],
    statut: 'sourced',
    ...overrides,
  }
}

// ── CAS 1 : Prospect idéal ──────────────────────────────────────────────────
// Profil "infraction" (obligation=true && beges_publie=false) + tous bonus :
// obligation +30, secteur prio +20, BEGES non publié +15, bonus infraction +20,
// taille 999 +10, contact tel +10, secteur agro mature +5 = 110 → clamp 100

describe('calculerScore — cas nominal', () => {
  it('attribue un score maximal (clamp 100) au prospect idéal "infraction"', () => {
    const prospect = makeProspect()
    const score = calculerScore(prospect, false)

    // Brut = 30 + 20 + 15 + 20 (bonus infraction) + 10 + 10 + 5 = 110 → clampé 100
    expect(score).toBe(100)
    expect(score).toBeGreaterThanOrEqual(60)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('décompose correctement les points dans ScoreDetails', () => {
    const prospect = makeProspect()
    const details = getScoreDetails(prospect, false)

    expect(details.obligation_beges).toBe(30)
    expect(details.secteur_prioritaire).toBe(20)
    expect(details.beges_non_publie).toBe(15)
    expect(details.beges_expire).toBe(0)
    expect(details.taille_entreprise).toBe(10)
    expect(details.contact_trouve).toBe(10)
    expect(details.secteur_beges_mature).toBe(5)
    expect(details.bonus_infraction_legale).toBe(20)
  })
})

// ── CAS 2 : Prospect rejeté ─────────────────────────────────────────────────

describe('calculerScore — prospect rejeté', () => {
  it('applique la pénalité -50 quand le statut est rejected', () => {
    const prospect = makeProspect({ statut: 'rejected' })
    const score = calculerScore(prospect, false)
    const details = getScoreDetails(prospect, false)

    expect(details.penalite_rejete).toBe(-50)
    // Brut = 110 - 50 = 60 (le clamp à 100 s'applique avant la pénalité au niveau
    // de la somme : 110 - 50 = 60, pas 100 - 50 = 50, car le clamp est appliqué
    // une seule fois sur la somme finale)
    expect(score).toBe(60)
  })
})

// ── CAS 3 : Déjà contacté ───────────────────────────────────────────────────

describe('calculerScore — déjà contacté', () => {
  it('applique la pénalité -20 quand dejaContacte = true', () => {
    const prospect = makeProspect()
    const scoreNoContact = calculerScore(prospect, false)
    const scoreDejaContacte = calculerScore(prospect, true)
    const details = getScoreDetails(prospect, true)

    expect(details.penalite_deja_contacte).toBe(-20)
    // Sans pénalité : brut 110 clampé à 100. Avec pénalité : brut 90 (110-20),
    // pas clampé. La différence apparente n'est donc pas -20 mais -10.
    expect(scoreNoContact).toBe(100)
    expect(scoreDejaContacte).toBe(90)
  })
})

// ── CAS 4 : Prospect faible priorité ────────────────────────────────────────

describe('calculerScore — prospect faible priorité', () => {
  it('retourne un score bas pour un prospect non prioritaire', () => {
    const prospect = makeProspect({
      obligation_beges: false,
      secteur_naf: '47.11F',
      beges_publie: true,
      beges_valide: true,
      contact_telephone: undefined,
      effectif_min: 200,
      effectif_max: 249,
      signaux: [],
    })

    const score = calculerScore(prospect, false)
    const details = getScoreDetails(prospect, false)

    expect(details.obligation_beges).toBe(0)
    expect(details.secteur_prioritaire).toBe(0)
    expect(details.beges_non_publie).toBe(0)
    expect(details.beges_expire).toBe(0)
    expect(details.contact_trouve).toBe(0)
    expect(details.taille_entreprise).toBe(0)
    expect(details.secteur_beges_mature).toBe(0)
    expect(score).toBe(0)
  })
})

// ── CAS 5 : Score plancher à 0 ──────────────────────────────────────────────

describe('calculerScore — score plancher à 0', () => {
  it('ne retourne jamais un score négatif', () => {
    const prospect = makeProspect({
      obligation_beges: false,
      secteur_naf: '47.11F',
      beges_publie: true,
      beges_valide: true,
      contact_telephone: undefined,
      effectif_min: 0,
      effectif_max: 0,
      signaux: [],
      statut: 'rejected',
    })

    const score = calculerScore(prospect, true)

    expect(score).toBe(0)
    expect(score).toBeGreaterThanOrEqual(0)
  })
})

// ── CAS 6 : Signaux d'intention — plafond à 15 ──────────────────────────────

describe('calculerScore — signaux intention', () => {
  it('plafonne les signaux à 15 points même avec plusieurs signaux lourds', () => {
    const prospect = makeProspect({
      obligation_beges: false,
      secteur_naf: '47.11F',
      beges_publie: true,
      beges_valide: true,
      contact_telephone: undefined,
      effectif_max: 0,
      signaux: [
        { type: 'job_posting', description: 'RSE', weight: 10 },
        { type: 'sustainability_report_missing', description: 'Rapport absent', weight: 10 },
        { type: 'press_release', description: 'Annonce', weight: 5 },
      ],
    })

    const details = getScoreDetails(prospect, false)
    const score = calculerScore(prospect, false)

    expect(details.signaux_intention).toBe(15)
    expect(score).toBe(15)
  })
})

// ── CAS 7 : estSecteurPrioritaire ───────────────────────────────────────────

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

// ── CAS 7bis : estSecteurBegesMature ────────────────────────────────────────

describe('estSecteurBegesMature', () => {
  it('reconnaît la santé (86.10Z, 86.21Z) comme mature', () => {
    expect(estSecteurBegesMature('86.10Z')).toBe(true)
    expect(estSecteurBegesMature('86.21Z')).toBe(true)
  })

  it('reconnaît le transport routier (49.41A, 49.41B, 52.10B) comme mature', () => {
    expect(estSecteurBegesMature('49.41A')).toBe(true)
    expect(estSecteurBegesMature('49.41B')).toBe(true)
    expect(estSecteurBegesMature('52.10B')).toBe(true)
  })

  it('reconnaît tout NAF agro (préfixe 10.) comme mature', () => {
    expect(estSecteurBegesMature('10.11Z')).toBe(true)
    expect(estSecteurBegesMature('10.71A')).toBe(true)
    expect(estSecteurBegesMature('1051A')).toBe(true)
  })

  it('retourne false hors liste / préfixes', () => {
    expect(estSecteurBegesMature('47.11F')).toBe(false)
    expect(estSecteurBegesMature('64.19Z')).toBe(false)
    expect(estSecteurBegesMature('30.30Z')).toBe(false)
    expect(estSecteurBegesMature('')).toBe(false)
  })
})

// ── CAS 8 : determinerPriorite ──────────────────────────────────────────────

describe('determinerPriorite', () => {
  it('retourne "haute" pour score >= 60', () => {
    expect(determinerPriorite(60)).toBe('haute')
    expect(determinerPriorite(90)).toBe('haute')
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

// ── CAS 9 : cohérence somme vs score ────────────────────────────────────────

describe('getScoreDetails', () => {
  it('la somme des détails clampée correspond bien au score calculerScore', () => {
    const prospect = makeProspect()
    const details = getScoreDetails(prospect, false)
    const sum =
      details.obligation_beges +
      details.secteur_prioritaire +
      details.beges_non_publie +
      details.beges_expire +
      details.signaux_intention +
      details.taille_entreprise +
      details.contact_trouve +
      details.secteur_beges_mature +
      details.bonus_infraction_legale +
      details.penalite_deja_contacte +
      details.penalite_rejete
    const scoreFromDetails = Math.max(0, Math.min(100, sum))
    const scoreFromFn = calculerScore(prospect, false)

    expect(scoreFromDetails).toBe(scoreFromFn)
  })
})

// ── CAS 10 : BEGES expiré + santé + sweet spot + tel → CHAUD ────────────────

describe('calculerScore — BEGES expiré 5 ans + santé 400 sal + téléphone trouvé', () => {
  it('produit un score élevé (>75) — prospect le plus chaud commercialement', () => {
    const prospect = makeProspect({
      secteur_naf: '86.10Z',
      obligation_beges: true,
      beges_publie: true,
      beges_valide: false,
      effectif_min: 250,
      effectif_max: 400,
      contact_telephone: '0145000000',
      signaux: [
        { type: 'job_posting', description: 'Recrutement Responsable RSE', weight: 10 },
      ],
    })

    const score = calculerScore(prospect, false)
    const details = getScoreDetails(prospect, false)

    expect(details.obligation_beges).toBe(30)
    expect(details.beges_expire).toBe(25)
    expect(details.beges_non_publie).toBe(0)
    expect(details.taille_entreprise).toBe(15)
    expect(details.contact_trouve).toBe(10)
    expect(details.secteur_beges_mature).toBe(5)
    expect(details.signaux_intention).toBe(10)
    // 30 + 0 + 0 + 25 + 10 + 15 + 10 + 5 = 95
    expect(score).toBe(95)
    expect(score).toBeGreaterThan(75)
  })
})

// ── CAS 11 : BEGES jamais publié + CAC40 → HAUTE (infraction L. 229-25) ─────

describe('calculerScore — BEGES jamais publié + CAC40 5000 sal.', () => {
  it('produit un score haut grâce au bonus infraction — obligé + BEGES absent', () => {
    const prospect = makeProspect({
      secteur_naf: '64.19Z',
      obligation_beges: true,
      beges_publie: false,
      effectif_min: 5000,
      effectif_max: 9999,
      contact_telephone: undefined,
      signaux: [],
    })

    const score = calculerScore(prospect, false)
    const details = getScoreDetails(prospect, false)

    expect(details.taille_entreprise).toBe(2)
    expect(details.beges_non_publie).toBe(15)
    expect(details.beges_expire).toBe(0)
    expect(details.secteur_beges_mature).toBe(0)
    expect(details.bonus_infraction_legale).toBe(20)
    // 30 + 0 + 15 + 0 + 0 + 2 + 0 + 0 + 20 = 67
    expect(score).toBe(67)
    expect(score).toBeGreaterThanOrEqual(60) // priorité haute garantie
  })
})

// ── CAS 12 : BEGES récent valide + PME → FAIBLE ─────────────────────────────

describe('calculerScore — BEGES récent encore valide + PME 50 sal.', () => {
  it('produit un score faible — pas de bonus BEGES, sous seuil sweet spot', () => {
    const prospect = makeProspect({
      secteur_naf: '47.11F',
      obligation_beges: false,
      beges_publie: true,
      beges_valide: true,
      effectif_min: 20,
      effectif_max: 50,
      contact_telephone: undefined,
      signaux: [],
    })

    const score = calculerScore(prospect, false)
    const details = getScoreDetails(prospect, false)

    expect(details.beges_non_publie).toBe(0)
    expect(details.beges_expire).toBe(0)
    expect(details.taille_entreprise).toBe(0)
    expect(details.obligation_beges).toBe(0)
    expect(score).toBe(0)
    expect(score).toBeLessThan(30)
  })
})

// ── CAS 13 : Cap à 100 ──────────────────────────────────────────────────────

describe('calculerScore — cap à 100 sur cumul max', () => {
  it('clampe le score brut > 100 à exactement 100', () => {
    const prospect = makeProspect({
      secteur_naf: '10.11Z',
      obligation_beges: true,
      beges_publie: true,
      beges_valide: false,
      effectif_min: 250,
      effectif_max: 500,
      contact_telephone: '0145000000',
      signaux: [
        { type: 'job_posting', description: 'RSE', weight: 10 },
        { type: 'sustainability_report_missing', description: 'Rapport', weight: 10 },
      ],
    })

    const score = calculerScore(prospect, false)
    expect(score).toBe(100)
  })
})

// ── CAS 14 : Exclusivité beges_non_publie vs beges_expire ───────────────────

describe('calculerScore — BEGES expiré vs non publié sont exclusifs', () => {
  it('BEGES non publié : beges_non_publie=15, beges_expire=0', () => {
    const p = makeProspect({ beges_publie: false })
    const details = getScoreDetails(p, false)
    expect(details.beges_non_publie).toBe(15)
    expect(details.beges_expire).toBe(0)
  })

  it('BEGES expiré : beges_non_publie=0, beges_expire=25', () => {
    const p = makeProspect({ beges_publie: true, beges_valide: false })
    const details = getScoreDetails(p, false)
    expect(details.beges_non_publie).toBe(0)
    expect(details.beges_expire).toBe(25)
  })

  it('BEGES valide : les deux à 0', () => {
    const p = makeProspect({ beges_publie: true, beges_valide: true })
    const details = getScoreDetails(p, false)
    expect(details.beges_non_publie).toBe(0)
    expect(details.beges_expire).toBe(0)
  })

  it('confirme que beges_expire (25) > beges_non_publie (15)', () => {
    const pExpire = makeProspect({
      beges_publie: true, beges_valide: false,
      secteur_naf: '47.11F', obligation_beges: false,
      effectif_max: 0, contact_telephone: undefined, signaux: [],
    })
    const pVierge = makeProspect({
      beges_publie: false,
      secteur_naf: '47.11F', obligation_beges: false,
      effectif_max: 0, contact_telephone: undefined, signaux: [],
    })
    expect(calculerScore(pExpire, false)).toBeGreaterThan(calculerScore(pVierge, false))
  })
})

// ── CAS 15 : Bonus infraction L. 229-25 — profil minimal en haut du Top ─────
// Garantie business : un prospect "obligé + BEGES absent" doit dépasser
// même un prospect très bien équipé MAIS pas en infraction (BEGES expiré).

describe('calculerScore — bonus infraction L. 229-25 garantit le top', () => {
  it('attribue +20 au profil "obligé + beges_publie=false" — infraction', () => {
    const pInfraction = makeProspect({
      // Minimaliste : pas de NAF prioritaire, pas de NAF mature, pas de tel,
      // pas de signaux, effectif sous sweet spot — UNIQUEMENT obligation + BEGES absent.
      secteur_naf: '47.11F',
      obligation_beges: true,
      beges_publie: false,
      effectif_min: 100,
      effectif_max: 200, // < 250 → 0 pt taille
      contact_telephone: undefined,
      signaux: [],
    })

    const details = getScoreDetails(pInfraction, false)
    const score = calculerScore(pInfraction, false)

    expect(details.obligation_beges).toBe(30)
    expect(details.beges_non_publie).toBe(15)
    expect(details.bonus_infraction_legale).toBe(20)
    // 30 + 0 + 15 + 0 + 0 + 0 + 0 + 0 + 20 = 65 — exactement le seuil haute (60)
    expect(score).toBe(65)
    expect(score).toBeGreaterThanOrEqual(60) // priorité haute garantie sans autre critère
  })

  it('domine un prospect "tout bon SAUF BEGES expiré" (pas en infraction)', () => {
    // Profil "infraction" minimal — voir test précédent
    const pInfractionMinimal = makeProspect({
      secteur_naf: '47.11F',
      obligation_beges: true,
      beges_publie: false,
      effectif_min: 100,
      effectif_max: 200,
      contact_telephone: undefined,
      signaux: [],
    })

    // Profil "tout bon" mais BEGES expiré (publié + obsolète, pas absent)
    // → pas en infraction L. 229-25 → bonus_infraction_legale = 0
    const pToutBonSaufExpire = makeProspect({
      secteur_naf: '47.11F', // non prio, non mature
      obligation_beges: false, // PAS obligé
      beges_publie: true,
      beges_valide: false, // expiré → +25
      effectif_min: 300,
      effectif_max: 500, // sweet spot → +15
      contact_telephone: '0145000000', // → +10
      signaux: [{ type: 'job_posting', description: 'RSE', weight: 10 }], // → +10
    })

    const scoreInfraction = calculerScore(pInfractionMinimal, false)
    const scoreToutBon = calculerScore(pToutBonSaufExpire, false)

    // Infraction = 65 ; tout bon sauf expiré = 0 + 0 + 0 + 25 + 10 + 15 + 10 + 0 = 60
    expect(scoreInfraction).toBe(65)
    expect(scoreToutBon).toBe(60)
    expect(scoreInfraction).toBeGreaterThanOrEqual(scoreToutBon)
  })
})

// ── CAS 16 : BEGES expiré != infraction (le bonus ne s'applique PAS) ────────

describe('calculerScore — bonus infraction NE s\'applique PAS si BEGES expiré', () => {
  it('obligation=true && beges_publie=true && beges_valide=false → bonus_infraction_legale=0', () => {
    // Un BEGES expiré n'est PAS une infraction L. 229-25 — un bilan existe,
    // l'obligation initiale est remplie. Seul le renouvellement quadriennal
    // est dépassé. Cas géré par POINTS_BEGES_EXPIRE = 25.
    const prospect = makeProspect({
      obligation_beges: true,
      beges_publie: true,
      beges_valide: false,
    })

    const details = getScoreDetails(prospect, false)

    expect(details.obligation_beges).toBe(30)
    expect(details.beges_non_publie).toBe(0)
    expect(details.beges_expire).toBe(25)
    expect(details.bonus_infraction_legale).toBe(0) // pas d'infraction
  })
})

// ── CAS 17 : PME pas obligée (le bonus ne s'applique PAS) ───────────────────

describe('calculerScore — bonus infraction NE s\'applique PAS si non obligé', () => {
  it('obligation=false && beges_publie=false → bonus_infraction_legale=0', () => {
    // Une PME (< 500 sal., hors Région ≥ 250) sans BEGES n'est PAS en infraction —
    // elle n'a pas l'obligation. Le bonus ne doit pas s'appliquer.
    const prospect = makeProspect({
      obligation_beges: false,
      beges_publie: false,
    })

    const details = getScoreDetails(prospect, false)

    expect(details.obligation_beges).toBe(0)
    expect(details.beges_non_publie).toBe(15) // points BEGES absent restent
    expect(details.bonus_infraction_legale).toBe(0) // mais pas le bonus infraction
  })
})
