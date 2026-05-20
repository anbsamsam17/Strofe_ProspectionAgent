// ============================================================
// TESTS — enrichirProspect (lib/agent/sourcing.ts)
//
// Couvre les regles metier de qualification BEGES :
//   - Seuil obligation BEGES metropole : >= 500 sal. (tranche INSEE >= 41) — GLN-004
//   - Seuil obligation BEGES DOM-TOM   : >= 250 sal. (tranche INSEE >= 32) — GLN-004
//
// Strategie de mock :
//   - fetch globalement stubbe (ADEME + Recherche Entreprises ne sont pas appeles
//     pour de vrai)
//   - On verifie uniquement le mapping tranche -> obligation_beges en fonction
//     du code postal (DOM-TOM vs metropole).
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
