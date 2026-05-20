// ============================================================
// TESTS — lib/agent/hot-lead.ts (GLN-081)
//
// Vérifie l'équivalence stricte avec la formule DB GENERATED column
// (migration 024). Source de vérité partagée DB + TS.
// ============================================================

import { describe, expect, it } from 'vitest'
import { isHotLead } from '../hot-lead'

const BASE_HOT = {
  obligation_beges: true,
  beges_publie: false, // signal "BEGES manquant"
  contact_email: 'contact@example.fr',
  effectif_min: 500,
} as const

describe('isHotLead', () => {
  it('retourne true pour le cas nominal "obligation + BEGES absent + email + 500 sal."', () => {
    expect(isHotLead({ ...BASE_HOT })).toBe(true)
  })

  it('retourne true si BEGES publié mais expiré (beges_valide = false)', () => {
    expect(
      isHotLead({
        ...BASE_HOT,
        beges_publie: true,
        beges_valide: false,
      }),
    ).toBe(true)
  })

  it('retourne true si BEGES publié, valide, mais non conforme Décret 2022', () => {
    expect(
      isHotLead({
        ...BASE_HOT,
        beges_publie: true,
        beges_valide: true,
        beges_decret_2022_compliant: false,
      }),
    ).toBe(true)
  })

  it('retourne false si obligation_beges = false', () => {
    expect(isHotLead({ ...BASE_HOT, obligation_beges: false })).toBe(false)
  })

  it('retourne false si BEGES publié, valide, ET conforme Décret 2022 (cas "propre")', () => {
    expect(
      isHotLead({
        ...BASE_HOT,
        beges_publie: true,
        beges_valide: true,
        beges_decret_2022_compliant: true,
      }),
    ).toBe(false)
  })

  it('retourne false si pas d\'email de contact', () => {
    expect(isHotLead({ ...BASE_HOT, contact_email: null })).toBe(false)
    expect(isHotLead({ ...BASE_HOT, contact_email: '' })).toBe(false)
  })

  it('retourne false si effectif_min < 250', () => {
    expect(isHotLead({ ...BASE_HOT, effectif_min: 200 })).toBe(false)
  })

  it('retourne true à la borne exacte effectif_min = 250', () => {
    expect(isHotLead({ ...BASE_HOT, effectif_min: 250 })).toBe(true)
  })

  it('NULL beges_decret_2022_compliant ne suffit pas seul à exclure (signal "BEGES manquant" toujours vu)', () => {
    expect(
      isHotLead({
        ...BASE_HOT,
        beges_publie: false,
        beges_decret_2022_compliant: null,
      }),
    ).toBe(true)
  })

  it('NULL beges_decret_2022_compliant + BEGES publié valide = false (pas de signal défaillant)', () => {
    expect(
      isHotLead({
        ...BASE_HOT,
        beges_publie: true,
        beges_valide: true,
        beges_decret_2022_compliant: null,
      }),
    ).toBe(false)
  })

  it('retourne false si effectif_min absent (undefined)', () => {
    const { effectif_min: _, ...rest } = BASE_HOT
    void _
    expect(isHotLead(rest)).toBe(false)
  })
})
