// ============================================================
// TESTS INTÉGRATION — Propagation scoring_weights
// ------------------------------------------------------------
// Vérifie que `profile.settings.scoring_weights` est lu dans
// `runPipelineSourcing` (lib/agent/sourcing-runner.ts) et propagé jusqu'à
// `calculerScore` / `getScoreDetails` (lib/agent/scoring.ts).
//
// On combine 2 angles :
//   1. Pures (sans réseau) : normalizeScoringWeights — fallback / clamp / projection.
//   2. Cablâge runner → scoring : mock `./scoring` pour capturer les arguments
//      reçus par `calculerScore`, et vérifier qu'ils correspondent aux settings
//      passés au pipeline. Préserve `normalizeScoringWeights` réelle pour les
//      assertions de comportement combiné.
//
// Fichier distinct de `sourcing-runner.test.ts` pour ne pas perturber les
// suites existantes (la stratégie de mock global de `./scoring` casserait
// l'interprétation des scores dans ce dernier).
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { SupabaseAdminClient } from '@/lib/supabase/server'
import type {
  ProfileSettings,
  Prospect,
  ScoringWeights,
  SireneEtablissement,
} from '@/lib/types'

// ------------------------------------------------------------
// MOCK : `./scoring` — préserve la vraie `normalizeScoringWeights`
// mais espionne `calculerScore` + `getScoreDetails`.
// ------------------------------------------------------------

vi.mock('@/lib/agent/scoring', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent/scoring')>(
    '@/lib/agent/scoring',
  )
  return {
    ...actual,
    calculerScore: vi.fn(actual.calculerScore),
    getScoreDetails: vi.fn(actual.getScoreDetails),
  }
})

// ------------------------------------------------------------
// MOCK : `./sourcing` — préserve `SireneApiError`, espionne les fetchers.
// ------------------------------------------------------------

vi.mock('@/lib/agent/sourcing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent/sourcing')>(
    '@/lib/agent/sourcing',
  )
  return {
    ...actual,
    sourcerEntreprises: vi.fn(),
    sourcerEntreprisesFallback: vi.fn(),
    enrichirProspect: vi.fn(),
  }
})

// Imports APRÈS vi.mock (hoist garanti par Vitest).
import {
  calculerScore,
  DEFAULT_SCORING_WEIGHTS,
  getScoreDetails,
  normalizeScoringWeights,
} from '../scoring'
import {
  enrichirProspect,
  sourcerEntreprises,
  type SourcerEntreprisesResult,
} from '../sourcing'
import { runPipelineSourcing } from '../sourcing-runner'

const mockedCalculerScore = calculerScore as unknown as Mock
const mockedGetScoreDetails = getScoreDetails as unknown as Mock
const mockedSourcer = sourcerEntreprises as unknown as Mock
const mockedEnrichir = enrichirProspect as unknown as Mock

// ------------------------------------------------------------
// FIXTURES / FACTORIES
// ------------------------------------------------------------

/** Construit un prospect partiel cohérent pour le scoring (utilisé en input pur). */
function makeProspect(overrides: Partial<Prospect> = {}): Partial<Prospect> {
  return {
    siren: '111111111',
    raison_sociale: 'ACME SAS',
    effectif_min: 250,
    effectif_max: 500,       // pilier taille → 100
    obligation_beges: false,
    beges_publie: true,
    beges_valide: true,      // pilier beges → 0
    contact_telephone: '0556000000', // pilier contact → 100
    signaux: [],
    statut: 'sourced',
    ...overrides,
  }
}

/** Construit un établissement Sirene factice avec SIREN explicite. */
function makeEtab(siren: string): SireneEtablissement {
  return {
    siret: `${siren}00010`,
    siren,
    denominationUniteLegale: `Etab ${siren}`,
    activitePrincipaleEtablissement: '49.41A',
    trancheEffectifsEtablissement: '41',
    codePostalEtablissement: '33000',
    libelleCommuneEtablissement: 'Bordeaux',
    etatAdministratifEtablissement: 'A',
  }
}

/** Réponse Sirene synthétique d'une page unique avec exhausted=true. */
function buildPage(etabs: SireneEtablissement[]): SourcerEntreprisesResult {
  return {
    etablissements: etabs,
    curseur: '*',
    curseurSuivant: '*',
    totalAvailable: etabs.length,
    pagesLoaded: 1,
    exhausted: true,
    universeEmpty: false,
  }
}

/** Mock minimal du client Supabase admin (profiles + prospects + agent_runs). */
function makeSupabaseAdminMock(): SupabaseAdminClient {
  const from = vi.fn((table: string) => {
    if (table === 'profiles') {
      return {
        // .select('sourcing_state').eq('id', userId).single()
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: { sourcing_state: null }, error: null }),
          })),
        })),
        // .update({ sourcing_state: ... }).eq('id', userId)
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      }
    }
    if (table === 'prospects') {
      return {
        // .select('siren').eq('user_id', userId) → liste vide (aucun SIREN exclu)
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
        // .upsert(...).select('id,created_at,updated_at') → renvoie liste vide
        upsert: vi.fn(() => ({
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      }
    }
    // Tables non utilisées par runPipelineSourcing : retour neutre.
    return {
      select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) })),
      upsert: vi.fn(() => ({ select: vi.fn().mockResolvedValue({ data: [], error: null }) })),
      update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: 'r' }, error: null }) })),
      })),
    }
  })
  return { from } as unknown as SupabaseAdminClient
}

/** Capture les logs structurés émis par le runner. */
function makePushLog() {
  const pushLog = vi.fn()
  return { pushLog }
}

// ------------------------------------------------------------
// SETUP / TEARDOWN
// ------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockedCalculerScore.mockClear()
  mockedGetScoreDetails.mockClear()
  mockedSourcer.mockReset()
  mockedEnrichir.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================
// SECTION 1 — Comportement pur de normalizeScoringWeights
// (fallback / clamp / projection — bordures consommées par le runner)
// ============================================================

describe('normalizeScoringWeights — comportement consommé par le runner', () => {
  it('settings vides → fallback DEFAULT_SCORING_WEIGHTS (30/30/40)', () => {
    // Arrange + Act
    const result = normalizeScoringWeights(undefined)

    // Assert
    expect(result).toEqual(DEFAULT_SCORING_WEIGHTS)
    expect(result).toEqual({ taille: 30, beges: 30, contact: 40 })
  })

  it('normalise 1/1/2 vers 25/25/50 (re-projection proportionnelle)', () => {
    // Arrange + Act
    const result = normalizeScoringWeights({ taille: 1, beges: 1, contact: 2 })

    // Assert
    expect(result).toEqual({ taille: 25, beges: 25, contact: 50 })
  })

  it('clamp negatives + NaN à 0, recompose la somme sur le pilier restant', () => {
    // Arrange : taille -10 → 0 ; beges NaN → 0 ; contact 20 → 100 % après normalisation
    const garbage = { taille: -10, beges: Number.NaN, contact: 20 } as unknown as ScoringWeights

    // Act
    const result = normalizeScoringWeights(garbage)

    // Assert
    expect(result).toEqual({ taille: 0, beges: 0, contact: 100 })
  })

  it('somme nulle après clamp → fallback aux defaults (pas de division par zéro)', () => {
    // Arrange : tout négatif / 0
    const allZero = { taille: -5, beges: 0, contact: -3 } as unknown as ScoringWeights

    // Act
    const result = normalizeScoringWeights(allZero)

    // Assert
    expect(result).toEqual(DEFAULT_SCORING_WEIGHTS)
  })
})

// ============================================================
// SECTION 2 — Propagation depuis le pipeline vers calculerScore
// ============================================================

describe('runPipelineSourcing — propagation de settings.scoring_weights vers calculerScore', () => {
  /** Helper : prépare 1 page Sirene + 1 prospect enrichi, et lance le pipeline. */
  async function runPipelineWithSettings(
    settings: ProfileSettings | null,
  ): Promise<void> {
    const etab = makeEtab('200000001')
    mockedSourcer.mockResolvedValueOnce(buildPage([etab]))
    mockedEnrichir.mockResolvedValueOnce(makeProspect({ siren: etab.siren }))

    const { pushLog } = makePushLog()
    await runPipelineSourcing({
      userId: 'user-test-1',
      runId: 'run-test-1',
      params: {},
      settings,
      supabase: makeSupabaseAdminMock(),
      pushLog,
    })
  }

  it('settings.scoring_weights défini → calculerScore reçoit ces weights', async () => {
    // Arrange
    const customWeights: ScoringWeights = { taille: 50, beges: 25, contact: 25 }
    const settings: ProfileSettings = {
      daily_call_target: 15,
      scoring_weights: customWeights,
    }

    // Act
    await runPipelineWithSettings(settings)

    // Assert : au moins un appel à calculerScore avec les weights custom
    expect(mockedCalculerScore).toHaveBeenCalled()
    const [, , passedWeights] = mockedCalculerScore.mock.calls[0]
    expect(passedWeights).toEqual(customWeights)
    // Idem pour getScoreDetails (utilisé pour la jauge UI).
    expect(mockedGetScoreDetails).toHaveBeenCalled()
    const [, , passedDetailsWeights] = mockedGetScoreDetails.mock.calls[0]
    expect(passedDetailsWeights).toEqual(customWeights)
  })

  it('settings sans scoring_weights → calculerScore reçoit undefined (fallback côté scoring)', async () => {
    // Arrange : settings minimalistes sans la clé scoring_weights
    const settings: ProfileSettings = { daily_call_target: 15 }

    // Act
    await runPipelineWithSettings(settings)

    // Assert
    expect(mockedCalculerScore).toHaveBeenCalled()
    const [, , passedWeights] = mockedCalculerScore.mock.calls[0]
    expect(passedWeights).toBeUndefined()
  })

  it('settings = null (profil non chargé) → calculerScore reçoit undefined', async () => {
    // Arrange + Act
    await runPipelineWithSettings(null)

    // Assert
    expect(mockedCalculerScore).toHaveBeenCalled()
    const [, , passedWeights] = mockedCalculerScore.mock.calls[0]
    expect(passedWeights).toBeUndefined()
  })

  it('settings.scoring_weights = 1/1/2 → calculerScore reçoit l\'objet brut (normalisation déléguée)', async () => {
    // Arrange : un poids non-normalisé. La normalisation est faite par calculerScore lui-même
    // (cf. scoring.ts L831-836). Le runner ne pré-normalise pas — c'est volontaire et testé ici.
    const rawWeights: ScoringWeights = { taille: 1, beges: 1, contact: 2 }
    const settings: ProfileSettings = {
      daily_call_target: 15,
      scoring_weights: rawWeights,
    }

    // Act
    await runPipelineWithSettings(settings)

    // Assert : le runner propage l'objet tel quel — pas de pré-projection à 25/25/50.
    expect(mockedCalculerScore).toHaveBeenCalled()
    const [, , passedWeights] = mockedCalculerScore.mock.calls[0]
    expect(passedWeights).toEqual(rawWeights)
    // Vérification croisée : normalizeScoringWeights, appliqué à cet objet, donne 25/25/50.
    expect(normalizeScoringWeights(passedWeights)).toEqual({ taille: 25, beges: 25, contact: 50 })
  })

  it('calculerScore est appelé une fois par prospect enrichi (cohérence cardinalité)', async () => {
    // Arrange : 3 établissements + 3 prospects enrichis
    const etabs = [makeEtab('300000001'), makeEtab('300000002'), makeEtab('300000003')]
    mockedSourcer.mockResolvedValueOnce(buildPage(etabs))
    for (const e of etabs) {
      mockedEnrichir.mockResolvedValueOnce(makeProspect({ siren: e.siren }))
    }

    const customWeights: ScoringWeights = { taille: 10, beges: 20, contact: 70 }

    // Act
    const { pushLog } = makePushLog()
    await runPipelineSourcing({
      userId: 'user-test-2',
      runId: 'run-test-2',
      params: {},
      settings: { daily_call_target: 15, scoring_weights: customWeights },
      supabase: makeSupabaseAdminMock(),
      pushLog,
    })

    // Assert : un appel calculerScore par prospect, avec les weights custom à chaque fois.
    expect(mockedCalculerScore).toHaveBeenCalledTimes(3)
    for (const call of mockedCalculerScore.mock.calls) {
      expect(call[2]).toEqual(customWeights)
    }
  })
})
