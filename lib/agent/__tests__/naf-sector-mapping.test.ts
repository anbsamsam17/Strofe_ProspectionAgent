// ============================================================
// TESTS UNITAIRES — naf-sector-mapping.ts
// Fix bug catégorisation NAF (2026-05-14)
//
// Cible : `normalizeNafCode`, `resolveNafFromInput`, `matchesAnyNaf`,
//          `getSupportedLabels`.
// Stratégie : tests purs, aucun mock — fonctions sans I/O.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  getSupportedLabels,
  matchesAnyNaf,
  normalizeNafCode,
  resolveNafFromInput,
} from '../naf-sector-mapping'

// ============================================================
// normalizeNafCode
// ============================================================

describe('normalizeNafCode', () => {
  it('accepte un code canonique XX.XXY tel quel', () => {
    expect(normalizeNafCode('01.21Z')).toBe('01.21Z')
    expect(normalizeNafCode('49.41A')).toBe('49.41A')
  })

  it('insère un point sur format sans point (XXXXY)', () => {
    expect(normalizeNafCode('0121Z')).toBe('01.21Z')
    expect(normalizeNafCode('4941A')).toBe('49.41A')
    expect(normalizeNafCode('1011Z')).toBe('10.11Z')
  })

  it('uppercase la lettre finale (idempotent)', () => {
    expect(normalizeNafCode('01.21z')).toBe('01.21Z')
    expect(normalizeNafCode('0121z')).toBe('01.21Z')
  })

  it('trim les espaces extérieurs', () => {
    expect(normalizeNafCode('  01.21Z  ')).toBe('01.21Z')
    expect(normalizeNafCode('\t49.41A\n')).toBe('49.41A')
  })

  it('retourne null pour les inputs vides ou null', () => {
    expect(normalizeNafCode(null)).toBeNull()
    expect(normalizeNafCode(undefined)).toBeNull()
    expect(normalizeNafCode('')).toBeNull()
    expect(normalizeNafCode('   ')).toBeNull()
  })

  it('retourne null pour les libellés humains', () => {
    expect(normalizeNafCode('Industrie manufacturière')).toBeNull()
    expect(normalizeNafCode('Transport et logistique')).toBeNull()
    expect(normalizeNafCode('Viticulture')).toBeNull()
  })

  it('retourne null pour les codes incomplets', () => {
    expect(normalizeNafCode('01.21')).toBeNull()    // pas de lettre
    expect(normalizeNafCode('0121')).toBeNull()     // pas de lettre
    expect(normalizeNafCode('01.21ZA')).toBeNull()  // trop long
    expect(normalizeNafCode('1.21Z')).toBeNull()    // pas 2 chiffres avant point
  })

  it('récupère après suppression des caractères parasites', () => {
    // Cas réel : utilisateur colle "01.21 Z" ou "01.21-Z" → on récupère.
    expect(normalizeNafCode('0121-Z')).toBe('01.21Z')
    expect(normalizeNafCode('01 21Z')).toBe('01.21Z')
  })
})

// ============================================================
// resolveNafFromInput
// ============================================================

describe('resolveNafFromInput', () => {
  it('retourne un code NAF canonique inchangé', () => {
    const out = resolveNafFromInput(['01.21Z'])
    expect(out.codes).toEqual(['01.21Z'])
    expect(out.unknownLabels).toEqual([])
    expect(out.unmappedLabels).toEqual([])
  })

  it('normalise un code sans point', () => {
    const out = resolveNafFromInput(['0121Z'])
    expect(out.codes).toEqual(['01.21Z'])
  })

  it('expanse un libellé UI vers ses codes NAF', () => {
    const out = resolveNafFromInput(['Transport et logistique'])
    expect(out.codes).toEqual(
      expect.arrayContaining(['49.41A', '49.41B', '52.10B', '52.21Z', '52.29A']),
    )
    expect(out.unknownLabels).toEqual([])
    expect(out.unmappedLabels).toEqual([])
  })

  it('insensible à la casse et aux accents pour les libellés', () => {
    const a = resolveNafFromInput(['Industrie manufacturière'])
    const b = resolveNafFromInput(['INDUSTRIE MANUFACTURIERE'])
    const c = resolveNafFromInput(['industrie manufacturiere'])
    expect(a.codes).toEqual(b.codes)
    expect(b.codes).toEqual(c.codes)
    expect(a.codes.length).toBeGreaterThan(0)
  })

  it('mélange codes + libellés sans erreur', () => {
    const out = resolveNafFromInput(['01.21Z', 'Transport et logistique', '0121Z'])
    expect(out.codes).toContain('01.21Z')
    expect(out.codes).toContain('49.41A')
    // 01.21Z apparaît une seule fois (dédup après normalisation)
    expect(out.codes.filter((c) => c === '01.21Z')).toHaveLength(1)
  })

  it('reporte les libellés inconnus dans unknownLabels', () => {
    const out = resolveNafFromInput(['Atlantide', 'Industrie martienne'])
    expect(out.codes).toEqual([])
    expect(out.unknownLabels).toContain('Atlantide')
    expect(out.unknownLabels).toContain('Industrie martienne')
  })

  it('reporte les libellés mappés sans NAF dans unmappedLabels', () => {
    // "Technologies" est dans le mapping mais sans codes NAF (pas de NAF
    // pertinent bilan carbone) → unmappedLabels, pas unknownLabels.
    const out = resolveNafFromInput(['Technologies'])
    expect(out.codes).toEqual([])
    expect(out.unmappedLabels).toContain('Technologies')
    expect(out.unknownLabels).toEqual([])
  })

  it('déduplique les codes (ordre de première occurrence préservé)', () => {
    const out = resolveNafFromInput(['49.41A', '4941A', '49.41A', '4941a'])
    expect(out.codes).toEqual(['49.41A'])
  })

  it('ignore les entrées vides ou non-chaînes', () => {
    const out = resolveNafFromInput(['', '   ', '01.21Z'])
    expect(out.codes).toEqual(['01.21Z'])
    expect(out.unknownLabels).toEqual([])
  })

  it('retourne tout vide pour un input vide', () => {
    const out = resolveNafFromInput([])
    expect(out.codes).toEqual([])
    expect(out.unknownLabels).toEqual([])
    expect(out.unmappedLabels).toEqual([])
  })
})

// ============================================================
// matchesAnyNaf
// ============================================================

describe('matchesAnyNaf', () => {
  it('match exact avec format canonique', () => {
    expect(matchesAnyNaf('01.21Z', ['01.21Z'])).toBe(true)
    expect(matchesAnyNaf('01.21Z', ['49.41A', '01.21Z'])).toBe(true)
  })

  it('tolère le format sans point côté NAF d\'entrée', () => {
    expect(matchesAnyNaf('0121Z', ['01.21Z'])).toBe(true)
    expect(matchesAnyNaf('4941A', ['49.41A'])).toBe(true)
  })

  it('tolère le format sans point côté allowed', () => {
    expect(matchesAnyNaf('01.21Z', ['0121Z'])).toBe(true)
  })

  it('insensible à la casse', () => {
    expect(matchesAnyNaf('01.21z', ['01.21Z'])).toBe(true)
    expect(matchesAnyNaf('0121z', ['01.21z'])).toBe(true)
  })

  it('retourne false sur miss', () => {
    expect(matchesAnyNaf('01.21Z', ['49.41A'])).toBe(false)
    expect(matchesAnyNaf('46.17B', ['01.21Z', '49.41A'])).toBe(false)
  })

  it('retourne true sur allowedNafs vide (pas de filtre)', () => {
    // Comportement legacy : si l'utilisateur n'a pas configuré de NAF, on
    // ne filtre rien post-fetch (Sirene a déjà fait son boulot côté query).
    expect(matchesAnyNaf('01.21Z', [])).toBe(true)
    expect(matchesAnyNaf(null, [])).toBe(true)
    expect(matchesAnyNaf(undefined, [])).toBe(true)
  })

  it('retourne false sur NAF d\'entrée invalide quand allowedNafs non vide', () => {
    expect(matchesAnyNaf(null, ['01.21Z'])).toBe(false)
    expect(matchesAnyNaf(undefined, ['01.21Z'])).toBe(false)
    expect(matchesAnyNaf('', ['01.21Z'])).toBe(false)
    expect(matchesAnyNaf('not-a-naf', ['01.21Z'])).toBe(false)
  })

  it('ignore silencieusement les allowed invalides (libellés résiduels)', () => {
    expect(matchesAnyNaf('01.21Z', ['Industrie manufacturière'])).toBe(false)
    // Si tous les allowed sont invalides ET un valide → match si valide
    expect(matchesAnyNaf('01.21Z', ['Industrie manufacturière', '01.21Z'])).toBe(true)
  })
})

// ============================================================
// getSupportedLabels
// ============================================================

describe('getSupportedLabels', () => {
  it('expose au moins les labels UI du formulaire Settings', () => {
    // Doit couvrir les libellés affichés dans `app/(dashboard)/settings/page.tsx`
    // SECTEURS_DISPONIBLES — alignement strict pour ne pas régresser silencieusement.
    const labels = getSupportedLabels()
    expect(labels).toContain('industrie manufacturiere')
    expect(labels).toContain('transport et logistique')
    expect(labels).toContain('construction et btp')
    expect(labels).toContain('agriculture')
    expect(labels).toContain('hotellerie et restauration')
  })

  it('expose les libellés mappés sans codes (pour aider le diag UI)', () => {
    const labels = getSupportedLabels()
    expect(labels).toContain('technologies')
    expect(labels).toContain('finance et assurance')
  })
})
