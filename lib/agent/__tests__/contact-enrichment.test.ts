// ============================================================
// TESTS UNITAIRES — contact-enrichment.ts
// Focus : cleanFirstName (dédup prénoms multiples / pollution casse)
// Vitest — pattern AAA (Arrange / Act / Assert)
// ============================================================

import { describe, expect, it } from 'vitest'
import { cleanFirstName } from '../contact-enrichment'

// ------------------------------------------------------------
// cleanFirstName — cas du feedback user (verbatim)
// ------------------------------------------------------------

describe('cleanFirstName', () => {
  it('garde uniquement le 1er prénom quand séparés par un espace', () => {
    expect(cleanFirstName('Jean Marc')).toBe('Jean')
  })

  it('garde uniquement le 1er prénom quand séparés par un tiret', () => {
    expect(cleanFirstName('Jean-Marc')).toBe('Jean')
  })

  it('trim les espaces parasites et capitalise', () => {
    expect(cleanFirstName('  jean  ')).toBe('Jean')
  })

  it('retourne undefined si le 1er token est trop court (< 2 chars)', () => {
    expect(cleanFirstName('J')).toBeUndefined()
  })

  it('normalise la casse : MAJUSCULES en input → Capitalize en sortie', () => {
    expect(cleanFirstName('MARIE SOPHIE')).toBe('Marie')
  })

  it('retourne undefined si input undefined', () => {
    expect(cleanFirstName(undefined)).toBeUndefined()
  })

  it('retourne undefined si input vide', () => {
    expect(cleanFirstName('')).toBeUndefined()
  })

  it('retourne undefined si input ne contient que des espaces', () => {
    expect(cleanFirstName('   ')).toBeUndefined()
  })

  it('gère combinaison espace + tiret ("Jean-Marc Pierre" → "Jean")', () => {
    expect(cleanFirstName('Jean-Marc Pierre')).toBe('Jean')
  })

  it('garde une saisie déjà propre inchangée (cas idempotent)', () => {
    expect(cleanFirstName('Sophie')).toBe('Sophie')
  })

  it('normalise une saisie mixed-case ("jEAN" → "Jean")', () => {
    expect(cleanFirstName('jEAN')).toBe('Jean')
  })
})
