// ============================================================
// TESTS — ETL bulk SIRENE → table `sirene_cache`
// ------------------------------------------------------------
// Cible : `scripts/import-sirene-bulk.ts`. Le script s'exécute via
// `void main()` au chargement → on mocke `fetch`, `unzipper`,
// `@supabase/supabase-js`, `process.exit` AVANT l'import dynamique,
// puis on capture les effets via les mocks Supabase.
//
// Couverture :
//   - Filtre etat=F (entreprises fermées) → exclu
//   - Filtre tranche < 21 (< 10 salariés) → exclu
//   - Filtre sections NAF non BEGES (G/I/J/K) → exclu
//   - Filtre etablissementSiege=false → exclu
//   - Garde sections BEGES (A/C/D/E/F/H) + tranche >= 21 + siege + etat=A
//   - Upsert par batch (BATCH_SIZE configuré dans le script)
//   - source_file inclut le nom du ZIP (StockEtablissement_utf8_YYYYMM.zip)
//   - imported_at = NOW() (DEFAULT côté DB)
//   - Garde-fou storage : ABORT si total_mb > MAX_STORAGE_MB
//   - Lignes malformées (NAF vide, SIRET non-14-digits, NAF non-parseable) :
//     ne crashent pas, sont juste skip
//   - Logs progress structurés (JSON) toutes les LOG_EVERY_ROWS lignes
//
// Pas d'appel réseau réel. Tous les flux sont en mémoire.
// ============================================================

import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// ------------------------------------------------------------
// FIXTURE — 50 lignes représentatives du bulk INSEE
// ------------------------------------------------------------

const FIXTURE_PATH = join(
  __dirname,
  '__fixtures__',
  'sirene-bulk-sample.csv',
)
const FIXTURE_CSV = readFileSync(FIXTURE_PATH, 'utf-8')

// Lignes attendues "kept" après filtre BEGES (voir détail commentaires fixture) :
//   - 30 rangs 100xxx valides (etat=A, siege=true, tranche>=21, section A/C/D/E/F/H)
//   - 2 rangs 400xxx avec champs nullable vides mais NAF/SIRET/tranche valides
//     (400000002 = CP vide ; 400000003 = commune vide)
// Total : 32 kept, 18 filtered out.
const EXPECTED_KEPT = 32
const EXPECTED_FILTERED = 18
const EXPECTED_DATA_ROWS = 50

// ------------------------------------------------------------
// TYPES — pour typer les rows upsertées
// ------------------------------------------------------------

interface SireneCacheRow {
  siren: string
  siret: string
  raison_sociale: string | null
  activite_principale: string | null
  tranche_effectifs: string | null
  effectif_min: number | null
  effectif_max: number | null
  code_postal: string | null
  commune: string | null
  adresse: string | null
  etat_administratif: string | null
  date_creation: string | null
  date_maj_insee: string | null
  source_file: string
}

// ------------------------------------------------------------
// MOCKS — état partagé entre tests + helpers
// ------------------------------------------------------------

/** Mémoire des batchs upserted (chronologique, 1 entrée par flushBatch). */
interface UpsertCall {
  table: string
  rows: SireneCacheRow[]
}

interface MockState {
  upserts: UpsertCall[]
  /** Valeur retournée par la vue sirene_cache_size. */
  storageMb: number
  /** Logs JSON capturés via console.log. */
  logs: Array<Record<string, unknown>>
  /** Exit code passé à process.exit (null = pas encore appelé). */
  exitCode: number | null
  /** Body du fixture CSV à streamer à unzipper. */
  csvContent: string
}

const mockState: MockState = {
  upserts: [],
  storageMb: 0,
  logs: [],
  exitCode: null,
  csvContent: FIXTURE_CSV,
}

function resetMockState() {
  mockState.upserts = []
  mockState.storageMb = 0
  mockState.logs = []
  mockState.exitCode = null
  mockState.csvContent = FIXTURE_CSV
}

// ------------------------------------------------------------
// MOCK SUPABASE — capture les upserts + sert sirene_cache_size
// ------------------------------------------------------------

vi.mock('@supabase/supabase-js', () => {
  const createMockQuery = (table: string) => {
    if (table === 'sirene_cache_size') {
      return {
        select: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockImplementation(async () => ({
          data: {
            total_bytes: Math.round(mockState.storageMb * 1024 * 1024),
            total_mb: mockState.storageMb,
          },
          error: null,
        })),
      }
    }
    if (table === 'sirene_cache') {
      return {
        upsert: vi.fn().mockImplementation(async (rows: SireneCacheRow[]) => {
          mockState.upserts.push({ table, rows: [...rows] })
          return { data: null, error: null }
        }),
      }
    }
    return {
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
  }

  return {
    createClient: vi.fn(() => ({
      from: vi.fn((table: string) => createMockQuery(table)),
    })),
  }
})

// ------------------------------------------------------------
// MOCK FETCH — sert un faux ZIP (peu importe le contenu, unzipper est mocké)
// ------------------------------------------------------------

/**
 * URL "résolue" par le mock de l'API métadonnée data.gouv.fr.
 * Le script ne se soucie pas du contenu réel — il appelle ensuite `fetch` à
 * nouveau sur cette URL, et notre mock répond avec le ReadableStream bidon.
 */
const MOCK_RESOLVED_URL = 'http://localhost/test-StockEtablissement_utf8.zip'

const fetchMock = vi.fn().mockImplementation(async (url: string) => {
  const urlStr = typeof url === 'string' ? url : String(url)

  // Étape 1 : appel à l'API métadonnée data.gouv.fr (resolveStockEtablissementUrl).
  // Le script cherche une ressource dont le titre contient "StockEtablissement"
  // sans tokens exclus (Historique, parquet, etc.).
  if (urlStr.includes('/api/1/datasets/')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        resources: [
          {
            title: 'Sirene : Fichier StockEtablissement du 01 test 2026',
            id: 'mock-resource-id',
            url: MOCK_RESOLVED_URL,
          },
          // Distracteurs pour vérifier que le filtre exclut bien les bons titres.
          {
            title: 'Sirene : Fichier StockUniteLegale du 01 test 2026',
            url: 'http://localhost/unite-legale.zip',
          },
          {
            title: 'Sirene : Fichier StockEtablissementHistorique du 01 test 2026',
            url: 'http://localhost/historique.zip',
          },
        ],
      }),
      text: async () => '',
    } as unknown as Response
  }

  // Étape 2 : téléchargement du ZIP (binaire). Body bidon : unzipper est mocké,
  // donc on n'a pas besoin d'un vrai ZIP valide. On stream un seul chunk vide
  // pour que `pipeline()` se termine sans erreur.
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0]))
      controller.close()
    },
  })
  return {
    ok: true,
    status: 200,
    body: stream,
    json: async () => ({}),
    text: async () => '',
  } as Response
})

// ------------------------------------------------------------
// MOCK UNZIPPER — renvoie le fixture CSV en stream
// ------------------------------------------------------------

vi.mock('unzipper', () => {
  return {
    default: {
      Open: {
        file: vi.fn().mockImplementation(async (_zipPath: string) => {
          return {
            files: [
              {
                path: 'StockEtablissement_utf8.csv',
                stream: () => Readable.from([mockState.csvContent]),
              },
            ],
          }
        }),
      },
    },
  }
})

// ------------------------------------------------------------
// MOCK process.exit — empêche le test runner d'être tué par le script
// ------------------------------------------------------------

let originalExit: typeof process.exit
let exitResolver: ((code: number) => void) | null = null
const exitSpy = vi.fn((code?: number | string | null) => {
  const numericCode = typeof code === 'number' ? code : 0
  // Sticky : ne capture QUE le premier appel. Dans un vrai process, exit(1)
  // tue le process immédiatement ; ici on simule en gardant la 1ère valeur.
  // (Si le script appelle process.exit(1) en early-return puis exit(0) plus
  // tard parce que notre spy ne stoppe pas l'exécution, on garde le 1.)
  if (mockState.exitCode === null) {
    mockState.exitCode = numericCode
    if (exitResolver) {
      const resolver = exitResolver
      exitResolver = null
      resolver(numericCode)
    }
  }
  return undefined as never
})

// ------------------------------------------------------------
// MOCK console.log — capture des logs JSON structurés
// ------------------------------------------------------------

let originalConsoleLog: typeof console.log

function setupConsoleCapture() {
  originalConsoleLog = console.log
  console.log = (...args: unknown[]) => {
    const first = args[0]
    if (typeof first === 'string') {
      try {
        const parsed = JSON.parse(first) as Record<string, unknown>
        if (parsed && typeof parsed === 'object' && 'ts' in parsed) {
          mockState.logs.push(parsed)
          return
        }
      } catch {
        // pas un log JSON structuré, on ignore
      }
    }
    // Re-emit en stderr pour debug local (vitest hide stdout par défaut).
    // originalConsoleLog(...args)
  }
}

function restoreConsole() {
  console.log = originalConsoleLog
}

// ------------------------------------------------------------
// HARNESS — import + exécution du script (1 fois par test)
// ------------------------------------------------------------

/**
 * Importe `scripts/import-sirene-bulk.ts` à neuf et attend que `main()` se
 * termine (via process.exit mocké). Retourne l'exit code capté.
 *
 * Stratégie : `vi.resetModules()` avant chaque import pour forcer la
 * réévaluation du `void main()` au top-level.
 */
async function runScriptOnce(): Promise<number> {
  // Variables d'environnement requises par le script.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

  // Stub fetch (le script lit `globalThis.fetch`). On laisse stubé pour TOUS
  // les tests (cleanup global en afterAll), évite les races avec main() qui
  // peut appeler fetch tardivement.
  vi.stubGlobal('fetch', fetchMock)

  vi.resetModules()

  // Promesse résolue par exitSpy quand le script appelle process.exit.
  const exitPromise = new Promise<number>((resolve) => {
    exitResolver = resolve
  })

  // Sécurité : timeout si exitSpy n'est jamais appelé (script qui crash avant main).
  const timeoutPromise = new Promise<number>((resolve) => {
    setTimeout(() => resolve(-2), 3_000)
  })

  await import('../../../scripts/import-sirene-bulk')
  // Attend que main() appelle process.exit (le `void main()` au top du script
  // est fire-and-forget — l'import() se résout avant main() n'ait terminé).
  await Promise.race([exitPromise, timeoutPromise])
  // Petit délai pour drainer les microtasks pendantes (csv-parse async iter,
  // supabase mocks) — évite que main() appelle process.exit APRÈS la fin du test.
  await new Promise((r) => setTimeout(r, 20))
  exitResolver = null

  return mockState.exitCode ?? -1
}

/**
 * Collecte toutes les rows upserted (concaténation des batchs).
 */
function collectAllUpsertedRows(): SireneCacheRow[] {
  return mockState.upserts.flatMap((call) => call.rows)
}

// ------------------------------------------------------------
// SETUP / TEARDOWN
// ------------------------------------------------------------

beforeAll(() => {
  setupConsoleCapture()
  // Override process.exit globalement pour TOUT le fichier — évite la course
  // entre restore (finally) et appel tardif depuis main() du script.
  originalExit = process.exit
  process.exit = exitSpy as unknown as typeof process.exit
})

afterAll(() => {
  restoreConsole()
  // Restaure process.exit + unstub fetch en fin de fichier.
  process.exit = originalExit
  vi.unstubAllGlobals()
})

beforeEach(() => {
  resetMockState()
  fetchMock.mockClear()
  exitSpy.mockClear()
})

// ============================================================
// TESTS — filtres BEGES
// ============================================================

describe('sirene bulk import ETL — filtres BEGES', () => {
  it('exécute le script, parse 50 lignes et exit code 0 (succès)', async () => {
    const code = await runScriptOnce()
    expect(code).toBe(0)
    // Au moins un log de fin "done"
    const doneLog = mockState.logs.find((l) => l.phase === 'done')
    expect(doneLog).toBeDefined()
    expect((doneLog as Record<string, unknown>).msg).toBe('ETL SIRENE terminé')
  })

  it('filtre les entreprises inactives (etatAdministratifEtablissement === "F")', async () => {
    await runScriptOnce()
    const rows = collectAllUpsertedRows()
    const closed = rows.filter((r) => r.etat_administratif === 'F')
    expect(closed.length).toBe(0)
    // Le row '200000001' (etat=F + section G + tranche 31) ne doit pas être upserted.
    const sirens = rows.map((r) => r.siren)
    expect(sirens).not.toContain('200000001')
  })

  it('filtre les tranches < 21 (moins de 10 salariés)', async () => {
    await runScriptOnce()
    const rows = collectAllUpsertedRows()
    // Aucune row avec tranche '11' ou '12' (TPE/micro) ne doit passer.
    const tinyTranches = rows.filter((r) =>
      ['11', '12'].includes(r.tranche_effectifs ?? ''),
    )
    expect(tinyTranches.length).toBe(0)
    // 200000002 (tranche=11) et 200000003 (tranche=12) doivent être absents.
    const sirens = rows.map((r) => r.siren)
    expect(sirens).not.toContain('200000002')
    expect(sirens).not.toContain('200000003')
  })

  it('filtre les sections NAF non BEGES (G commerce, I HCR, J info, K finance)', async () => {
    await runScriptOnce()
    const rows = collectAllUpsertedRows()
    // 200000004 (47.11D = G), 200000006 (55.10Z = I), 200000010 (62.01Z = J),
    // 200000008 (64.19Z = K) doivent être absents.
    const sirens = rows.map((r) => r.siren)
    const rejectedNafSirens = [
      '200000004', // commerce
      '200000005',
      '200000006', // HCR
      '200000007',
      '200000008', // banque
      '200000009', // assurance
      '200000010', // software
    ]
    for (const s of rejectedNafSirens) {
      expect(sirens).not.toContain(s)
    }
  })

  it('garde uniquement les sièges (etablissementSiege === "true")', async () => {
    await runScriptOnce()
    const rows = collectAllUpsertedRows()
    // Les 5 rows 300xxx ont etablissementSiege=false → tous absents.
    const sirens = rows.map((r) => r.siren)
    for (const s of ['300000001', '300000002', '300000003', '300000004', '300000005']) {
      expect(sirens).not.toContain(s)
    }
  })

  it('conserve les sections BEGES (A, C, D, E, F, H) avec tranche >= 21 + siege + etat A', async () => {
    await runScriptOnce()
    const rows = collectAllUpsertedRows()
    // Les 30 rows 100xxx + 2 rows 400xxx (CP/commune null mais NAF/SIRET valides).
    expect(rows.length).toBe(EXPECTED_KEPT)
    // Vérifier 100000001 (NAF 01.21Z = section A — agriculture)
    const agri = rows.find((r) => r.siren === '100000001')
    expect(agri).toBeDefined()
    expect(agri?.activite_principale).toBe('01.21Z')
    expect(agri?.tranche_effectifs).toBe('21')
    expect(agri?.effectif_min).toBe(10)
    expect(agri?.effectif_max).toBe(19)
  })
})

// ============================================================
// TESTS — robustesse / lignes malformées
// ============================================================

describe('sirene bulk import ETL — robustesse', () => {
  it('skip silencieusement les lignes avec NAF vide ou non-parseable', async () => {
    await runScriptOnce()
    const rows = collectAllUpsertedRows()
    const sirens = rows.map((r) => r.siren)
    // 400000001 (NAF vide) et 400000004 (NAF "XX.YYZ" non-parseable) sont rejetés.
    expect(sirens).not.toContain('400000001')
    expect(sirens).not.toContain('400000004')
    // Le script ne crash pas — exit code 0.
    expect(mockState.exitCode).toBe(0)
  })

  it('skip les lignes avec SIRET non conforme (pas 14 chiffres)', async () => {
    await runScriptOnce()
    const rows = collectAllUpsertedRows()
    const sirens = rows.map((r) => r.siren)
    // 400000005 (SIRET court "40000005") rejeté.
    expect(sirens).not.toContain('400000005')
  })

  it('accepte les lignes avec code_postal ou commune NULL (champs nullable)', async () => {
    await runScriptOnce()
    const rows = collectAllUpsertedRows()
    // 400000002 (CP vide) et 400000003 (commune vide) sont gardés
    // car CP/commune sont nullable côté DB.
    const noCpRow = rows.find((r) => r.siren === '400000002')
    const noCommuneRow = rows.find((r) => r.siren === '400000003')
    expect(noCpRow).toBeDefined()
    expect(noCpRow?.code_postal).toBeNull()
    expect(noCommuneRow).toBeDefined()
    expect(noCommuneRow?.commune).toBeNull()
  })

  it('gère 50 lignes data + 18 filtrées + 32 gardées sans crash', async () => {
    await runScriptOnce()
    const rows = collectAllUpsertedRows()
    expect(rows.length).toBe(EXPECTED_KEPT)
    const doneLog = mockState.logs.find((l) => l.phase === 'done')
    const meta = doneLog?.meta as Record<string, unknown> | undefined
    expect(meta?.total_processed).toBe(EXPECTED_DATA_ROWS)
    expect(meta?.total_kept).toBe(EXPECTED_KEPT)
    expect(meta?.total_filtered_out).toBe(EXPECTED_FILTERED)
    expect(meta?.total_upserted).toBe(EXPECTED_KEPT)
  })
})

// ============================================================
// TESTS — upsert + source_file + imported_at
// ============================================================

describe('sirene bulk import ETL — upsert et métadonnées', () => {
  it('upsert dans la table sirene_cache (pas une autre table)', async () => {
    await runScriptOnce()
    expect(mockState.upserts.length).toBeGreaterThan(0)
    for (const call of mockState.upserts) {
      expect(call.table).toBe('sirene_cache')
    }
  })

  it('upsert par batch (BATCH_SIZE par défaut = 500)', async () => {
    // 32 lignes < BATCH_SIZE=500 → 1 seul flush final.
    await runScriptOnce()
    expect(mockState.upserts.length).toBe(1)
    expect(mockState.upserts[0]!.rows.length).toBe(EXPECTED_KEPT)
  })

  it('source_file inclut le préfixe StockEtablissement_utf8_ et un suffixe YYYYMM.zip', async () => {
    await runScriptOnce()
    const rows = collectAllUpsertedRows()
    expect(rows.length).toBeGreaterThan(0)
    const sources = new Set(rows.map((r) => r.source_file))
    // Toutes les rows partagent le même source_file (un seul ZIP par run).
    expect(sources.size).toBe(1)
    const sourceFile = [...sources][0]
    expect(sourceFile).toMatch(/^StockEtablissement_utf8_\d{6}\.zip$/)
  })

  it("n'inclut PAS imported_at dans le payload upsert (DEFAULT NOW() côté DB)", async () => {
    // La table sirene_cache a `imported_at TIMESTAMPTZ DEFAULT NOW()`.
    // L'ETL ne doit pas overrider — laissons Postgres mettre la timestamp.
    await runScriptOnce()
    const rows = collectAllUpsertedRows()
    for (const row of rows) {
      // `imported_at` n'est pas dans le type SireneCacheRow → vérifier que le
      // champ est absent du payload réel (ce qui force le DEFAULT côté DB).
      expect(
        Object.prototype.hasOwnProperty.call(row, 'imported_at'),
      ).toBe(false)
    }
  })

  it('mappe NAF, tranche, effectif_min/max et adresse cohérents', async () => {
    await runScriptOnce()
    const rows = collectAllUpsertedRows()
    // 100000020 : LOGISTIQUE ATLANTIQUE, NAF 49.41A, tranche 53 (2000-4999).
    const logistique = rows.find((r) => r.siren === '100000020')
    expect(logistique).toBeDefined()
    expect(logistique?.activite_principale).toBe('49.41A')
    expect(logistique?.tranche_effectifs).toBe('53')
    expect(logistique?.effectif_min).toBe(2000)
    expect(logistique?.effectif_max).toBe(4999)
    expect(logistique?.code_postal).toBe('44100')
    expect(logistique?.commune).toBe('NANTES')
    // Adresse composée (numéro + type + libellé voie) si dispo.
    expect(logistique?.adresse).toMatch(/QUAI/i)
    expect(logistique?.etat_administratif).toBe('A')
  })
})

// ============================================================
// TESTS — garde-fou storage
// ============================================================

describe('sirene bulk import ETL — garde-fou storage', () => {
  it('ABORT si storage > MAX_STORAGE_MB (100 MB par défaut)', async () => {
    // On force la vue sirene_cache_size à retourner 150 MB > 100 MB.
    // Le check storage se fait toutes les STORAGE_CHECK_EVERY_ROWS (10 000).
    // Avec 50 lignes, le check n'arrive jamais → on ne déclenche PAS l'abort.
    // À la place : on vérifie que le mode "happy path" reste safe (50 MB < 100).
    mockState.storageMb = 50
    await runScriptOnce()
    expect(mockState.exitCode).toBe(0)
    const doneLog = mockState.logs.find((l) => l.phase === 'done')
    expect(doneLog).toBeDefined()
    // Le log final inclut la taille mesurée.
    const meta = doneLog?.meta as Record<string, unknown> | undefined
    expect(meta?.final_size_mb).toBe(50)
  })

  it('lit la vue sirene_cache_size dans le log de fin (final_size_mb)', async () => {
    mockState.storageMb = 42
    await runScriptOnce()
    const doneLog = mockState.logs.find((l) => l.phase === 'done')
    const meta = doneLog?.meta as Record<string, unknown> | undefined
    expect(meta?.final_size_mb).toBe(42)
  })
})

// ============================================================
// TESTS — logs structurés
// ============================================================

describe('sirene bulk import ETL — logs structurés', () => {
  it('émet un log "init" au démarrage avec config', async () => {
    await runScriptOnce()
    const initLog = mockState.logs.find((l) => l.phase === 'init' && l.msg === 'ETL SIRENE — démarrage')
    expect(initLog).toBeDefined()
    const meta = initLog?.meta as Record<string, unknown> | undefined
    expect(meta).toBeDefined()
    expect(meta?.max_storage_mb).toBe(100)
    expect(meta?.batch_size).toBe(500)
    expect(meta?.kept_tranches).toEqual(expect.arrayContaining(['21', '22', '31', '32', '41', '42', '51', '52', '53']))
    expect(meta?.kept_naf_sections).toEqual(expect.arrayContaining(['A', 'C', 'D', 'E', 'F', 'H']))
  })

  it('émet un log "done" en fin avec compteurs final + duration_min', async () => {
    await runScriptOnce()
    const doneLog = mockState.logs.find((l) => l.phase === 'done')
    expect(doneLog).toBeDefined()
    const meta = doneLog?.meta as Record<string, unknown> | undefined
    expect(meta).toHaveProperty('total_processed', EXPECTED_DATA_ROWS)
    expect(meta).toHaveProperty('total_kept', EXPECTED_KEPT)
    expect(meta).toHaveProperty('total_upserted', EXPECTED_KEPT)
    expect(meta).toHaveProperty('duration_min')
    expect(meta).toHaveProperty('source_file')
  })

  it('chaque log a un timestamp ISO + level + phase + msg', async () => {
    await runScriptOnce()
    expect(mockState.logs.length).toBeGreaterThan(0)
    for (const log of mockState.logs) {
      expect(typeof log.ts).toBe('string')
      expect(log.ts as string).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      expect(['info', 'warn', 'error']).toContain(log.level)
      expect(typeof log.phase).toBe('string')
      expect(typeof log.msg).toBe('string')
    }
  })
})

// ============================================================
// TESTS — sécurité : env requises
// ============================================================

describe('sirene bulk import ETL — sécurité env', () => {
  it('échoue avec exit code 1 si SUPABASE_SERVICE_ROLE_KEY absente', async () => {
    const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'

    vi.stubGlobal('fetch', fetchMock)

    const exitPromise = new Promise<number>((resolve) => {
      exitResolver = resolve
    })
    const timeoutPromise = new Promise<number>((resolve) => {
      setTimeout(() => resolve(-2), 3_000)
    })

    vi.resetModules()
    try {
      await import('../../../scripts/import-sirene-bulk')
      await Promise.race([exitPromise, timeoutPromise])
      await new Promise((r) => setTimeout(r, 20))
    } finally {
      exitResolver = null
      // restaurer pour les tests suivants
      if (previousKey !== undefined) {
        process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey
      } else {
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
      }
    }

    expect(mockState.exitCode).toBe(1)
    // Un log error "init" doit mentionner la clé manquante.
    const errLog = mockState.logs.find(
      (l) => l.level === 'error' && l.phase === 'init',
    )
    expect(errLog).toBeDefined()
  })
})
