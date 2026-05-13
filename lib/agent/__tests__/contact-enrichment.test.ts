// ============================================================
// TESTS UNITAIRES — contact-enrichment.ts
// Focus :
//   1. cleanFirstName (dédup prénoms multiples / pollution casse)
//   2. enrichirContact — étape 5 post-cascade LinkedIn page entreprise
// Vitest — pattern AAA (Arrange / Act / Assert)
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock du helper LinkedIn (HEAD HTTP réseau évité)
vi.mock('../linkedin-company', () => ({
  findLinkedinCompanyUrl: vi.fn(),
}))

import { cleanFirstName, enrichirContact } from '../contact-enrichment'
import { findLinkedinCompanyUrl } from '../linkedin-company'

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

// ------------------------------------------------------------
// enrichirContact — étape 5 post-cascade (LinkedIn page entreprise)
// On mocke `findLinkedinCompanyUrl` ET on intercepte `global.fetch`
// pour neutraliser les appels Recherche Entreprises / Pappers / Hunter
// (la cascade les fait toujours, on les fait simplement échouer en silence).
// ------------------------------------------------------------

describe('enrichirContact — étape 5 LinkedIn page entreprise', () => {
  const mockedFindLinkedin = vi.mocked(findLinkedinCompanyUrl)
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockedFindLinkedin.mockReset()

    // Neutralise toutes les sources réseau de la cascade (RE/Pappers/Hunter)
    // en simulant un échec HTTP 503. La cascade traite ça comme "rien trouvé"
    // sans propager d'erreur. vi.stubGlobal — convention du projet (cf.
    // sourcing.test.ts) qui évite les frictions de typing avec vi.spyOn.
    fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => '',
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchSpy)

    // Désactive Pappers/Hunter via env pour eviter la décrémentation des
    // quotas (et garder le test deterministe).
    delete process.env.PAPPERS_API_KEY
    delete process.env.HUNTER_API_KEY
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('peuple contact_linkedin_entreprise quand AUCUN contact direct', async () => {
    mockedFindLinkedin.mockResolvedValueOnce(
      'https://www.linkedin.com/company/foo-bar/',
    )

    const result = await enrichirContact('123456789', {}, 'Foo Bar SAS')

    expect(result.contact_linkedin_entreprise).toBe(
      'https://www.linkedin.com/company/foo-bar/',
    )
    expect(mockedFindLinkedin).toHaveBeenCalledWith('Foo Bar SAS')
  })

  it('NE peuple PAS si un contact_email existe déjà', async () => {
    const result = await enrichirContact(
      '123456789',
      { contact_email: 'pre@existant.fr' },
      'Foo Bar SAS',
    )

    expect(result.contact_linkedin_entreprise).toBeUndefined()
    expect(mockedFindLinkedin).not.toHaveBeenCalled()
  })

  it('NE peuple PAS si un contact_telephone existe déjà', async () => {
    const result = await enrichirContact(
      '123456789',
      { contact_telephone: '0102030405' },
      'Foo Bar SAS',
    )

    expect(result.contact_linkedin_entreprise).toBeUndefined()
    expect(mockedFindLinkedin).not.toHaveBeenCalled()
  })

  it('NE peuple PAS si contact_linkedin (profil perso) existe déjà', async () => {
    const result = await enrichirContact(
      '123456789',
      { contact_linkedin: 'https://www.linkedin.com/in/jean-doe' },
      'Foo Bar SAS',
    )

    expect(result.contact_linkedin_entreprise).toBeUndefined()
    expect(mockedFindLinkedin).not.toHaveBeenCalled()
  })

  it('NE peuple PAS si contact_linkedin_entreprise déjà renseigné (idempotence)', async () => {
    const result = await enrichirContact(
      '123456789',
      {
        contact_linkedin_entreprise: 'https://www.linkedin.com/company/foo-bar/',
      },
      'Foo Bar SAS',
    )

    expect(result.contact_linkedin_entreprise).toBeUndefined()
    expect(mockedFindLinkedin).not.toHaveBeenCalled()
  })

  it('NE peuple PAS si findLinkedinCompanyUrl retourne null (404 / rate-limit)', async () => {
    mockedFindLinkedin.mockResolvedValueOnce(null)

    const result = await enrichirContact('123456789', {}, 'Foo Bar SAS')

    expect(result.contact_linkedin_entreprise).toBeUndefined()
    expect(mockedFindLinkedin).toHaveBeenCalledTimes(1)
  })

  it('NE peuple PAS si raisonSociale vide', async () => {
    const result = await enrichirContact('123456789', {}, '')

    expect(result.contact_linkedin_entreprise).toBeUndefined()
    expect(mockedFindLinkedin).not.toHaveBeenCalled()
  })

  it('court-circuit early si email + téléphone existants (aucune source appelée)', async () => {
    const result = await enrichirContact(
      '123456789',
      { contact_email: 'a@b.fr', contact_telephone: '0102030405' },
      'Foo Bar SAS',
    )

    // Court-circuit early : aucun enrichissement (return {} immédiat)
    expect(result).toEqual({})
    expect(mockedFindLinkedin).not.toHaveBeenCalled()
  })

  it('retourne undefined sur SIREN invalide', async () => {
    const result = await enrichirContact('invalid', {}, 'Foo Bar SAS')

    expect(result).toEqual({})
    expect(mockedFindLinkedin).not.toHaveBeenCalled()
  })
})
