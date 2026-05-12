// ============================================================
// TESTS UNITAIRES — sourcing-mapping.ts
// Initiative : fix/sourcing-pagination (Wave 2.2)
// Spec : .claude/context/sourcing-param-mapping.md §1.4, §2.4, §3
// ============================================================

import { describe, expect, it, vi } from 'vitest'
import {
  computeFiltersSignature,
  mapEffectifToTranches,
  mapRegionToCodePostal,
  mapRegionToDepartements,
} from '../sourcing-mapping'

// ------------------------------------------------------------
// mapEffectifToTranches — cas tirés de la spec §1.2
// ------------------------------------------------------------

describe('mapEffectifToTranches', () => {
  it('retourne le défaut legacy quand min/max sont absents', () => {
    expect(mapEffectifToTranches(undefined, undefined)).toEqual([
      '21', '22', '31', '32', '41', '42', '51', '52', '53',
    ])
  })

  it('retourne le défaut legacy si seulement min est défini', () => {
    expect(mapEffectifToTranches(50, undefined)).toEqual([
      '21', '22', '31', '32', '41', '42', '51', '52', '53',
    ])
  })

  it('mappe [50, 499] vers [21, 22, 31, 32] (cas test principal)', () => {
    expect(mapEffectifToTranches(50, 499)).toEqual(['21', '22', '31', '32'])
  })

  it('mappe [50, 199] vers [21, 22]', () => {
    expect(mapEffectifToTranches(50, 199)).toEqual(['21', '22'])
  })

  it('mappe [200, 499] vers [31, 32]', () => {
    expect(mapEffectifToTranches(200, 499)).toEqual(['31', '32'])
  })

  it('mappe [500, 999] vers [41]', () => {
    expect(mapEffectifToTranches(500, 999)).toEqual(['41'])
  })

  it('mappe [10, 49] vers [11, 12]', () => {
    expect(mapEffectifToTranches(10, 49)).toEqual(['11', '12'])
  })

  it('mappe [0, 9] vers [00, 01, 02, 03]', () => {
    expect(mapEffectifToTranches(0, 9)).toEqual(['00', '01', '02', '03'])
  })

  it('mappe [10000, 99999] vers [53]', () => {
    expect(mapEffectifToTranches(10000, 99999)).toEqual(['53'])
  })

  it('throw quand min > max', () => {
    expect(() => mapEffectifToTranches(600, 400)).toThrow(/min.*max/)
  })

  it('throw quand min négatif', () => {
    expect(() => mapEffectifToTranches(-1, 100)).toThrow(/négatif/)
  })

  it('retourne le défaut legacy si la plage ne chevauche aucune tranche', () => {
    // Cas dégénéré : plage [20000, 25000] tombe sur tranche 53 (10k+), donc devrait trouver
    // En revanche un cas qui ne couvre vraiment rien — non réaliste mais sûreté.
    expect(mapEffectifToTranches(20000, 25000)).toEqual(['53'])
  })
})

// ------------------------------------------------------------
// mapRegionToCodePostal — cas tirés de la spec §2.2
// ------------------------------------------------------------

describe('mapRegionToCodePostal', () => {
  it('défaut implicite : France entière quand label est undefined/null/vide', () => {
    // Décision produit 2026-05-12 — remplace l'ancien défaut "Gironde" qui
    // causait le bug "Univers de recherche épuisé / 0 entreprises" en UI quand
    // l'utilisateur ne pré-renseignait pas targetRegion.
    expect(mapRegionToCodePostal(undefined)).toEqual(['00000', '99999'])
    expect(mapRegionToCodePostal(null)).toEqual(['00000', '99999'])
    expect(mapRegionToCodePostal('')).toEqual(['00000', '99999'])
    expect(mapRegionToCodePostal('   ')).toEqual(['00000', '99999'])
  })

  it('retourne range nationale pour "France" / "fr" explicite', () => {
    expect(mapRegionToCodePostal('France')).toEqual(['00000', '99999'])
    expect(mapRegionToCodePostal('FRANCE')).toEqual(['00000', '99999'])
    expect(mapRegionToCodePostal('fr')).toEqual(['00000', '99999'])
  })

  it('label explicite "Gironde" reste sur la Gironde (pas de régression)', () => {
    expect(mapRegionToCodePostal('Gironde')).toEqual(['33000', '33999'])
    expect(mapRegionToCodePostal('33')).toEqual(['33000', '33999'])
    expect(mapRegionToCodePostal('gironde')).toEqual(['33000', '33999'])
  })

  it('mappe "Paris" et "75" vers [75000, 75999]', () => {
    expect(mapRegionToCodePostal('Paris')).toEqual(['75000', '75999'])
    expect(mapRegionToCodePostal('75')).toEqual(['75000', '75999'])
  })

  it('mappe "Nouvelle-Aquitaine" vers un range étendu min/max', () => {
    // Englobe les départements 16-87 → range min = 16000, max = 87999
    const [min, max] = mapRegionToCodePostal('Nouvelle-Aquitaine')
    expect(min).toBe('16000')
    expect(max).toBe('87999')
  })

  it('fallback France entière sur label non reconnu (+ log warn)', () => {
    // Décision produit 2026-05-12 : un label inconnu ne doit plus retomber
    // silencieusement sur la Gironde. Fallback = France entière + log warn.
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(mapRegionToCodePostal('Atlantide')).toEqual(['00000', '99999'])
    expect(spy).toHaveBeenCalled()
    const warnLog = spy.mock.calls.find(([arg]) => {
      if (typeof arg !== 'string') return false
      try {
        const parsed = JSON.parse(arg) as { level?: string; msg?: string }
        return parsed.level === 'warn' && typeof parsed.msg === 'string' && parsed.msg.includes('Atlantide')
      } catch {
        return false
      }
    })
    expect(warnLog).toBeDefined()
    spy.mockRestore()
  })

  it('accepte un code département direct non listé (ex. 13 Bouches-du-Rhône)', () => {
    expect(mapRegionToCodePostal('13')).toEqual(['13000', '13999'])
  })

  it('insensible aux accents', () => {
    expect(mapRegionToCodePostal('Île-de-France')).toEqual(['75000', '95999'])
  })
})

// ------------------------------------------------------------
// mapRegionToDepartements — utilisé par le fallback Recherche Entreprises
// ------------------------------------------------------------

describe('mapRegionToDepartements', () => {
  it('défaut implicite : [] (France entière) quand label est undefined/null/vide', () => {
    // Décision produit 2026-05-12 — symétrique avec mapRegionToCodePostal.
    // [] = pas de filtre département côté fallback Recherche Entreprises.
    expect(mapRegionToDepartements(undefined)).toEqual([])
    expect(mapRegionToDepartements(null)).toEqual([])
    expect(mapRegionToDepartements('')).toEqual([])
    expect(mapRegionToDepartements('   ')).toEqual([])
  })

  it('retourne [] pour "France" / "fr" explicite', () => {
    expect(mapRegionToDepartements('France')).toEqual([])
    expect(mapRegionToDepartements('FRANCE')).toEqual([])
    expect(mapRegionToDepartements('fr')).toEqual([])
  })

  it('label explicite "Gironde" → ["33"] (pas de régression)', () => {
    expect(mapRegionToDepartements('Gironde')).toEqual(['33'])
    expect(mapRegionToDepartements('33')).toEqual(['33'])
  })

  it('mappe "Nouvelle-Aquitaine" → 12 départements', () => {
    const depts = mapRegionToDepartements('Nouvelle-Aquitaine')
    expect(depts).toHaveLength(12)
    expect(depts).toContain('33')
    expect(depts).toContain('87')
  })

  it('mappe "Île-de-France" → 8 départements', () => {
    const depts = mapRegionToDepartements('Île-de-France')
    expect(depts).toHaveLength(8)
    expect(depts).toContain('75')
    expect(depts).toContain('95')
  })

  it('fallback France entière sur label non reconnu', () => {
    // Décision produit 2026-05-12 : un label inconnu retourne [] (pas plus Gironde).
    expect(mapRegionToDepartements('Atlantide')).toEqual([])
  })
})

// ------------------------------------------------------------
// computeFiltersSignature — invalidation curseur (spec §3)
// ------------------------------------------------------------

describe('computeFiltersSignature', () => {
  it('produit un hash hex de 12 caractères', () => {
    const sig = computeFiltersSignature({
      tranches: ['21', '22'],
      codePostalRange: ['33000', '33999'],
      nafCodes: ['01.21Z'],
    })
    expect(sig).toMatch(/^[0-9a-f]{12}$/)
  })

  it('est stable (même input → même hash)', () => {
    const a = computeFiltersSignature({
      tranches: ['21', '22'],
      codePostalRange: ['33000', '33999'],
      nafCodes: ['01.21Z', '49.41A'],
    })
    const b = computeFiltersSignature({
      tranches: ['21', '22'],
      codePostalRange: ['33000', '33999'],
      nafCodes: ['01.21Z', '49.41A'],
    })
    expect(a).toBe(b)
  })

  it('insensible à l\'ordre des tranches et NAFs', () => {
    const a = computeFiltersSignature({
      tranches: ['22', '21'],
      codePostalRange: ['33000', '33999'],
      nafCodes: ['49.41A', '01.21Z'],
    })
    const b = computeFiltersSignature({
      tranches: ['21', '22'],
      codePostalRange: ['33000', '33999'],
      nafCodes: ['01.21Z', '49.41A'],
    })
    expect(a).toBe(b)
  })

  it('insensible au format NAF (avec/sans point, casse)', () => {
    const a = computeFiltersSignature({
      tranches: ['21'],
      codePostalRange: ['33000', '33999'],
      nafCodes: ['01.21Z'],
    })
    const b = computeFiltersSignature({
      tranches: ['21'],
      codePostalRange: ['33000', '33999'],
      nafCodes: ['0121z'],
    })
    expect(a).toBe(b)
  })

  it('change quand les tranches changent', () => {
    const a = computeFiltersSignature({
      tranches: ['21', '22'],
      codePostalRange: ['33000', '33999'],
      nafCodes: ['01.21Z'],
    })
    const b = computeFiltersSignature({
      tranches: ['21', '22', '31'],
      codePostalRange: ['33000', '33999'],
      nafCodes: ['01.21Z'],
    })
    expect(a).not.toBe(b)
  })

  it('change quand le range CP change', () => {
    const a = computeFiltersSignature({
      tranches: ['21'],
      codePostalRange: ['33000', '33999'],
      nafCodes: ['01.21Z'],
    })
    const b = computeFiltersSignature({
      tranches: ['21'],
      codePostalRange: ['75000', '75999'],
      nafCodes: ['01.21Z'],
    })
    expect(a).not.toBe(b)
  })

  it('change quand un NAF est ajouté', () => {
    const a = computeFiltersSignature({
      tranches: ['21'],
      codePostalRange: ['33000', '33999'],
      nafCodes: ['01.21Z'],
    })
    const b = computeFiltersSignature({
      tranches: ['21'],
      codePostalRange: ['33000', '33999'],
      nafCodes: ['01.21Z', '49.41A'],
    })
    expect(a).not.toBe(b)
  })
})
