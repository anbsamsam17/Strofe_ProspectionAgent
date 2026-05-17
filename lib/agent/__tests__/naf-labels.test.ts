import { describe, expect, it } from 'vitest'

import {
  NAF_DIVISION_TO_CATEGORIE,
  NAF_SOUSCLASSES,
  resolveSectorFromNaf,
} from '@/lib/agent/naf-labels'

describe('NAF_SOUSCLASSES', () => {
  it('contient les 732 sous-classes attendues (nomenclature INSEE rev. 2)', () => {
    // 732 sous-classes officielles publiees par l'INSEE depuis 2008.
    // Tout ecart ici signifie soit un trou de sourcing, soit une revision
    // de la nomenclature (rev. 3 prevue 2025-2030).
    expect(Object.keys(NAF_SOUSCLASSES)).toHaveLength(732)
  })

  it('utilise le format canonique XX.XXY (avec point, uppercase)', () => {
    for (const code of Object.keys(NAF_SOUSCLASSES)) {
      expect(code).toMatch(/^\d{2}\.\d{2}[A-Z]$/)
    }
  })

  it('ne contient pas de libelle vide ou suspect', () => {
    for (const [code, label] of Object.entries(NAF_SOUSCLASSES)) {
      expect(label.length, `libelle vide pour ${code}`).toBeGreaterThan(0)
      // Le caractere ? (point d'interrogation) ne doit pas apparaitre comme
      // residu d'encodage casse (artefact de sourcing).
      expect(label, `libelle suspect pour ${code}: ${label}`).not.toMatch(/\?/)
    }
  })
})

describe('NAF_DIVISION_TO_CATEGORIE', () => {
  it('contient exactement 88 divisions', () => {
    expect(Object.keys(NAF_DIVISION_TO_CATEGORIE)).toHaveLength(88)
  })

  it('mappe vers les 9 categories BEGES legales', () => {
    const validCats = new Set([
      'industrie',
      'transport',
      'energie',
      'construction',
      'agriculture',
      'services',
      'commerce',
      'eau_dechets',
      'autre',
    ])
    for (const [div, meta] of Object.entries(NAF_DIVISION_TO_CATEGORIE)) {
      expect(validCats.has(meta.categorie), `categorie invalide pour div ${div}`).toBe(true)
    }
  })

  it('utilise le format canonique 2 chiffres', () => {
    for (const div of Object.keys(NAF_DIVISION_TO_CATEGORIE)) {
      expect(div).toMatch(/^\d{2}$/)
    }
  })
})

describe('resolveSectorFromNaf — cas nominaux', () => {
  it('resout un code avec point au format canonique', () => {
    const result = resolveSectorFromNaf('86.10Z')
    expect(result).toEqual({
      libelle: 'Activités hospitalières',
      categorie: 'services',
      source: 'sous-classe',
    })
  })

  it('resout un code sans point (Sirene live API)', () => {
    const result = resolveSectorFromNaf('8610Z')
    expect(result).toEqual({
      libelle: 'Activités hospitalières',
      categorie: 'services',
      source: 'sous-classe',
    })
  })

  it('resout un code en casse mixte', () => {
    const result = resolveSectorFromNaf('01.21z')
    expect(result).toEqual({
      libelle: 'Culture de la vigne',
      categorie: 'agriculture',
      source: 'sous-classe',
    })
  })

  it('gere les espaces autour du code', () => {
    const result = resolveSectorFromNaf('  35.11Z  ')
    expect(result).toEqual({
      libelle: "Production d'électricité",
      categorie: 'energie',
      source: 'sous-classe',
    })
  })
})

describe('resolveSectorFromNaf — couverture des 9 categories BEGES', () => {
  // Un cas par categorie, code reel issu de la nomenclature.
  const cases: Array<[string, string, string]> = [
    ['01.11Z', 'agriculture', 'Culture de céréales (à l\'exception du riz), de légumineuses et de graines oléagineuses'],
    ['10.11Z', 'industrie', 'Transformation et conservation de la viande de boucherie'],
    ['35.11Z', 'energie', "Production d'électricité"],
    ['38.11Z', 'eau_dechets', 'Collecte des déchets non dangereux'],
    ['41.20A', 'construction', 'Construction de maisons individuelles'],
    ['46.71Z', 'commerce', 'Commerce de gros (commerce interentreprises) de combustibles et de produits annexes'],
    ['49.41A', 'transport', 'Transports routiers de fret interurbains'],
    ['62.01Z', 'services', 'Programmation informatique'],
    ['99.00Z', 'autre', 'Activités des organisations et organismes extraterritoriaux'],
  ]

  for (const [code, expectedCat, expectedLabel] of cases) {
    it(`resout ${code} → ${expectedCat}`, () => {
      const result = resolveSectorFromNaf(code)
      expect(result).not.toBeNull()
      expect(result?.categorie).toBe(expectedCat)
      expect(result?.libelle).toBe(expectedLabel)
      expect(result?.source).toBe('sous-classe')
    })
  }
})

describe('resolveSectorFromNaf — fallback division', () => {
  it("retourne la division quand la sous-classe est inconnue mais la division existe", () => {
    // 86.99X n'existe pas (la division 86 contient 86.10Z, 86.21Z, etc.)
    const result = resolveSectorFromNaf('86.99X')
    expect(result).toEqual({
      libelle: 'Activités pour la santé humaine',
      categorie: 'services',
      source: 'division',
    })
  })

  it('retourne la division pour un code partiel (2 chiffres seulement)', () => {
    const result = resolveSectorFromNaf('49')
    expect(result).toEqual({
      libelle: 'Transports terrestres et transport par conduites',
      categorie: 'transport',
      source: 'division',
    })
  })
})

describe('resolveSectorFromNaf — entrees invalides', () => {
  it('retourne null pour null', () => {
    expect(resolveSectorFromNaf(null)).toBeNull()
  })

  it('retourne null pour undefined', () => {
    expect(resolveSectorFromNaf(undefined)).toBeNull()
  })

  it('retourne null pour une chaine vide', () => {
    expect(resolveSectorFromNaf('')).toBeNull()
  })

  it('retourne null pour des espaces seulement', () => {
    expect(resolveSectorFromNaf('   ')).toBeNull()
  })

  it('retourne null pour une division inexistante', () => {
    // Division "04" n'existe pas dans la nomenclature NAF rev. 2.
    expect(resolveSectorFromNaf('04.00Z')).toBeNull()
    expect(resolveSectorFromNaf('04')).toBeNull()
  })

  it('retourne null pour du texte arbitraire', () => {
    expect(resolveSectorFromNaf('XYZ')).toBeNull()
    expect(resolveSectorFromNaf('not a code')).toBeNull()
  })
})

describe('resolveSectorFromNaf — coherence avec les structures exportees', () => {
  it("toute sous-classe trouvable via lookup direct est resolvable", () => {
    // Echantillon de 20 codes au hasard parmi les 732
    const allCodes = Object.keys(NAF_SOUSCLASSES)
    const sample = allCodes.filter((_, i) => i % 37 === 0).slice(0, 20)
    for (const code of sample) {
      const result = resolveSectorFromNaf(code)
      expect(result, `code ${code} non resolu`).not.toBeNull()
      expect(result?.libelle).toBe(NAF_SOUSCLASSES[code])
      expect(result?.source).toBe('sous-classe')
    }
  })

  it('toutes les divisions ont au moins une sous-classe associee', () => {
    const divsInSubclasses = new Set(
      Object.keys(NAF_SOUSCLASSES).map((c) => c.slice(0, 2)),
    )
    const divsInMapping = new Set(Object.keys(NAF_DIVISION_TO_CATEGORIE))

    // Inclusion stricte : toute division qui apparait dans les sous-classes
    // doit etre presente dans le mapping. L'inverse aussi (test bidirectionnel).
    for (const d of divsInSubclasses) {
      expect(divsInMapping.has(d), `division ${d} absente de NAF_DIVISION_TO_CATEGORIE`).toBe(
        true,
      )
    }
    for (const d of divsInMapping) {
      expect(divsInSubclasses.has(d), `division ${d} sans sous-classe`).toBe(true)
    }
  })
})
