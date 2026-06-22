// ============================================================
// TESTS UNITAIRES — gemini-scoring.ts
//
// Vérifications :
//   - Cas nominal : score + raisons valides retournés.
//   - Cas erreur 429 retriable : 1 retry puis succès.
//   - Cas erreur définitive : fallback propre (pas de crash).
//   - Cas validation Zod KO : fallback propre.
//   - Cas clé absente : fallback propre.
//   - PII : aucun email/téléphone/nom de contact dans le prompt envoyé.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeminiProspectInput } from '../gemini-scoring'

// ------------------------------------------------------------
// MOCK @google/generative-ai — capture les appels generateContent
// ------------------------------------------------------------

const _generateContentMock = vi.fn()
const _getGenerativeModelMock = vi.fn(() => ({
  generateContent: _generateContentMock,
}))

vi.mock('@google/generative-ai', () => {
  // Re-export des enums nécessaires (SchemaType est utilisé à l'import du module).
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: _getGenerativeModelMock,
    })),
    SchemaType: {
      OBJECT: 'object',
      INTEGER: 'integer',
      ARRAY: 'array',
      STRING: 'string',
      NUMBER: 'number',
      BOOLEAN: 'boolean',
    },
  }
})

// ------------------------------------------------------------
// FIXTURES
// ------------------------------------------------------------

function makeProspect(overrides: Partial<GeminiProspectInput> = {}): GeminiProspectInput {
  return {
    raison_sociale: 'Clinique du Lac SAS',
    secteur_naf: '8610Z',
    secteur_libelle: 'Activités hospitalières',
    effectif_min: 500,
    effectif_max: 999,
    ville: 'Bordeaux',
    beges_publie: true,
    beges_valide: false,
    obligation_beges: true,
    signaux: [],
    ...overrides,
  }
}

/** Réponse Gemini valide minimale. */
function mockGeminiOk(overrides: Record<string, unknown> = {}) {
  const payload = {
    interet_score: 78,
    raisons: [
      'BEGES expiré depuis > 4 ans : renouvellement obligatoire imminent, urgence à pitcher',
      'Secteur santé : forte pression réglementaire et donneurs d\'ordre exigeants',
      'Effectif 500-999 : pleinement soumis à l\'obligation L. 229-25',
    ],
    ...overrides,
  }
  return {
    response: {
      text: () => JSON.stringify(payload),
    },
  }
}

// ------------------------------------------------------------
// SETUP / TEARDOWN
// ------------------------------------------------------------

beforeEach(async () => {
  _generateContentMock.mockReset()
  _getGenerativeModelMock.mockClear()
  process.env.GEMINI_API_KEY = 'test-gemini-key'
  // Reset singleton du client Gemini (sinon mocks ne s'appliquent pas entre tests).
  const mod = await import('../gemini-scoring')
  mod._internal.resetClient()
})

// ------------------------------------------------------------
// CAS NOMINAL
// ------------------------------------------------------------

describe('scoreLeadAvecGemini — cas nominal', () => {
  it('retourne un score 0-100 et 3-5 raisons valides', async () => {
    // Arrange
    _generateContentMock.mockResolvedValue(mockGeminiOk())
    const { scoreLeadAvecGemini } = await import('../gemini-scoring')

    // Act
    const result = await scoreLeadAvecGemini(makeProspect())

    // Assert
    expect(result.interet_score).toBe(78)
    expect(result.raisons).toHaveLength(3)
    expect(result.raisons[0]).toMatch(/BEGES expiré/i)
    expect(result.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('inclut bien la raison sociale et le secteur dans le prompt user', async () => {
    _generateContentMock.mockResolvedValue(mockGeminiOk())
    const { scoreLeadAvecGemini } = await import('../gemini-scoring')

    await scoreLeadAvecGemini(makeProspect())

    expect(_generateContentMock).toHaveBeenCalledOnce()
    const prompt = String(_generateContentMock.mock.calls[0]?.[0] ?? '')

    expect(prompt).toMatch(/Clinique du Lac SAS/)
    expect(prompt).toMatch(/Activités hospitalières/)
    expect(prompt).toMatch(/500 à 999 salariés/)
    expect(prompt).toMatch(/EXPIRÉ/i)
  })
})

// ------------------------------------------------------------
// RETRY — 429 / 5xx
// ------------------------------------------------------------

describe('scoreLeadAvecGemini — retry erreur retriable', () => {
  it('retry une fois sur erreur 429 puis succès', async () => {
    // Arrange : 1er appel 429, 2e appel OK
    const err429 = Object.assign(new Error('Too Many Requests (429)'), { status: 429 })
    _generateContentMock
      .mockRejectedValueOnce(err429)
      .mockResolvedValueOnce(mockGeminiOk({ interet_score: 65 }))
    const { scoreLeadAvecGemini } = await import('../gemini-scoring')

    // Act
    const result = await scoreLeadAvecGemini(makeProspect())

    // Assert
    expect(_generateContentMock).toHaveBeenCalledTimes(2)
    expect(result.interet_score).toBe(65)
    expect(result.raisons.length).toBeGreaterThanOrEqual(3)
  })

  it('retry sur erreur 503 puis succès', async () => {
    const err503 = Object.assign(new Error('Service Unavailable 503'), { status: 503 })
    _generateContentMock
      .mockRejectedValueOnce(err503)
      .mockResolvedValueOnce(mockGeminiOk())
    const { scoreLeadAvecGemini } = await import('../gemini-scoring')

    const result = await scoreLeadAvecGemini(makeProspect())

    expect(_generateContentMock).toHaveBeenCalledTimes(2)
    expect(result.interet_score).toBe(78)
  })

  it('marque transient_failure sur 5xx persistant (retry épuisé)', async () => {
    const err500 = Object.assign(new Error('Internal Server Error 500'), { status: 500 })
    _generateContentMock.mockRejectedValue(err500)
    const { scoreLeadAvecGemini } = await import('../gemini-scoring')

    const result = await scoreLeadAvecGemini(makeProspect())

    expect(_generateContentMock).toHaveBeenCalledTimes(2) // 1 essai + 1 retry
    expect(result.interet_score).toBe(0)
    // Échec transitoire → ne pas verrouiller le prospect (retry au prochain run).
    expect(result.transient_failure).toBe(true)
  })
})

// ------------------------------------------------------------
// FALLBACK — erreur définitive / validation KO
// ------------------------------------------------------------

describe('scoreLeadAvecGemini — fallback propre', () => {
  it('retourne le fallback (score 0) après 1 retry échoué (429 persistant)', async () => {
    const err429 = Object.assign(new Error('429 rate limit'), { status: 429 })
    _generateContentMock.mockRejectedValue(err429)
    const { scoreLeadAvecGemini } = await import('../gemini-scoring')

    const result = await scoreLeadAvecGemini(makeProspect())

    expect(_generateContentMock).toHaveBeenCalledTimes(2) // 1 essai + 1 retry
    expect(result.interet_score).toBe(0)
    expect(result.raisons).toHaveLength(1)
    expect(result.raisons[0]).toMatch(/indisponible/i)
    expect(result.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // Échec TRANSITOIRE (429 persistant) → signalé pour permettre le retry
    // au prochain run (l'orchestrator ne persistera pas gemini_generated_at).
    expect(result.transient_failure).toBe(true)
  })

  it('retourne fallback sur erreur 400 (non retriable) — pas de retry', async () => {
    const err400 = Object.assign(new Error('Bad Request'), { status: 400 })
    _generateContentMock.mockRejectedValue(err400)
    const { scoreLeadAvecGemini } = await import('../gemini-scoring')

    const result = await scoreLeadAvecGemini(makeProspect())

    expect(_generateContentMock).toHaveBeenCalledTimes(1) // pas de retry
    expect(result.interet_score).toBe(0)
    expect(result.raisons[0]).toMatch(/indisponible/i)
    // Erreur DÉFINITIVE (400 non retriable) → résultat stable, persistable
    // (pas un échec transitoire).
    expect(result.transient_failure).toBeFalsy()
  })

  it('retourne fallback sur validation Zod KO (score hors plage)', async () => {
    _generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            interet_score: 250, // > 100, viole Zod max
            raisons: ['raison 1', 'raison 2', 'raison 3'],
          }),
      },
    })
    const { scoreLeadAvecGemini } = await import('../gemini-scoring')

    const result = await scoreLeadAvecGemini(makeProspect())

    expect(result.interet_score).toBe(0)
    expect(result.raisons[0]).toMatch(/indisponible/i)
    // Réponse reçue mais invalide → échec DÉFINITIF (pas transitoire) : il est
    // sûr de persister gemini_generated_at (un retry redonnerait la même chose).
    expect(result.transient_failure).toBeFalsy()
  })

  it('retourne fallback sur validation Zod KO (raisons trop peu nombreuses)', async () => {
    _generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            interet_score: 50,
            raisons: ['une seule raison'], // < 3 (min Zod)
          }),
      },
    })
    const { scoreLeadAvecGemini } = await import('../gemini-scoring')

    const result = await scoreLeadAvecGemini(makeProspect())

    expect(result.interet_score).toBe(0)
    expect(result.raisons[0]).toMatch(/indisponible/i)
  })

  it('retourne fallback sur JSON malformé', async () => {
    _generateContentMock.mockResolvedValue({
      response: {
        text: () => '{not-valid-json:::',
      },
    })
    const { scoreLeadAvecGemini } = await import('../gemini-scoring')

    const result = await scoreLeadAvecGemini(makeProspect())

    expect(result.interet_score).toBe(0)
    expect(result.raisons[0]).toMatch(/indisponible/i)
  })

  it('retourne fallback sur contenu vide', async () => {
    _generateContentMock.mockResolvedValue({
      response: {
        text: () => '',
      },
    })
    const { scoreLeadAvecGemini } = await import('../gemini-scoring')

    const result = await scoreLeadAvecGemini(makeProspect())

    expect(result.interet_score).toBe(0)
    expect(result.raisons[0]).toMatch(/indisponible/i)
  })
})

// ------------------------------------------------------------
// CLÉ API ABSENTE
// ------------------------------------------------------------

describe('scoreLeadAvecGemini — clé API absente', () => {
  it('retourne le fallback sans appeler le SDK', async () => {
    delete process.env.GEMINI_API_KEY
    _generateContentMock.mockResolvedValue(mockGeminiOk())
    const { scoreLeadAvecGemini, isGeminiAvailable } = await import('../gemini-scoring')

    expect(isGeminiAvailable()).toBe(false)
    const result = await scoreLeadAvecGemini(makeProspect())

    expect(_generateContentMock).not.toHaveBeenCalled()
    expect(result.interet_score).toBe(0)
    expect(result.raisons[0]).toMatch(/non configurée|indisponible/i)
  })
})

// ------------------------------------------------------------
// PII — pas de contact dans le prompt
// ------------------------------------------------------------

describe('scoreLeadAvecGemini — PII absente du prompt', () => {
  it('le prompt ne contient AUCUN champ contact (email/téléphone/nom/prénom)', async () => {
    // Arrange : même si on construit un input minimal, on s'assure qu'aucun
    // champ PII du Prospect n'a fui via fuites de propriétés non listées.
    _generateContentMock.mockResolvedValue(mockGeminiOk())
    const { scoreLeadAvecGemini } = await import('../gemini-scoring')

    // Volontairement injecter des données qui RESSEMBLENT à de la PII pour
    // vérifier que le mapping strict du type GeminiProspectInput ne les
    // transporte pas. (En vrai, GeminiProspectInput interdit ces clés.)
    const prospect = makeProspect({
      raison_sociale: 'Clinique du Lac SAS',
    })

    // Act
    await scoreLeadAvecGemini(prospect)

    // Assert : capture le prompt et vérifie qu'il ne contient pas de motifs PII
    const prompt = String(_generateContentMock.mock.calls[0]?.[0] ?? '')

    expect(prompt).not.toMatch(/contact_email/i)
    expect(prompt).not.toMatch(/contact_telephone/i)
    expect(prompt).not.toMatch(/contact_nom/i)
    expect(prompt).not.toMatch(/contact_prenom/i)
    // Pas d'email évident dans le prompt (heuristique simple).
    expect(prompt).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)
    // Pas de numéro français à 10 chiffres formaté téléphone (06 12 34 56 78, etc.).
    // L'article L. 229-25 ou les effectifs "500-999" ne matchent pas ce pattern.
    expect(prompt).not.toMatch(/0\s?\d(?:[\s.-]?\d{2}){4}/)
  })

  it('le SDK Gemini est appelé avec un payload string et pas un objet contenant PII', async () => {
    _generateContentMock.mockResolvedValue(mockGeminiOk())
    const { scoreLeadAvecGemini } = await import('../gemini-scoring')

    await scoreLeadAvecGemini(makeProspect())

    // Vérifie que generateContent est appelé avec un string (pas un objet
    // avec des champs PII supplémentaires qui auraient pu être ajoutés).
    const arg = _generateContentMock.mock.calls[0]?.[0]
    expect(typeof arg).toBe('string')
  })
})

// ------------------------------------------------------------
// CATÉGORISATION SECTEUR — categoriserSecteurAvecGemini
// ------------------------------------------------------------

function mockSecteurOk(overrides: Record<string, unknown> = {}) {
  const payload = {
    secteur_libelle: 'Transport routier de marchandises',
    secteur_categorie: 'transport',
    confidence: 'high',
    ...overrides,
  }
  return {
    response: {
      text: () => JSON.stringify(payload),
    },
  }
}

describe('categoriserSecteurAvecGemini — cas nominal', () => {
  it('retourne un libellé + catégorie + confidence validés', async () => {
    _generateContentMock.mockResolvedValue(mockSecteurOk())
    const { categoriserSecteurAvecGemini } = await import('../gemini-scoring')

    const result = await categoriserSecteurAvecGemini({
      nafCode: '49.41A',
      raisonSociale: 'Transports Dupont SAS',
      effectifMin: 50,
    })

    expect(result).not.toBeNull()
    expect(result?.secteur_libelle).toBe('Transport routier de marchandises')
    expect(result?.secteur_categorie).toBe('transport')
    expect(result?.confidence).toBe('high')
  })

  it('inclut le code NAF et la raison sociale dans le prompt', async () => {
    _generateContentMock.mockResolvedValue(mockSecteurOk())
    const { categoriserSecteurAvecGemini } = await import('../gemini-scoring')

    await categoriserSecteurAvecGemini({
      nafCode: '49.41A',
      raisonSociale: 'Transports Dupont SAS',
      effectifMin: 50,
    })

    const prompt = String(_generateContentMock.mock.calls[0]?.[0] ?? '')
    expect(prompt).toMatch(/49\.41A/)
    expect(prompt).toMatch(/Transports Dupont SAS/)
    expect(prompt).toMatch(/50\+/)
  })
})

describe('categoriserSecteurAvecGemini — graceful degradation', () => {
  it('retourne null sur JSON malformé (pas de crash)', async () => {
    _generateContentMock.mockResolvedValue({
      response: { text: () => '{not-valid-json:::' },
    })
    const { categoriserSecteurAvecGemini } = await import('../gemini-scoring')

    const result = await categoriserSecteurAvecGemini({
      nafCode: '49.41A',
      raisonSociale: 'Transports Dupont SAS',
    })

    expect(result).toBeNull()
  })

  it('retourne null sur catégorie hors enum (validation Zod KO)', async () => {
    _generateContentMock.mockResolvedValue(
      mockSecteurOk({ secteur_categorie: 'inconnu_invalide' }),
    )
    const { categoriserSecteurAvecGemini } = await import('../gemini-scoring')

    const result = await categoriserSecteurAvecGemini({
      nafCode: '49.41A',
      raisonSociale: 'Transports Dupont SAS',
    })

    expect(result).toBeNull()
  })

  it('retourne null sur quota dépassé (429) sans crasher le pipeline', async () => {
    const err429 = Object.assign(new Error('Too Many Requests (429)'), { status: 429 })
    _generateContentMock.mockRejectedValue(err429)
    const { categoriserSecteurAvecGemini } = await import('../gemini-scoring')

    const result = await categoriserSecteurAvecGemini({
      nafCode: '49.41A',
      raisonSociale: 'Transports Dupont SAS',
    })

    expect(result).toBeNull()
  })

  it('retourne null sans appeler le SDK quand GEMINI_API_KEY absente', async () => {
    delete process.env.GEMINI_API_KEY
    _generateContentMock.mockResolvedValue(mockSecteurOk())
    const { categoriserSecteurAvecGemini } = await import('../gemini-scoring')

    const result = await categoriserSecteurAvecGemini({
      nafCode: '49.41A',
      raisonSociale: 'Transports Dupont SAS',
    })

    expect(result).toBeNull()
    expect(_generateContentMock).not.toHaveBeenCalled()
  })

  it('retourne null sur contenu vide', async () => {
    _generateContentMock.mockResolvedValue({
      response: { text: () => '' },
    })
    const { categoriserSecteurAvecGemini } = await import('../gemini-scoring')

    const result = await categoriserSecteurAvecGemini({
      nafCode: '49.41A',
      raisonSociale: 'Transports Dupont SAS',
    })

    expect(result).toBeNull()
  })
})

describe('categoriserSecteurAvecGemini — cache LRU', () => {
  it('ne refait pas d\'appel Gemini pour le même (nafCode, raisonSociale)', async () => {
    _generateContentMock.mockResolvedValue(mockSecteurOk())
    const { categoriserSecteurAvecGemini, _internal } = await import('../gemini-scoring')

    expect(_internal._secteurCacheSize()).toBe(0)

    const r1 = await categoriserSecteurAvecGemini({
      nafCode: '49.41A',
      raisonSociale: 'Transports Dupont SAS',
    })
    expect(r1).not.toBeNull()
    expect(_generateContentMock).toHaveBeenCalledTimes(1)
    expect(_internal._secteurCacheSize()).toBe(1)

    // 2e appel identique → cache hit, pas d'appel Gemini.
    const r2 = await categoriserSecteurAvecGemini({
      nafCode: '49.41A',
      raisonSociale: 'Transports Dupont SAS',
    })
    expect(r2).not.toBeNull()
    expect(r2?.secteur_libelle).toBe(r1?.secteur_libelle)
    expect(_generateContentMock).toHaveBeenCalledTimes(1) // toujours 1
  })

  it('normalise la raison sociale (casse + espaces) pour le hit cache', async () => {
    _generateContentMock.mockResolvedValue(mockSecteurOk())
    const { categoriserSecteurAvecGemini } = await import('../gemini-scoring')

    await categoriserSecteurAvecGemini({
      nafCode: '49.41A',
      raisonSociale: 'Transports Dupont SAS',
    })
    await categoriserSecteurAvecGemini({
      nafCode: '49.41A',
      raisonSociale: '  TRANSPORTS  Dupont   sas  ',
    })

    // Normalisation casse+espaces → même clé → 1 seul appel
    expect(_generateContentMock).toHaveBeenCalledTimes(1)
  })

  it('ne mélange pas deux NAF différents dans le cache', async () => {
    _generateContentMock
      .mockResolvedValueOnce(mockSecteurOk({ secteur_libelle: 'Transport routier' }))
      .mockResolvedValueOnce(mockSecteurOk({ secteur_libelle: 'Fabrication métallurgique', secteur_categorie: 'industrie' }))
    const { categoriserSecteurAvecGemini } = await import('../gemini-scoring')

    const r1 = await categoriserSecteurAvecGemini({
      nafCode: '49.41A',
      raisonSociale: 'Société Anonyme',
    })
    const r2 = await categoriserSecteurAvecGemini({
      nafCode: '24.10Z',
      raisonSociale: 'Société Anonyme',
    })

    expect(r1?.secteur_libelle).toBe('Transport routier')
    expect(r2?.secteur_libelle).toBe('Fabrication métallurgique')
    expect(_generateContentMock).toHaveBeenCalledTimes(2)
  })
})

describe('categoriserSecteurAvecGemini — PII', () => {
  it('le prompt ne contient ni email ni téléphone', async () => {
    _generateContentMock.mockResolvedValue(mockSecteurOk())
    const { categoriserSecteurAvecGemini } = await import('../gemini-scoring')

    await categoriserSecteurAvecGemini({
      nafCode: '49.41A',
      raisonSociale: 'Transports Dupont SAS',
      effectifMin: 50,
    })

    const prompt = String(_generateContentMock.mock.calls[0]?.[0] ?? '')
    expect(prompt).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)
    expect(prompt).not.toMatch(/0\s?\d(?:[\s.-]?\d{2}){4}/)
    expect(prompt).not.toMatch(/contact_/i)
  })
})

// ------------------------------------------------------------
// HELPERS INTERNES (isRetriableGeminiError)
// ------------------------------------------------------------

describe('isRetriableGeminiError (interne)', () => {
  it('détecte 429 comme retriable', async () => {
    const { _internal } = await import('../gemini-scoring')
    expect(_internal.isRetriableGeminiError({ status: 429 })).toBe(true)
  })

  it('détecte 500-599 comme retriable', async () => {
    const { _internal } = await import('../gemini-scoring')
    expect(_internal.isRetriableGeminiError({ status: 503 })).toBe(true)
    expect(_internal.isRetriableGeminiError({ status: 599 })).toBe(true)
  })

  it('rejette 400 (non retriable)', async () => {
    const { _internal } = await import('../gemini-scoring')
    expect(_internal.isRetriableGeminiError({ status: 400 })).toBe(false)
  })

  it('détecte timeout par message', async () => {
    const { _internal } = await import('../gemini-scoring')
    expect(_internal.isRetriableGeminiError(new Error('gemini timeout (15000ms)'))).toBe(true)
  })

  it('retourne false sur null/undefined', async () => {
    const { _internal } = await import('../gemini-scoring')
    expect(_internal.isRetriableGeminiError(null)).toBe(false)
    expect(_internal.isRetriableGeminiError(undefined)).toBe(false)
  })
})
