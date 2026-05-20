// ============================================================
// TESTS — enrichirProspect (lib/agent/sourcing.ts)
//
// Couvre les regles metier de qualification BEGES :
//   - Seuil obligation BEGES metropole : >= 500 sal. (tranche INSEE >= 41) — GLN-004
//   - Seuil obligation BEGES DOM-TOM   : >= 250 sal. (tranche INSEE >= 32) — GLN-004
//   - Validite BEGES prive   : 4 ans (default) — GLN-005
//   - Validite BEGES public  : 3 ans (cat. juridique INSEE 71xx-74xx) — GLN-005
//
// Strategie de mock :
//   - fetch globalement stubbe (ADEME + Recherche Entreprises ne sont pas appeles
//     pour de vrai)
//   - On verifie uniquement le mapping tranche -> obligation_beges en fonction
//     du code postal (DOM-TOM vs metropole) + la validite BEGES en fonction
//     de la categorie juridique.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enrichirProspect } from '../sourcing'
import type { SireneEtablissement } from '@/lib/types'

// ------------------------------------------------------------
// SETUP / TEARDOWN
// ------------------------------------------------------------

beforeEach(() => {
  // Toutes les sources externes (ADEME, Recherche Entreprises) renvoient vide.
  // On veut isoler la logique de seuil BEGES, pas tester ces sources.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [], total_count: 0 }),
      text: async () => '',
    } as unknown as Response),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ------------------------------------------------------------
// HELPER : fabrique un SireneEtablissement minimal
// ------------------------------------------------------------

function makeEtab(overrides: Partial<SireneEtablissement> = {}): SireneEtablissement {
  return {
    siret: '12345678900001',
    siren: '123456789',
    denominationUniteLegale: 'ACME SAS',
    trancheEffectifsEtablissement: '41',
    codePostalEtablissement: '75001',
    libelleCommuneEtablissement: 'PARIS',
    activitePrincipaleEtablissement: '62.01Z',
    etatAdministratifEtablissement: 'A',
    ...overrides,
  }
}

// ------------------------------------------------------------
// SEUIL BEGES METROPOLE (>= 500 sal., tranche >= 41)
// ------------------------------------------------------------

describe('enrichirProspect — seuil BEGES metropole (Art. L229-25)', () => {
  it('tranche 41 (500-999 sal.) en metropole → obligation_beges = true', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ trancheEffectifsEtablissement: '41', codePostalEtablissement: '75001' }),
    )
    expect(prospect.obligation_beges).toBe(true)
  })

  it('tranche 32 (250-499 sal.) en metropole → obligation_beges = false', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ trancheEffectifsEtablissement: '32', codePostalEtablissement: '75001' }),
    )
    expect(prospect.obligation_beges).toBe(false)
  })

  it('tranche 31 (200-249 sal.) en metropole → obligation_beges = false', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ trancheEffectifsEtablissement: '31', codePostalEtablissement: '69001' }),
    )
    expect(prospect.obligation_beges).toBe(false)
  })

  it('tranche 53 (10000+ sal.) en metropole → obligation_beges = true', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ trancheEffectifsEtablissement: '53', codePostalEtablissement: '33000' }),
    )
    expect(prospect.obligation_beges).toBe(true)
  })
})

// ------------------------------------------------------------
// SEUIL BEGES DOM-TOM (>= 250 sal., tranche >= 32) — GLN-004
// ------------------------------------------------------------

describe('enrichirProspect — seuil BEGES DOM-TOM (Art. L229-25)', () => {
  it('Guadeloupe (CP 97100) + tranche 32 (250-499 sal.) → obligation_beges = true', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ trancheEffectifsEtablissement: '32', codePostalEtablissement: '97100' }),
    )
    expect(prospect.obligation_beges).toBe(true)
  })

  it('Martinique (CP 97200) + tranche 32 → obligation_beges = true', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ trancheEffectifsEtablissement: '32', codePostalEtablissement: '97200' }),
    )
    expect(prospect.obligation_beges).toBe(true)
  })

  it('La Reunion (CP 97400) + tranche 32 → obligation_beges = true', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ trancheEffectifsEtablissement: '32', codePostalEtablissement: '97400' }),
    )
    expect(prospect.obligation_beges).toBe(true)
  })

  it('Mayotte (CP 97600) + tranche 32 → obligation_beges = true', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ trancheEffectifsEtablissement: '32', codePostalEtablissement: '97600' }),
    )
    expect(prospect.obligation_beges).toBe(true)
  })

  it('Nouvelle-Caledonie (CP 98800) + tranche 32 → obligation_beges = true', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ trancheEffectifsEtablissement: '32', codePostalEtablissement: '98800' }),
    )
    expect(prospect.obligation_beges).toBe(true)
  })

  it('Guadeloupe + tranche 31 (200-249 sal.) → obligation_beges = false (sous seuil)', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ trancheEffectifsEtablissement: '31', codePostalEtablissement: '97100' }),
    )
    expect(prospect.obligation_beges).toBe(false)
  })

  it('Guadeloupe + tranche 41 (500-999 sal.) → obligation_beges = true (au-dessus du seuil)', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ trancheEffectifsEtablissement: '41', codePostalEtablissement: '97100' }),
    )
    expect(prospect.obligation_beges).toBe(true)
  })

  it('Polynesie francaise (CP 98700) + tranche 32 → obligation_beges = true', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ trancheEffectifsEtablissement: '32', codePostalEtablissement: '98700' }),
    )
    expect(prospect.obligation_beges).toBe(true)
  })

  it('Saint-Barthelemy (CP 97700) + tranche 32 → obligation_beges = true', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ trancheEffectifsEtablissement: '32', codePostalEtablissement: '97700' }),
    )
    expect(prospect.obligation_beges).toBe(true)
  })

  it('CP 96000 (proche mais hors DOM-TOM) + tranche 32 → obligation_beges = false', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ trancheEffectifsEtablissement: '32', codePostalEtablissement: '96000' }),
    )
    expect(prospect.obligation_beges).toBe(false)
  })
})

// ------------------------------------------------------------
// CODE POSTAL via adresseEtablissement (chemin alternatif)
// ------------------------------------------------------------

describe('enrichirProspect — resolution code postal', () => {
  it('lit codePostal depuis adresseEtablissement si racine absente', async () => {
    const prospect = await enrichirProspect(
      makeEtab({
        codePostalEtablissement: undefined,
        adresseEtablissement: {
          codePostalEtablissement: '97400',
        },
        trancheEffectifsEtablissement: '32',
      }),
    )
    expect(prospect.obligation_beges).toBe(true)
  })

  it('aucun code postal → traite comme metropole (seuil 500)', async () => {
    const prospect = await enrichirProspect(
      makeEtab({
        codePostalEtablissement: undefined,
        adresseEtablissement: undefined,
        trancheEffectifsEtablissement: '32',
      }),
    )
    expect(prospect.obligation_beges).toBe(false)
  })
})

// ------------------------------------------------------------
// ENTITE PUBLIQUE — validite BEGES (GLN-005 / Decret 2022-982)
// ------------------------------------------------------------

/**
 * Mock fetch qui simule l'API ADEME Data Fair pour un SIREN donne, avec une
 * `annee_de_reporting` configurable. Toute autre requete (Recherche Entreprises)
 * renvoie un body vide.
 */
function stubAdemeWithReportingYear(siren: string, anneeReporting: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string) => {
      // ADEME bilans-ges (Data Fair) — schema attendu par normalizeAdemeRecord
      if (url.includes('data-fair') || url.includes('bilan-ges')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              {
                id: 'ademe-test-uuid-9397a0e8-b1cd-11ed',
                siren_principal: parseInt(siren, 10),
                raison_sociale: 'ACME SAS',
                annee_de_reporting: anneeReporting,
                date_de_publication: `${anneeReporting + 1}-06-15`,
              },
            ],
            total: 1,
          }),
          text: async () => '',
        } as unknown as Response
      }
      // Tout le reste (Recherche Entreprises) : vide
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [], total_count: 0 }),
        text: async () => '',
      } as unknown as Response
    }),
  )
}

describe('enrichirProspect — entite publique (GLN-005)', () => {
  it('categorie juridique 7220 (commune) → entite_publique = true', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ categorieJuridiqueUniteLegale: '7220' }),
    )
    expect(prospect.entite_publique).toBe(true)
  })

  it('categorie juridique 7100 (administration Etat) → entite_publique = true', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ categorieJuridiqueUniteLegale: '7100' }),
    )
    expect(prospect.entite_publique).toBe(true)
  })

  it('categorie juridique 7340 (etablissement public administratif) → entite_publique = true', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ categorieJuridiqueUniteLegale: '7340' }),
    )
    expect(prospect.entite_publique).toBe(true)
  })

  it('categorie juridique 7450 (autre PMDP) → entite_publique = true', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ categorieJuridiqueUniteLegale: '7450' }),
    )
    expect(prospect.entite_publique).toBe(true)
  })

  it('categorie juridique 5710 (SAS) → entite_publique = false', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ categorieJuridiqueUniteLegale: '5710' }),
    )
    expect(prospect.entite_publique).toBe(false)
  })

  it('categorie juridique 5599 (SA) → entite_publique = false', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ categorieJuridiqueUniteLegale: '5599' }),
    )
    expect(prospect.entite_publique).toBe(false)
  })

  it('categorie juridique absente → entite_publique = false (fallback prive)', async () => {
    const prospect = await enrichirProspect(
      makeEtab({ categorieJuridiqueUniteLegale: undefined }),
    )
    expect(prospect.entite_publique).toBe(false)
  })
})

describe('enrichirProspect — validite BEGES periode (GLN-005)', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-05-20T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('public (cat. 7220), BEGES 2023 (3 ans → 2026 expire) → beges_valide = true', async () => {
    // En 2026, seuil public = 2023+ (year - 3). 2023 est juste a la limite : valide.
    stubAdemeWithReportingYear('123456789', 2023)
    const prospect = await enrichirProspect(
      makeEtab({ categorieJuridiqueUniteLegale: '7220' }),
    )
    expect(prospect.entite_publique).toBe(true)
    expect(prospect.beges_publie).toBe(true)
    expect(prospect.beges_valide).toBe(true)
  })

  it('public (cat. 7220), BEGES 2022 (4 ans → expire pour public) → beges_valide = false', async () => {
    // En 2026, seuil public = 2023+. 2022 < 2023 → expire.
    stubAdemeWithReportingYear('123456789', 2022)
    const prospect = await enrichirProspect(
      makeEtab({ categorieJuridiqueUniteLegale: '7220' }),
    )
    expect(prospect.entite_publique).toBe(true)
    expect(prospect.beges_valide).toBe(false)
  })

  it('prive (cat. 5710), BEGES 2022 (4 ans → 2026 valide) → beges_valide = true', async () => {
    // En 2026, seuil prive = 2022+ (year - 4). 2022 juste a la limite : valide.
    stubAdemeWithReportingYear('123456789', 2022)
    const prospect = await enrichirProspect(
      makeEtab({ categorieJuridiqueUniteLegale: '5710' }),
    )
    expect(prospect.entite_publique).toBe(false)
    expect(prospect.beges_valide).toBe(true)
  })

  it('prive (cat. 5710), BEGES 2021 → beges_valide = false', async () => {
    // En 2026, seuil prive = 2022+. 2021 < 2022 → expire.
    stubAdemeWithReportingYear('123456789', 2021)
    const prospect = await enrichirProspect(
      makeEtab({ categorieJuridiqueUniteLegale: '5710' }),
    )
    expect(prospect.beges_valide).toBe(false)
  })
})
