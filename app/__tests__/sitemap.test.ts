// ============================================================
// sitemap.test.ts — tests unitaires de app/sitemap.ts
//
// Couvre :
//   - Retourne un array non vide
//   - Contient une entrée pour la racine `/` (URL se termine par SITE_URL)
//   - Chaque entrée possède url, lastModified, changeFrequency, priority
//   - lastModified est une instance de Date valide
//   - priority est un nombre entre 0 et 1
//   - Aucune entrée pour les routes privées (/dashboard, /login, /signup, /onboarding)
// ============================================================

import { describe, it, expect } from 'vitest'
import sitemap from '../sitemap'

const PRIVATE_PREFIXES = ['/dashboard', '/login', '/signup', '/onboarding']

describe('sitemap()', () => {
  it('retourne un array', () => {
    // Act
    const result = sitemap()

    // Assert
    expect(Array.isArray(result)).toBe(true)
  })

  it('retourne au moins une entrée', () => {
    // Act
    const result = sitemap()

    // Assert
    expect(result.length).toBeGreaterThan(0)
  })

  it('contient une entrée pour la homepage (URL racine)', () => {
    // Act
    const result = sitemap()

    // Assert — l'URL de la home correspond à SITE_URL (sans slash final)
    // ou à SITE_URL + '/' selon la convention du projet.
    const homeEntry = result.find((entry) => {
      // L'URL se termine soit sur le domaine seul, soit sur "/"
      return /https?:\/\/[^/]+(\/)?$/.test(entry.url)
    })
    expect(homeEntry).toBeDefined()
  })

  it('chaque entrée possède les propriétés url, lastModified, changeFrequency, priority', () => {
    // Act
    const result = sitemap()

    // Assert
    for (const entry of result) {
      expect(typeof entry.url).toBe('string')
      expect(entry.url.length).toBeGreaterThan(0)
      expect(entry.lastModified).toBeDefined()
      expect(entry.changeFrequency).toBeDefined()
      expect(typeof entry.priority).toBe('number')
    }
  })

  it('lastModified est une instance de Date valide', () => {
    // Act
    const result = sitemap()

    // Assert
    for (const entry of result) {
      const d = entry.lastModified instanceof Date
        ? entry.lastModified
        : new Date(entry.lastModified as string)
      expect(isNaN(d.getTime())).toBe(false)
    }
  })

  it('priority est un nombre compris entre 0 et 1 inclus', () => {
    // Act
    const result = sitemap()

    // Assert
    for (const entry of result) {
      expect(entry.priority).toBeGreaterThanOrEqual(0)
      expect(entry.priority).toBeLessThanOrEqual(1)
    }
  })

  it("n'expose aucune route privée (/dashboard, /login, /signup, /onboarding)", () => {
    // Act
    const result = sitemap()

    // Assert
    for (const entry of result) {
      for (const prefix of PRIVATE_PREFIXES) {
        const url = new URL(entry.url)
        expect(url.pathname).not.toMatch(new RegExp(`^${prefix}`))
      }
    }
  })

  it("changeFrequency est une valeur valide de la spec sitemap.xml", () => {
    // Act
    const result = sitemap()

    const VALID_FREQUENCIES = new Set([
      'always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never',
    ])

    // Assert
    for (const entry of result) {
      if (entry.changeFrequency !== undefined) {
        expect(VALID_FREQUENCIES.has(entry.changeFrequency)).toBe(true)
      }
    }
  })
})
