// ============================================================
// TESTS UNITAIRES — email-is-pro.ts
// Fonctions pures — pas de mock externe nécessaire.
// Vitest — pattern AAA (Arrange / Act / Assert).
// ============================================================

import { describe, expect, it } from 'vitest'
import { extractDomain, FREE_EMAIL_DOMAINS, isProfessionalEmail } from '../email-is-pro'

// ─────────────────────────────────────────────────────────────────────────────
// isProfessionalEmail
// ─────────────────────────────────────────────────────────────────────────────

describe('isProfessionalEmail', () => {
  it('retourne true pour un domaine pro classique (acme.fr)', () => {
    expect(isProfessionalEmail('jean@acme.fr')).toBe(true)
  })

  it('retourne false pour gmail.com (webmail grand public)', () => {
    expect(isProfessionalEmail('jean@gmail.com')).toBe(false)
  })

  it('retourne false pour HOTMAIL.FR — case insensitive', () => {
    expect(isProfessionalEmail('jean@HOTMAIL.FR')).toBe(false)
  })

  it('retourne false pour un email vide', () => {
    expect(isProfessionalEmail('')).toBe(false)
  })

  it('retourne false pour null', () => {
    expect(isProfessionalEmail(null)).toBe(false)
  })

  it('retourne false pour undefined', () => {
    expect(isProfessionalEmail(undefined)).toBe(false)
  })

  it('retourne false pour une chaîne sans @', () => {
    expect(isProfessionalEmail('pas-un-email')).toBe(false)
  })

  it('retourne false pour un domaine disposable (mailinator.com)', () => {
    expect(isProfessionalEmail('throwaway@mailinator.com')).toBe(false)
  })

  it('retourne true pour un domaine pro avec sous-domaine (jean@dept.acme.fr)', () => {
    // Sous-domaine pas dans la free-list → considéré pro.
    expect(isProfessionalEmail('jean@dept.acme.fr')).toBe(true)
  })

  it('retourne false si le domaine est exactement laposte.net', () => {
    expect(isProfessionalEmail('jean.dupont@laposte.net')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// extractDomain
// ─────────────────────────────────────────────────────────────────────────────

describe('extractDomain', () => {
  it('extrait acme.fr depuis jean@Acme.fr (lowercase)', () => {
    expect(extractDomain('jean@Acme.fr')).toBe('acme.fr')
  })

  it('extrait acme.fr depuis JEAN@ACME.FR (full upper)', () => {
    expect(extractDomain('JEAN@ACME.FR')).toBe('acme.fr')
  })

  it('retourne null pour une chaîne sans @', () => {
    expect(extractDomain('pas-un-email')).toBeNull()
  })

  it('retourne null pour null/undefined', () => {
    expect(extractDomain(null)).toBeNull()
    expect(extractDomain(undefined)).toBeNull()
  })

  it('retourne null pour une chaîne vide ou que des espaces', () => {
    expect(extractDomain('')).toBeNull()
    expect(extractDomain('   ')).toBeNull()
  })

  it('retourne null si la partie locale est vide (@no-local.fr)', () => {
    expect(extractDomain('@no-local.fr')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// FREE_EMAIL_DOMAINS — contrat
// ─────────────────────────────────────────────────────────────────────────────

describe('FREE_EMAIL_DOMAINS', () => {
  it('contient les principaux webmails français', () => {
    expect(FREE_EMAIL_DOMAINS.has('gmail.com')).toBe(true)
    expect(FREE_EMAIL_DOMAINS.has('orange.fr')).toBe(true)
    expect(FREE_EMAIL_DOMAINS.has('free.fr')).toBe(true)
    expect(FREE_EMAIL_DOMAINS.has('laposte.net')).toBe(true)
  })

  it('contient des domaines disposable', () => {
    expect(FREE_EMAIL_DOMAINS.has('mailinator.com')).toBe(true)
    expect(FREE_EMAIL_DOMAINS.has('10minutemail.com')).toBe(true)
  })

  it('exclut des domaines pro évidents', () => {
    expect(FREE_EMAIL_DOMAINS.has('acme.fr')).toBe(false)
    expect(FREE_EMAIL_DOMAINS.has('strofe.fr')).toBe(false)
  })
})
