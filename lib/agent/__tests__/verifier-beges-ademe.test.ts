// ============================================================
// TESTS — verifierBegesAdeme + helpers (lib/agent/sourcing.ts)
//
// Cible : bug "lien BEGES non concerné" (2026-05-14).
// L'API ADEME Data Fair renvoie `siren_principal` en INTEGER alors que
// `verifierBegesAdeme` le compare en string strict. Conséquence : le filtre
// `r.siren_principal === siren` retournait toujours `[]`, et le fallback prenait
// le premier résultat full-text → URL pointant sur un BEGES d'une autre
// entreprise.
//
// Stratégie de mock :
//   - fetch globalement stubé via vi.stubGlobal
//   - Aucune dépendance réelle ADEME
//   - Vérifie que `verifierBegesAdeme` :
//       1. interroge `qs=siren_principal:<siren>` (query exacte, pas full-text)
//       2. accepte siren_principal en `number` ET en `string`
//       3. ne retourne PAS un BEGES qui ne matche pas le SIREN
//       4. trie par annee_de_reporting DESC (bilan le plus récent)
//       5. construit l'URL canonique `https://bilans-ges.ademe.fr/bilans/<id>`
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildAdemeBilanUrl,
  normalizeAdemeRecord,
  verifierBegesAdeme,
} from '../sourcing'

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

interface MockResponseInit {
  status?: number
  ok?: boolean
  json?: () => Promise<unknown>
  text?: () => Promise<string>
}

function makeResponse(init: MockResponseInit): Response {
  const status = init.status ?? 200
  const ok = init.ok ?? (status >= 200 && status < 300)
  return {
    status,
    ok,
    json: init.json ?? (async () => ({})),
    text: init.text ?? (async () => ''),
  } as unknown as Response
}

function makeJsonResponse(body: unknown, status = 200): Response {
  return makeResponse({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  })
}

// ------------------------------------------------------------
// SETUP / TEARDOWN
// ------------------------------------------------------------

beforeEach(() => {
  // verifierBegesAdeme n'utilise pas l'INSEE_API_KEY mais d'autres tests du
  // module la requièrent. On la set par défense.
  process.env.INSEE_API_KEY = 'test-key'
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ============================================================
// normalizeAdemeRecord — type-guard runtime
// ============================================================

describe('normalizeAdemeRecord', () => {
  it('coerce siren_principal number → string 9 digits (cas réel ADEME)', () => {
    const result = normalizeAdemeRecord({
      siren_principal: 542065479,
      raison_sociale: 'PSA AUTOMOBILES SA',
      annee_de_reporting: 2018,
      date_de_publication: '2019-12-09',
      id: '9397a0e8-b1cd-11ed-8fce-005056b7acd1',
    })
    expect(result).not.toBeNull()
    expect(result?.siren_principal).toBe('542065479')
    expect(typeof result?.siren_principal).toBe('string')
  })

  it('zero-pad un SIREN integer commençant par 0', () => {
    // SIREN valide INSEE peut commencer par 0 — rare mais possible.
    const result = normalizeAdemeRecord({
      siren_principal: 12345678,
      raison_sociale: 'TEST',
      annee_de_reporting: 2023,
      date_de_publication: '2024-01-01',
      id: 'uuid-1',
    })
    expect(result?.siren_principal).toBe('012345678')
  })

  it('accepte siren_principal string (compatibilité descendante)', () => {
    const result = normalizeAdemeRecord({
      siren_principal: '542065479',
      raison_sociale: 'PSA',
      annee_de_reporting: 2018,
      date_de_publication: '2019-12-09',
      id: 'uuid-1',
    })
    expect(result?.siren_principal).toBe('542065479')
  })

  it('retourne null si id manquant', () => {
    const result = normalizeAdemeRecord({
      siren_principal: 542065479,
      raison_sociale: 'PSA',
      annee_de_reporting: 2018,
      date_de_publication: '2019-12-09',
      // id manquant
    })
    expect(result).toBeNull()
  })

  it('retourne null si siren_principal non parseable', () => {
    const result = normalizeAdemeRecord({
      siren_principal: 'pas-un-siren',
      raison_sociale: 'TEST',
      annee_de_reporting: 2020,
      date_de_publication: '2020-01-01',
      id: 'uuid-1',
    })
    expect(result).toBeNull()
  })

  it('retourne null si annee_de_reporting hors plage', () => {
    const result = normalizeAdemeRecord({
      siren_principal: 542065479,
      raison_sociale: 'TEST',
      annee_de_reporting: 1850, // trop ancien
      date_de_publication: '2020-01-01',
      id: 'uuid-1',
    })
    expect(result).toBeNull()
  })

  it('coerce annee_de_reporting string → number', () => {
    const result = normalizeAdemeRecord({
      siren_principal: 542065479,
      raison_sociale: 'TEST',
      annee_de_reporting: '2023' as unknown as number,
      date_de_publication: '2023-12-01',
      id: 'uuid-1',
    })
    expect(result?.annee_de_reporting).toBe(2023)
  })
})

// ============================================================
// buildAdemeBilanUrl
// ============================================================

describe('buildAdemeBilanUrl', () => {
  it('construit l\'URL canonique avec UUID', () => {
    const url = buildAdemeBilanUrl('9397a0e8-b1cd-11ed-8fce-005056b7acd1')
    expect(url).toBe('https://bilans-ges.ademe.fr/bilans/9397a0e8-b1cd-11ed-8fce-005056b7acd1')
  })
})

// ============================================================
// verifierBegesAdeme
// ============================================================

describe('verifierBegesAdeme', () => {
  it('retourne null si SIREN mal formé (validation amont, pas d\'appel API)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifierBegesAdeme('ABC123')
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('utilise qs=siren_principal:<siren> (recherche par champ exact, pas full-text)', async () => {
    const fetchMock = vi.fn(async (_url: string | URL): Promise<Response> =>
      makeJsonResponse({
        results: [
          {
            siren_principal: 542065479,
            raison_sociale: 'PSA AUTOMOBILES SA',
            annee_de_reporting: 2018,
            date_de_publication: '2019-12-09',
            id: 'uuid-psa-2018',
          },
        ],
        total: 1,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await verifierBegesAdeme('542065479')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const firstCall = fetchMock.mock.calls[0]
    expect(firstCall).toBeDefined()
    const calledUrl = String(firstCall?.[0] ?? '')
    expect(calledUrl).toContain('qs=siren_principal%3A542065479')
    // Vérifie qu'on n'utilise pas l'ancien `q=` full-text qui causait le bug
    expect(calledUrl).not.toMatch(/[?&]q=542065479/)
  })

  it('cas nominal — siren_principal en number → URL canonique correcte', async () => {
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({
        results: [
          {
            siren_principal: 542065479, // INTEGER — cas réel ADEME
            raison_sociale: 'PSA AUTOMOBILES SA',
            annee_de_reporting: 2018,
            date_de_publication: '2019-12-09',
            id: '9397a0e8-b1cd-11ed-8fce-005056b7acd1',
          },
        ],
        total: 1,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifierBegesAdeme('542065479')

    expect(result).not.toBeNull()
    expect(result?.url_bilan).toBe(
      'https://bilans-ges.ademe.fr/bilans/9397a0e8-b1cd-11ed-8fce-005056b7acd1',
    )
    expect(result?.siren).toBe('542065479')
    expect(result?.annee_reporting).toBe(2018)
  })

  it('NE retourne PAS un BEGES d\'une autre entreprise (fix anti-faux-positif)', async () => {
    // Reproduction du bug : full-text pouvait matcher sur le champ `siret` (HTML
    // avec plusieurs SIREN). Si qs= filtre mal côté API, on doit quand même
    // rejeter les résultats qui ne matchent pas le siren demandé.
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({
        results: [
          {
            siren_principal: 999999999, // SIREN différent
            raison_sociale: 'AUTRE ENTREPRISE',
            annee_de_reporting: 2022,
            date_de_publication: '2023-06-01',
            id: 'uuid-autre',
          },
        ],
        total: 1,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifierBegesAdeme('542065479')
    expect(result).toBeNull() // pas de fallback sur un autre SIREN
  })

  it('trie par annee_de_reporting DESC et retourne le bilan le plus récent', async () => {
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({
        results: [
          {
            siren_principal: 542065479,
            raison_sociale: 'PSA',
            annee_de_reporting: 2018,
            date_de_publication: '2019-12-09',
            id: 'uuid-2018',
          },
          {
            siren_principal: 542065479,
            raison_sociale: 'Stellantis Auto SAS',
            annee_de_reporting: 2022,
            date_de_publication: '2023-06-01',
            id: 'uuid-2022',
          },
          {
            siren_principal: 542065479,
            raison_sociale: 'PSA',
            annee_de_reporting: 2020,
            date_de_publication: '2021-06-01',
            id: 'uuid-2020',
          },
        ],
        total: 3,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifierBegesAdeme('542065479')
    expect(result?.annee_reporting).toBe(2022)
    expect(result?.url_bilan).toBe('https://bilans-ges.ademe.fr/bilans/uuid-2022')
    expect(result?.raison_sociale).toBe('Stellantis Auto SAS')
  })

  it('retourne null si results vide (entreprise sans BEGES)', async () => {
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({ results: [], total: 0 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifierBegesAdeme('123456789')
    expect(result).toBeNull()
  })

  it('retourne null sur HTTP 5xx (mode dégradé silencieux)', async () => {
    const fetchMock = vi.fn(async () =>
      makeResponse({ status: 503, ok: false, text: async () => 'Service unavailable' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifierBegesAdeme('123456789')
    expect(result).toBeNull()
  })

  it('retourne null sur erreur réseau (mode dégradé silencieux)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifierBegesAdeme('123456789')
    expect(result).toBeNull()
  })

  it('retourne null sur réponse JSON malformée', async () => {
    const fetchMock = vi.fn(async () =>
      makeResponse({
        status: 200,
        ok: true,
        json: async () => {
          throw new Error('Unexpected token')
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifierBegesAdeme('123456789')
    expect(result).toBeNull()
  })

  it('inclut les champs contact (responsable_du_suivi, fonction, courriel)', async () => {
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({
        results: [
          {
            siren_principal: 542065479,
            raison_sociale: 'PSA',
            annee_de_reporting: 2022,
            date_de_publication: '2023-06-01',
            id: 'uuid-1',
            responsable_du_suivi: 'Dupont Marie',
            fonction: 'Responsable RSE',
            courriel: 'rse@psa.fr',
          },
        ],
        total: 1,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifierBegesAdeme('542065479')
    expect(result?.responsable_du_suivi).toBe('Dupont Marie')
    expect(result?.fonction).toBe('Responsable RSE')
    expect(result?.courriel).toBe('rse@psa.fr')
  })

  it('GLN-066 — expose raw_record avec le payload Data Fair complet du bilan choisi', async () => {
    // Payload "réaliste" reproduisant les champs ADEME Data Fair exploitables
    // downstream (scope 3 + plan_action pour Décret 2022, methodologie, etc.).
    const rawRecord = {
      siren_principal: 542065479,
      raison_sociale: 'PSA',
      annee_de_reporting: 2024,
      date_de_publication: '2024-09-01',
      id: 'uuid-2024',
      emissions_scope_1: 1234.5,
      emissions_scope_2: 678.9,
      emissions_scope_3: 5432.1,
      methodologie: 'Bilan Carbone',
      perimetre_organisationnel: 'Société mère + filiales',
      plan_action_transition: 'Réduction 30% scope 1+2 d\'ici 2030',
      objectifs_reduction: 'SBTi 1.5°C',
      consultant_accompagnant: 'Greenly',
    }

    const fetchMock = vi.fn(async () =>
      makeJsonResponse({ results: [rawRecord], total: 1 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifierBegesAdeme('542065479')
    expect(result).not.toBeNull()
    expect(result?.raw_record).toBeDefined()
    // Vérifie que TOUS les champs Data Fair (typés ou non) sont conservés.
    expect(result?.raw_record?.emissions_scope_3).toBe(5432.1)
    expect(result?.raw_record?.methodologie).toBe('Bilan Carbone')
    expect(result?.raw_record?.plan_action_transition).toBe(
      'Réduction 30% scope 1+2 d\'ici 2030',
    )
    expect(result?.raw_record?.consultant_accompagnant).toBe('Greenly')
  })

  it('GLN-066 — raw_record correspond au bilan le plus récent quand plusieurs années sont retournées', async () => {
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({
        results: [
          {
            siren_principal: 542065479,
            raison_sociale: 'PSA',
            annee_de_reporting: 2020,
            date_de_publication: '2021-06-01',
            id: 'uuid-2020',
            methodologie: 'GHG Protocol',
          },
          {
            siren_principal: 542065479,
            raison_sociale: 'PSA',
            annee_de_reporting: 2023,
            date_de_publication: '2024-01-15',
            id: 'uuid-2023',
            methodologie: 'Bilan Carbone',
            emissions_scope_3: 9999,
          },
        ],
        total: 2,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifierBegesAdeme('542065479')
    expect(result?.annee_reporting).toBe(2023)
    // Le raw_record exposé doit être celui du bilan le plus récent (2023).
    expect(result?.raw_record?.methodologie).toBe('Bilan Carbone')
    expect(result?.raw_record?.emissions_scope_3).toBe(9999)
  })

  it('skip les records malformés sans casser (id manquant dans la liste)', async () => {
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({
        results: [
          {
            siren_principal: 542065479,
            raison_sociale: 'INVALIDE',
            annee_de_reporting: 2023,
            date_de_publication: '2024-01-01',
            // id manquant → record skippé par normalizeAdemeRecord
          },
          {
            siren_principal: 542065479,
            raison_sociale: 'VALIDE',
            annee_de_reporting: 2022,
            date_de_publication: '2023-06-01',
            id: 'uuid-valide',
          },
        ],
        total: 2,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifierBegesAdeme('542065479')
    expect(result).not.toBeNull()
    expect(result?.url_bilan).toBe('https://bilans-ges.ademe.fr/bilans/uuid-valide')
    expect(result?.raison_sociale).toBe('VALIDE')
  })
})
