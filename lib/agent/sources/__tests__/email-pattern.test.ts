import { describe, it, expect } from 'vitest'

import {
  applyKnownPattern,
  generateEmailCandidates,
  normalizeName,
  type PatternName,
} from '../email-pattern'

describe('normalizeName', () => {
  it('strip accents et lowercase', () => {
    expect(normalizeName('Hélène')).toBe('helene')
    expect(normalizeName('Müller')).toBe('muller')
    expect(normalizeName('Çaétôn')).toBe('caeton')
    expect(normalizeName('ÉCOLE')).toBe('ecole')
  })

  it("retire apostrophes et tirets", () => {
    expect(normalizeName("D'Artagnan")).toBe('dartagnan')
    expect(normalizeName("O'Brien")).toBe('obrien')
    expect(normalizeName('André-Marie')).toBe('andremarie')
  })

  it('trim espaces et retourne string vide pour input vide', () => {
    expect(normalizeName('  Jean  ')).toBe('jean')
    expect(normalizeName('')).toBe('')
    expect(normalizeName('   ')).toBe('')
  })
})

describe('generateEmailCandidates — cas nominal', () => {
  it("génère exactement 7 patterns pour ('Jean', 'Dupont', 'acme.fr')", () => {
    const result = generateEmailCandidates('Jean', 'Dupont', 'acme.fr')
    expect(result).toHaveLength(7)

    const patterns = result.map((c) => c.pattern)
    expect(patterns).toEqual(
      expect.arrayContaining<PatternName>([
        'prenom.nom',
        'pnom',
        'prenom',
        'nom.prenom',
        'prenom_nom',
        'prenomnom',
        'p.nom',
      ]),
    )

    // Vérifie chaque construction d'email
    const byPattern = Object.fromEntries(result.map((c) => [c.pattern, c.email]))
    expect(byPattern['prenom.nom']).toBe('jean.dupont@acme.fr')
    expect(byPattern['pnom']).toBe('jdupont@acme.fr')
    expect(byPattern['prenom']).toBe('jean@acme.fr')
    expect(byPattern['nom.prenom']).toBe('dupont.jean@acme.fr')
    expect(byPattern['prenom_nom']).toBe('jean_dupont@acme.fr')
    expect(byPattern['prenomnom']).toBe('jeandupont@acme.fr')
    expect(byPattern['p.nom']).toBe('j.dupont@acme.fr')
  })

  it('prenom.nom a la plus haute frequency', () => {
    const result = generateEmailCandidates('Jean', 'Dupont', 'acme.fr')
    const top = result[0]
    expect(top.pattern).toBe('prenom.nom')
    expect(top.frequency).toBeGreaterThan(40)
  })

  it('résultat trié par frequency décroissante', () => {
    const result = generateEmailCandidates('Jean', 'Dupont', 'acme.fr')
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].frequency).toBeGreaterThanOrEqual(result[i].frequency)
    }
  })
})

describe('generateEmailCandidates — normalisation', () => {
  it('strip accents dans le prénom', () => {
    const result = generateEmailCandidates('Hélène', 'Martin', 'acme.fr')
    const main = result.find((c) => c.pattern === 'prenom.nom')
    expect(main?.email).toBe('helene.martin@acme.fr')
  })

  it("strip apostrophe dans le nom (D'Artagnan)", () => {
    const result = generateEmailCandidates('Charles', "D'Artagnan", 'acme.fr')
    const main = result.find((c) => c.pattern === 'prenom.nom')
    expect(main?.email).toBe('charles.dartagnan@acme.fr')
  })

  it('Unicode étendu (Ç, Ô, É) → ASCII', () => {
    const result = generateEmailCandidates('François', 'Côté', 'acme.fr')
    const main = result.find((c) => c.pattern === 'prenom.nom')
    expect(main?.email).toBe('francois.cote@acme.fr')
  })

  it('domain avec protocole et www', () => {
    const result = generateEmailCandidates('Jean', 'Dupont', 'https://www.acme.fr')
    expect(result.length).toBeGreaterThan(0)
    result.forEach((c) => expect(c.email.endsWith('@acme.fr')).toBe(true))
  })

  it('domain en majuscules → lowercase', () => {
    const result = generateEmailCandidates('Jean', 'Dupont', 'ACME.FR')
    expect(result[0].email).toBe('jean.dupont@acme.fr')
  })
})

describe('generateEmailCandidates — prénoms composés', () => {
  it("'Jean-Pierre' génère variantes complètes et courtes", () => {
    const result = generateEmailCandidates('Jean-Pierre', 'Dupont', 'acme.fr')
    const emails = result.map((c) => c.email)

    // Variante prénom complet (jeanpierre)
    expect(emails).toContain('jeanpierre.dupont@acme.fr')
    // Variante prénom court (jean)
    expect(emails).toContain('jean.dupont@acme.fr')
    // Sans doublon
    expect(new Set(emails).size).toBe(emails.length)
  })
})

describe('generateEmailCandidates — edge cases', () => {
  it('prenom vide retourne []', () => {
    expect(generateEmailCandidates('', 'Dupont', 'acme.fr')).toEqual([])
  })

  it('nom vide retourne []', () => {
    expect(generateEmailCandidates('Jean', '', 'acme.fr')).toEqual([])
  })

  it('domain vide retourne []', () => {
    expect(generateEmailCandidates('Jean', 'Dupont', '')).toEqual([])
  })

  it('domain invalide (sans TLD) retourne []', () => {
    expect(generateEmailCandidates('Jean', 'Dupont', 'acme')).toEqual([])
  })

  it("pas de doublons quand pnom == prenomnom pour ('A', 'B', ...)", () => {
    // Prénom 1 lettre : 'A' → firstInitial = 'a', et `${a}${b}` == `${first}${last}` == 'ab'
    // Donc pnom = 'ab' et prenomnom = 'ab' → doivent dédupliquer.
    const result = generateEmailCandidates('A', 'B', 'acme.fr')
    const emails = result.map((c) => c.email)
    expect(new Set(emails).size).toBe(emails.length)
  })
})

describe('applyKnownPattern', () => {
  it('pattern {first}.{last}', () => {
    expect(applyKnownPattern('{first}.{last}', 'Jean', 'Dupont', 'acme.fr')).toBe(
      'jean.dupont@acme.fr',
    )
  })

  it('pattern {f}{last}', () => {
    expect(applyKnownPattern('{f}{last}', 'Jean', 'Dupont', 'acme.fr')).toBe(
      'jdupont@acme.fr',
    )
  })

  it('pattern {f}.{last}', () => {
    expect(applyKnownPattern('{f}.{last}', 'Jean', 'Dupont', 'acme.fr')).toBe(
      'j.dupont@acme.fr',
    )
  })

  it('pattern {first}', () => {
    expect(applyKnownPattern('{first}', 'Jean', 'Dupont', 'acme.fr')).toBe(
      'jean@acme.fr',
    )
  })

  it('pattern {last}.{first}', () => {
    expect(applyKnownPattern('{last}.{first}', 'Jean', 'Dupont', 'acme.fr')).toBe(
      'dupont.jean@acme.fr',
    )
  })

  it('pattern inconnu retourne null', () => {
    expect(applyKnownPattern('{unknown}', 'Jean', 'Dupont', 'acme.fr')).toBeNull()
    expect(applyKnownPattern('', 'Jean', 'Dupont', 'acme.fr')).toBeNull()
  })

  it('inputs vides retourne null', () => {
    expect(applyKnownPattern('{first}.{last}', '', 'Dupont', 'acme.fr')).toBeNull()
    expect(applyKnownPattern('{first}.{last}', 'Jean', '', 'acme.fr')).toBeNull()
    expect(applyKnownPattern('{first}.{last}', 'Jean', 'Dupont', '')).toBeNull()
  })

  it('strip @domain inclus dans le pattern Hunter', () => {
    expect(
      applyKnownPattern('{first}.{last}@example.com', 'Jean', 'Dupont', 'acme.fr'),
    ).toBe('jean.dupont@acme.fr')
  })

  it('applique normalisation accents sur le pattern connu', () => {
    expect(applyKnownPattern('{first}.{last}', 'Hélène', 'Côté', 'acme.fr')).toBe(
      'helene.cote@acme.fr',
    )
  })
})
