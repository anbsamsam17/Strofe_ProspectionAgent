// ============================================================
// Tests unitaires — helpers prospect-card
// Focus : displayFirstName (nettoyage prénom multi-mots)
// ============================================================

import { describe, expect, it } from 'vitest'
import { displayFirstName } from './prospect-card'

describe('displayFirstName', () => {
  it('retourne une chaîne vide pour undefined', () => {
    expect(displayFirstName(undefined)).toBe('')
  })

  it('retourne une chaîne vide pour une chaîne vide', () => {
    expect(displayFirstName('')).toBe('')
  })

  it("retourne le seul prénom quand il n'y en a qu'un", () => {
    expect(displayFirstName('Jean')).toBe('Jean')
  })

  it('split "Jean Marc" et retourne "Jean"', () => {
    expect(displayFirstName('Jean Marc')).toBe('Jean')
  })

  it('split "Jean-Marc" sur le tiret et retourne "Jean"', () => {
    expect(displayFirstName('Jean-Marc')).toBe('Jean')
  })

  it('split "Jean Marc Dupont" (3 mots) et retourne "Jean"', () => {
    expect(displayFirstName('Jean Marc Dupont')).toBe('Jean')
  })

  it('trim les espaces autour : "  Marie  Claire  " → "Marie"', () => {
    expect(displayFirstName('  Marie  Claire  ')).toBe('Marie')
  })

  it('gère les espaces multiples sans erreur', () => {
    expect(displayFirstName('Jean    Marc')).toBe('Jean')
  })

  it('gère prénom composé avec tiret + nom complémentaire', () => {
    // "Marie-Claire Dupont" → premier segment = "Marie"
    expect(displayFirstName('Marie-Claire Dupont')).toBe('Marie')
  })
})
