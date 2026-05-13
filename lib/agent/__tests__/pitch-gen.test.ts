// ============================================================
// TESTS UNITAIRES — pitch-gen.ts (PROMPT v2 — 2026-05-12)
//
// Vérifications principales :
//   - Le SYSTEM_PROMPT (capturé via mock OpenAI) contient les mots-clés du
//     nouveau format MAIL (accroche) et FICHE ENTREPRISE (pitch).
//   - L'accroche ne s'ouvre jamais par "obligation", "article L. 229-25", "amende"
//     (failsafe interne — log warn, mais on vérifie que le pitch retourné est intact).
//   - Le user prompt embarque le prénom propre fourni (déduplication amont).
//   - Le contact_type couvre au minimum 2 personas (rse, daf).
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProfileSettings, Prospect } from '@/lib/types'

// ------------------------------------------------------------
// MOCK OPENAI SDK — capture messages envoyés à chat.completions.create
// ------------------------------------------------------------

const _createMock = vi.fn()

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: _createMock } },
  })),
}))

// ------------------------------------------------------------
// FIXTURES
// ------------------------------------------------------------

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: 'prospect-1',
    user_id: 'user-1',
    siren: '123456789',
    raison_sociale: 'Clinique du Lac SAS',
    secteur_naf: '8610Z',
    secteur_libelle: 'Activités hospitalières',
    effectif_min: 500,
    effectif_max: 999,
    ville: 'Bordeaux',
    contact_nom: 'Dupont',
    contact_prenom: 'Jean', // déjà cleané en amont (cf. cleanFirstName)
    contact_poste: 'Directeur Général',
    obligation_beges: true,
    beges_publie: true,
    beges_valide: false,
    beges_derniere_publication: '2020-03-15',
    score_priorite: 80,
    score_details: {
      obligation_beges: 30,
      secteur_prioritaire: 20,
      beges_non_publie: 0,    // BEGES publié → 0 (le bonus est dans beges_expire)
      beges_expire: 25,        // BEGES expiré (beges_valide=false) — tuning 2026-05-13
      signaux_intention: 5,
      taille_entreprise: 10,   // effectif 999 → tranche 800-1999 (tuning 2026-05-13)
      contact_trouve: 10,      // tuning 2026-05-13 : 5 → 10
      secteur_beges_mature: 0, // NAF "47.11F" non mature dans cette fixture
      penalite_deja_contacte: 0,
      penalite_rejete: 0,
    },
    signaux: [],
    statut: 'sourced',
    source: 'sirene',
    created_at: '2026-05-12T00:00:00Z',
    updated_at: '2026-05-12T00:00:00Z',
    ...overrides,
  }
}

const settings: ProfileSettings = {
  daily_call_target: 15,
  offer_description: 'Strofe accompagne ETI françaises sur leur BEGES.',
}

// Réponse JSON minimale conforme au schéma GeneratedPitch
function mockGptResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    accroche:
      "Bonjour Jean,\nJe me permets de vous contacter au sujet du Bilan GES réglementaire de Clinique du Lac SAS, dont le dernier bilan publié sur le registre de l'ADEME date du 15 mars 2020. L'échéance des 4 ans étant dépassée, vous êtes sans doute déjà en train de travailler sur la mise à jour. Strofe accompagne les établissements de santé dans la réalisation et la publication de leur BEGES. Si un échange rapide peut vous être utile, je suis disponible à votre convenance.\nJe vous souhaite un très bon après-midi,",
    pitch:
      '- Secteur : Activités hospitalières\n- Dirigeant : Jean Dupont (Directeur Général)\n- Effectif : 500–999 salariés\n- CA estimé : non renseigné\n- État BEGES : expiré (publication 2020-03-15)',
    signaux_detectes: [],
    objections: [
      { objection: 'Budget serré', reponse: 'Subventions ADEME jusqu\'à 70 %.' },
      { objection: 'Pas prioritaire', reponse: 'Critères RSE des donneurs d\'ordre.' },
    ],
    meilleur_creneau: '10h-11h',
    contact_type: 'dg',
    ton: 'factuel et orienté ROI',
    ...overrides,
  })
}

beforeEach(() => {
  _createMock.mockReset()
  process.env.OPENAI_API_KEY = 'sk-test-key'
})

// ------------------------------------------------------------
// SYSTEM_PROMPT — contenu attendu (v2 : mail + fiche entreprise)
// ------------------------------------------------------------

describe('SYSTEM_PROMPT v2 — contenu attendu', () => {
  it('contient les mots-clés du nouveau format mail (accroche)', async () => {
    // Arrange
    _createMock.mockResolvedValue({
      choices: [{ message: { content: mockGptResponse() } }],
    })
    const { genererPitch } = await import('../pitch-gen')

    // Act
    await genererPitch(makeProspect(), settings)

    // Assert : la 1re call passe (system, user) à chat.completions.create
    const args = _createMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    const systemContent = args.messages.find((m) => m.role === 'system')?.content ?? ''

    expect(systemContent).toMatch(/EMAIL prêt à envoyer/i)
    expect(systemContent).toMatch(/FICHE ENTREPRISE/i)
    expect(systemContent).toMatch(/Strofe/)
    expect(systemContent).toMatch(/article L\.?\s*229-25/i)
    expect(systemContent).toMatch(/JAMAIS.*ouverture|JAMAIS.*"Conformément/i)
  })

  it('contient le rappel des leviers ordonnés ROI > image > légal pour les objections', async () => {
    _createMock.mockResolvedValue({
      choices: [{ message: { content: mockGptResponse() } }],
    })
    const { genererPitch } = await import('../pitch-gen')

    await genererPitch(makeProspect(), settings)

    const args = _createMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    const systemContent = args.messages.find((m) => m.role === 'system')?.content ?? ''

    expect(systemContent).toMatch(/ROI/)
    expect(systemContent).toMatch(/Image de marque/i)
    expect(systemContent).toMatch(/Contrainte légale/i)
  })

  it('mentionne le seuil légal correct (500 salariés en métropole) — pas un seuil inventé', async () => {
    _createMock.mockResolvedValue({
      choices: [{ message: { content: mockGptResponse() } }],
    })
    const { genererPitch } = await import('../pitch-gen')

    await genererPitch(makeProspect(), settings)

    const args = _createMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    const systemContent = args.messages.find((m) => m.role === 'system')?.content ?? ''

    expect(systemContent).toMatch(/500\s*salariés/)
    // Le prompt PEUT mentionner "250 salariés" uniquement comme exemple de seuil
    // FAUX à ne pas citer. On vérifie alors que c'est dans un contexte d'interdiction.
    if (/250\s*salariés/.test(systemContent)) {
      expect(systemContent).toMatch(/(JAMAIS|faux|interdit).*250|250.*(faux|interdit)/i)
    }
  })
})

// ------------------------------------------------------------
// USER PROMPT — injection des données prospect
// ------------------------------------------------------------

describe('user prompt — injection prospect', () => {
  it('injecte le prénom propre fourni dans la consigne de salutation', async () => {
    _createMock.mockResolvedValue({
      choices: [{ message: { content: mockGptResponse() } }],
    })
    const { genererPitch } = await import('../pitch-gen')

    await genererPitch(makeProspect({ contact_prenom: 'Jean' }), settings)

    const args = _createMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    const userContent = args.messages.find((m) => m.role === 'user')?.content ?? ''

    expect(userContent).toMatch(/Bonjour Jean/)
    expect(userContent).toMatch(/Clinique du Lac SAS/)
    expect(userContent).toMatch(/EXPIRÉ/i)
  })

  it('produit un mail générique "Bonjour," quand pas de prénom', async () => {
    _createMock.mockResolvedValue({
      choices: [{ message: { content: mockGptResponse() } }],
    })
    const { genererPitch } = await import('../pitch-gen')

    await genererPitch(makeProspect({ contact_prenom: undefined }), settings)

    const args = _createMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    const userContent = args.messages.find((m) => m.role === 'user')?.content ?? ''

    // La consigne de fallback doit être présente : prénom vide → "Bonjour,"
    expect(userContent).toMatch(/chaîne vide.*Bonjour,/i)
  })
})

// ------------------------------------------------------------
// PARSE & GUARDRAIL — accroche légale interdite en ouverture
// ------------------------------------------------------------

describe('parseGptResponse — failsafe accroche', () => {
  it('retourne le pitch intact même si GPT ouvre par un argument légal', async () => {
    // Arrange : réponse non conforme (légal en ouverture)
    const naughty = mockGptResponse({
      accroche:
        "Bonjour Jean,\nObligation BEGES : l'article L. 229-25 vous expose à une amende de 10 000 €.",
    })
    _createMock.mockResolvedValue({
      choices: [{ message: { content: naughty } }],
    })
    const { genererPitch } = await import('../pitch-gen')

    // Capture des logs (warn doit être émis)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    // Act
    const result = await genererPitch(makeProspect(), settings)

    // Assert : le pitch est retourné (non bloquant), mais un warn a été loggé
    expect(result.accroche).toContain('Obligation BEGES')
    const warnLog = logSpy.mock.calls.find((c) => {
      try {
        const parsed = JSON.parse(String(c[0]))
        return parsed.level === 'warn' && /s'ouvre sur un argument légal/i.test(parsed.msg)
      } catch {
        return false
      }
    })
    expect(warnLog).toBeDefined()

    logSpy.mockRestore()
  })

  it('ne logge pas de warn si l\'accroche est conforme (constat factuel)', async () => {
    _createMock.mockResolvedValue({
      choices: [{ message: { content: mockGptResponse() } }],
    })
    const { genererPitch } = await import('../pitch-gen')

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await genererPitch(makeProspect(), settings)

    const warnLog = logSpy.mock.calls.find((c) => {
      try {
        const parsed = JSON.parse(String(c[0]))
        return parsed.level === 'warn' && /s'ouvre sur un argument légal/i.test(parsed.msg)
      } catch {
        return false
      }
    })
    expect(warnLog).toBeUndefined()

    logSpy.mockRestore()
  })

  it('couvre persona DAF avec contact_type rétrogradé correctement', async () => {
    _createMock.mockResolvedValue({
      choices: [{ message: { content: mockGptResponse({ contact_type: 'daf' }) } }],
    })
    const { genererPitch } = await import('../pitch-gen')

    const result = await genererPitch(
      makeProspect({ contact_poste: 'DAF', contact_nom: 'Martin', contact_prenom: 'Sophie' }),
      settings,
    )

    expect(result.contact_type).toBe('daf')
    expect(result.objections.length).toBeGreaterThanOrEqual(2)
  })

  it('couvre persona RSE (deuxième persona) — schéma stable', async () => {
    _createMock.mockResolvedValue({
      choices: [{ message: { content: mockGptResponse({ contact_type: 'rse' }) } }],
    })
    const { genererPitch } = await import('../pitch-gen')

    const result = await genererPitch(
      makeProspect({ contact_poste: 'Responsable RSE', contact_prenom: 'Camille' }),
      settings,
    )

    expect(result.contact_type).toBe('rse')
    expect(result.meilleur_creneau).toBeTruthy()
    expect(typeof result.pitch).toBe('string')
    expect(typeof result.accroche).toBe('string')
  })
})
