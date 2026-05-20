// ============================================================
// TESTS — detectPersona
// ============================================================

import { describe, it, expect } from 'vitest'
import { detectPersona } from './detect-persona'

describe('detectPersona', () => {
  it('retourne "dg" par défaut quand poste est null/undefined/vide', () => {
    expect(detectPersona(null)).toBe('dg')
    expect(detectPersona(undefined)).toBe('dg')
    expect(detectPersona('')).toBe('dg')
    expect(detectPersona('   ')).toBe('dg')
  })

  it('détecte RSE en priorité (avant DAF) — un "Directeur RSE" matcherait sinon directeur', () => {
    expect(detectPersona('Directeur RSE')).toBe('rse')
    expect(detectPersona('Responsable Développement Durable')).toBe('rse')
    expect(detectPersona('Sustainability Manager')).toBe('rse')
    expect(detectPersona('Chargé climat carbone')).toBe('rse')
    expect(detectPersona('Responsable QHSE')).toBe('rse')
  })

  it('détecte DAF sur libellés financiers', () => {
    expect(detectPersona('DAF')).toBe('daf')
    expect(detectPersona('Directeur Financier')).toBe('daf')
    expect(detectPersona('CFO')).toBe('daf')
    expect(detectPersona('Responsable comptabilité')).toBe('daf')
    expect(detectPersona('Contrôleur de gestion')).toBe('daf')
  })

  it('détecte DRH sur libellés RH', () => {
    expect(detectPersona('DRH')).toBe('drh')
    expect(detectPersona('Directrice Ressources Humaines')).toBe('drh')
    expect(detectPersona('HRBP')).toBe('drh')
    expect(detectPersona('People Manager')).toBe('drh')
  })

  it('détecte DG sur libellés direction générale', () => {
    expect(detectPersona('DG')).toBe('dg')
    expect(detectPersona('Directeur Général')).toBe('dg')
    expect(detectPersona('Président')).toBe('dg')
    expect(detectPersona('PDG')).toBe('dg')
    expect(detectPersona('CEO')).toBe('dg')
    expect(detectPersona('Fondateur')).toBe('dg')
    expect(detectPersona('Gérant')).toBe('dg')
  })

  it('insensible à la casse', () => {
    expect(detectPersona('CEO')).toBe('dg')
    expect(detectPersona('ceo')).toBe('dg')
    expect(detectPersona('Ceo')).toBe('dg')
  })

  it('fallback "dg" sur poste inconnu', () => {
    expect(detectPersona('Stagiaire marketing')).toBe('dg')
    expect(detectPersona('Développeur')).toBe('dg')
  })
})
