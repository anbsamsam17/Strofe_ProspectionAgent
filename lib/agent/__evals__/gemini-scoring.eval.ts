// ============================================================
// EVAL HARNESS — Scoring commercial Gemini (gemini-2.0-flash)
//
// Le différenciateur : « je mesure et j'améliore un système LLM ».
//
// Deux modes, sélectionnés automatiquement selon la présence de GEMINI_API_KEY :
//
//   1. MODE OFFLINE (déterministe, CI, SANS clé) — AUCUN appel réseau.
//      - Valide l'intégrité du golden set contre le VRAI schéma Zod de sortie
//        (lib/agent/gemini-scoring.ts → _internal.geminiResponseSchema).
//      - Valide le builder de prompt réel (_internal.buildUserPrompt) :
//        faits réglementaires présents (L. 229-25, seuil 500), AUCUNE PII.
//      - Vérifie les heuristiques de scoring du harness (MAE, within-range,
//        conformité, ordre ROI→image→légal) sur des sorties SIMULÉES, pour
//        garantir que les métriques se comportent correctement.
//
//   2. MODE LIVE (si GEMINI_API_KEY présent) — appelle le vrai modèle sur
//      chaque golden, calcule MAE / within-range / conformité / ordre, écrit
//      un rapport lisible (console + last-report.json).
//      Désactivé en CI car nécessite la clé + réseau.
//
// Lancement : npm run eval:llm
// Méthodologie complète : ./README.md
// ============================================================

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  scoreLeadAvecGemini,
  _internal,
  type GeminiProspectInput,
  type GeminiScoringResult,
} from '@/lib/agent/gemini-scoring'

// ------------------------------------------------------------
// TYPES DU GOLDEN SET
// ------------------------------------------------------------

interface ExpectedReasonProperties {
  /** Au moins une raison référence la taille / l'effectif. */
  mentions_taille_ou_effectif?: boolean
  /** Au moins une raison référence le secteur d'activité. */
  mentions_secteur?: boolean
  /** Au moins une raison référence l'état du BEGES (publié/expiré/absent). */
  mentions_beges_state?: boolean
  /** Au moins une raison référence un signal d'intention fourni. */
  mentions_signaux?: boolean
  /** L'argument gain (ROI/image) doit précéder l'argument légal. */
  roi_or_image_before_legal?: boolean
  /** Aucun vocabulaire alarmiste / superlatif agressif. */
  no_alarmism?: boolean
  /** Nombre min de raisons attendu (défaut RAISONS_MIN du module). */
  min_count?: number
  /** Nombre max de raisons attendu (défaut RAISONS_MAX du module). */
  max_count?: number
}

interface GoldenCase {
  id: string
  label: string
  input: GeminiProspectInput
  expected_score_range: [number, number]
  expected_reason_properties: ExpectedReasonProperties
}

interface GoldenFile {
  version: number
  cases: GoldenCase[]
}

// ------------------------------------------------------------
// CHARGEMENT DU GOLDEN SET
// ------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url))
const GOLDEN_PATH = join(__dirname, '..', '__fixtures__', 'golden-prospects.json')
const REPORT_PATH = join(__dirname, 'last-report.json')

function loadGolden(): GoldenCase[] {
  const raw = readFileSync(GOLDEN_PATH, 'utf-8')
  const parsed = JSON.parse(raw) as GoldenFile
  return parsed.cases
}

// ------------------------------------------------------------
// HEURISTIQUES D'ÉVALUATION DES RAISONS
//
// On ne peut pas demander à un LLM un wording exact. On vérifie donc des
// PROPRIÉTÉS sémantiques via dictionnaires de marqueurs (lexique métier FR).
// ------------------------------------------------------------

const ROI_IMAGE_MARKERS = [
  'roi',
  'retour sur investissement',
  'économie',
  'economies',
  'rentab',
  'subvention',
  'aide',
  'ademe',
  'bpi',
  'financement',
  'coût',
  'cout',
  'marché',
  'marche',
  'appel d\'offre',
  'appels d\'offre',
  'image',
  'marque',
  'réputation',
  'reputation',
  'différenciation',
  'differenciation',
  'concurrent',
  'gouvernance',
  'fournisseur',
  'attractivité',
  'attractivite',
  'employeur',
]

const LEGAL_MARKERS = [
  'l. 229',
  'l.229',
  'l 229',
  '229-25',
  'obligation',
  'légal',
  'legal',
  'loi',
  'amende',
  'sanction',
  'réglementaire',
  'reglementaire',
  'réglementation',
  'reglementation',
  'conformité',
  'conformite',
  'décret',
  'decret',
  'pénalité',
  'penalite',
]

const ALARMISM_MARKERS = [
  'urgent',
  'urgence',
  'danger',
  'menace',
  'risque majeur',
  'catastrophe',
  'immédiatement',
  'immediatement',
  'avant qu\'il ne soit trop tard',
  'sous peine',
  'illégal',
  'illegal',
  'hors-la-loi',
  'sanctionné',
  'sanctionne',
]

const TAILLE_MARKERS = ['salar', 'effectif', 'taille', '500', '250', 'collaborateur']

const BEGES_STATE_MARKERS = [
  'beges',
  'bilan',
  'publié',
  'publie',
  'expiré',
  'expire',
  'jamais',
  'absent',
  'renouvel',
  'à jour',
  'a jour',
  'registre',
  'ademe',
  'scope',
]

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function containsAny(haystack: string, markers: string[]): boolean {
  const n = normalize(haystack)
  return markers.some((m) => n.includes(normalize(m)))
}

/**
 * Indice de la PREMIÈRE raison à contenir un marqueur d'une famille donnée,
 * ou -1 si aucune. Sert à mesurer l'ordre ROI→image→légal.
 */
function firstIndexWith(raisons: string[], markers: string[]): number {
  for (let i = 0; i < raisons.length; i++) {
    if (containsAny(raisons[i], markers)) return i
  }
  return -1
}

interface ReasonCheck {
  property: string
  ok: boolean
}

/**
 * Évalue toutes les propriétés attendues des raisons pour un cas donné.
 * Retourne le détail par propriété (pour le taux de conformité).
 */
function evaluateReasons(
  input: GeminiProspectInput,
  raisons: string[],
  expected: ExpectedReasonProperties,
): ReasonCheck[] {
  const checks: ReasonCheck[] = []
  const joined = raisons.join(' │ ')

  if (expected.mentions_taille_ou_effectif) {
    checks.push({
      property: 'mentions_taille_ou_effectif',
      ok: containsAny(joined, TAILLE_MARKERS),
    })
  }
  if (expected.mentions_secteur) {
    // Le libellé secteur OU un mot-clé sectoriel du libellé doit apparaître.
    const secteurWords = (input.secteur_libelle ?? '')
      .split(/[\s,'/-]+/)
      .filter((w) => w.length >= 5)
    const ok =
      secteurWords.some((w) => normalize(joined).includes(normalize(w))) ||
      containsAny(joined, ['secteur', 'activité', 'activite', 'industrie', 'industriel'])
    checks.push({ property: 'mentions_secteur', ok })
  }
  if (expected.mentions_beges_state) {
    checks.push({
      property: 'mentions_beges_state',
      ok: containsAny(joined, BEGES_STATE_MARKERS),
    })
  }
  if (expected.mentions_signaux) {
    const signalWords = (input.signaux ?? [])
      .flatMap((s) => s.description.split(/[\s,'/-]+/))
      .filter((w) => w.length >= 5)
    const ok =
      signalWords.some((w) => normalize(joined).includes(normalize(w))) ||
      containsAny(joined, ['signal', 'recrut', 'certification', 'label', 'appel d\'offre'])
    checks.push({ property: 'mentions_signaux', ok })
  }
  if (expected.roi_or_image_before_legal) {
    const firstGain = firstIndexWith(raisons, ROI_IMAGE_MARKERS)
    const firstLegal = firstIndexWith(raisons, LEGAL_MARKERS)
    // Ordre respecté si : un gain existe ET (pas de légal OU gain avant légal).
    const ok = firstGain !== -1 && (firstLegal === -1 || firstGain < firstLegal)
    checks.push({ property: 'roi_or_image_before_legal', ok })
  }
  if (expected.no_alarmism) {
    checks.push({
      property: 'no_alarmism',
      ok: !containsAny(joined, ALARMISM_MARKERS),
    })
  }

  return checks
}

// ------------------------------------------------------------
// MÉTRIQUES
// ------------------------------------------------------------

function rangeCenter(range: [number, number]): number {
  return (range[0] + range[1]) / 2
}

interface CaseResult {
  id: string
  score: number
  expected_range: [number, number]
  within_range: boolean
  abs_error: number
  order_respected: boolean | null
  reason_checks: ReasonCheck[]
  reason_conformity: number
  transient_failure: boolean
}

function evaluateCase(c: GoldenCase, result: GeminiScoringResult): CaseResult {
  const center = rangeCenter(c.expected_score_range)
  const within =
    result.interet_score >= c.expected_score_range[0] &&
    result.interet_score <= c.expected_score_range[1]

  const checks = evaluateReasons(c.input, result.raisons, c.expected_reason_properties)
  const orderCheck = checks.find((ch) => ch.property === 'roi_or_image_before_legal')
  const conformity =
    checks.length === 0 ? 1 : checks.filter((ch) => ch.ok).length / checks.length

  return {
    id: c.id,
    score: result.interet_score,
    expected_range: c.expected_score_range,
    within_range: within,
    abs_error: Math.abs(result.interet_score - center),
    order_respected: orderCheck ? orderCheck.ok : null,
    reason_checks: checks,
    reason_conformity: conformity,
    transient_failure: Boolean(result.transient_failure),
  }
}

interface AggregateReport {
  mode: 'live'
  model: string
  generated_at: string
  n_cases: number
  n_scored: number
  mae: number
  within_range_rate: number
  reason_conformity_rate: number
  order_respect_rate: number
  transient_failures: number
  cases: CaseResult[]
}

function aggregate(results: CaseResult[]): AggregateReport {
  const scored = results.filter((r) => !r.transient_failure)
  const n = scored.length || 1

  const mae = scored.reduce((s, r) => s + r.abs_error, 0) / n
  const withinRate = scored.filter((r) => r.within_range).length / n

  const allChecks = scored.flatMap((r) => r.reason_checks)
  const conformityRate =
    allChecks.length === 0
      ? 1
      : allChecks.filter((c) => c.ok).length / allChecks.length

  const orderCases = scored.filter((r) => r.order_respected !== null)
  const orderRate =
    orderCases.length === 0
      ? 1
      : orderCases.filter((r) => r.order_respected === true).length / orderCases.length

  return {
    mode: 'live',
    model: _internal.GEMINI_MODEL,
    generated_at: new Date().toISOString(),
    n_cases: results.length,
    n_scored: scored.length,
    mae: Number(mae.toFixed(2)),
    within_range_rate: Number(withinRate.toFixed(3)),
    reason_conformity_rate: Number(conformityRate.toFixed(3)),
    order_respect_rate: Number(orderRate.toFixed(3)),
    transient_failures: results.length - scored.length,
    cases: results,
  }
}

function printReport(report: AggregateReport): void {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`
  const lines = [
    '',
    '╔══════════════════════════════════════════════════════════════╗',
    '║   EVAL LLM — Scoring commercial Gemini (mode LIVE)            ║',
    '╚══════════════════════════════════════════════════════════════╝',
    `  Modèle              : ${report.model}`,
    `  Cas évalués         : ${report.n_scored}/${report.n_cases} (${report.transient_failures} échecs transitoires exclus)`,
    `  MAE (vs centre)     : ${report.mae} pts`,
    `  Within-range        : ${pct(report.within_range_rate)}`,
    `  Conformité raisons  : ${pct(report.reason_conformity_rate)}`,
    `  Ordre ROI→légal     : ${pct(report.order_respect_rate)}`,
    '  ─────────────────────────────────────────────────────────────',
  ]
  for (const c of report.cases) {
    const flag = c.transient_failure
      ? '⚠ transient'
      : c.within_range
        ? '✓'
        : '✗ hors range'
    lines.push(
      `  ${flag.padEnd(13)} ${c.id.padEnd(38)} score=${String(c.score).padStart(3)} ` +
        `range=[${c.expected_range[0]},${c.expected_range[1]}] ` +
        `conf=${pct(c.reason_conformity)}`,
    )
  }
  lines.push('')
  console.log(lines.join('\n'))
}

// ============================================================
// MODE OFFLINE — DÉTERMINISTE, SANS RÉSEAU (CI)
// ============================================================

const LIVE = Boolean(process.env.GEMINI_API_KEY)

describe('eval/offline — intégrité du golden set & du builder de prompt', () => {
  const cases = loadGolden()

  it('charge un golden set non vide (15-20 cas)', () => {
    expect(cases.length).toBeGreaterThanOrEqual(15)
    expect(cases.length).toBeLessThanOrEqual(20)
  })

  it('les ids sont uniques', () => {
    const ids = new Set(cases.map((c) => c.id))
    expect(ids.size).toBe(cases.length)
  })

  it('chaque expected_score_range est valide (0-100, min<max)', () => {
    for (const c of cases) {
      const [min, max] = c.expected_score_range
      expect(min, c.id).toBeGreaterThanOrEqual(0)
      expect(max, c.id).toBeLessThanOrEqual(100)
      expect(min, c.id).toBeLessThan(max)
    }
  })

  it('le golden set couvre les cas limites (très chaud ET froid)', () => {
    const hasHot = cases.some((c) => c.expected_score_range[0] >= 80)
    const hasCold = cases.some((c) => c.expected_score_range[1] <= 30)
    expect(hasHot, 'au moins un cas très chaud (range bas >= 80)').toBe(true)
    expect(hasCold, 'au moins un cas froid (range haut <= 30)').toBe(true)
  })

  it('chaque input est SANS PII (aucune clé contact_*)', () => {
    for (const c of cases) {
      const keys = Object.keys(c.input)
      for (const k of keys) {
        expect(k.startsWith('contact_'), `${c.id}: clé PII interdite ${k}`).toBe(false)
      }
    }
  })

  it('chaque expected_reason_properties impose 3-5 raisons', () => {
    for (const c of cases) {
      const p = c.expected_reason_properties
      expect(p.min_count ?? 3, c.id).toBeGreaterThanOrEqual(3)
      expect(p.max_count ?? 5, c.id).toBeLessThanOrEqual(5)
    }
  })
})

describe('eval/offline — builder de prompt réel (faits réglementaires + zéro PII)', () => {
  const cases = loadGolden()

  it('chaque prompt contient les faits réglementaires figés (L. 229-25, seuil 500)', () => {
    for (const c of cases) {
      const prompt = _internal.buildUserPrompt(c.input)
      expect(prompt, c.id).toContain('L. 229-25')
      expect(prompt, c.id).toContain('500')
    }
  })

  it('le prompt reflète correctement l\'état BEGES (obligation / publié / expiré)', () => {
    for (const c of cases) {
      const prompt = _internal.buildUserPrompt(c.input)
      if (c.input.obligation_beges) {
        expect(prompt, c.id).toContain('OUI')
      } else {
        expect(prompt, c.id).toContain('NON')
      }
      if (c.input.beges_publie && c.input.beges_valide === false) {
        expect(prompt, c.id).toContain('EXPIRÉ')
      }
      if (!c.input.beges_publie) {
        expect(prompt, c.id).toContain('JAMAIS PUBLIÉ')
      }
    }
  })

  it('AUCUNE PII n\'apparaît dans le prompt (téléphone, @email, nom de contact)', () => {
    // Marqueurs PII qui ne doivent jamais fuiter dans le prompt.
    const phoneRe = /(?:\+33|0)\s?[1-9](?:[\s.-]?\d{2}){4}/
    const emailRe = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i
    for (const c of cases) {
      const prompt = _internal.buildUserPrompt(c.input)
      expect(phoneRe.test(prompt), `${c.id}: téléphone détecté`).toBe(false)
      expect(emailRe.test(prompt), `${c.id}: email détecté`).toBe(false)
    }
  })
})

describe('eval/offline — heuristiques de scoring validées sur sorties simulées', () => {
  const cases = loadGolden()

  it('un output simulé PARFAIT (score au centre + raisons conformes) score 100%', () => {
    const c = cases.find((x) => x.id === 'grande-indus-beges-jamais-publie')
    expect(c).toBeDefined()
    if (!c) return

    // Sortie simulée idéale : score centré, ordre ROI→légal, mentions présentes.
    const simulated: GeminiScoringResult = {
      interet_score: Math.round(rangeCenter(c.expected_score_range)),
      raisons: [
        'Économies opérationnelles : un BEGES identifie 10 à 30 % de réduction sur vos consommations en fonderie.',
        'Image de marque renforcée auprès des donneurs d\'ordre industriels exigeant un fournisseur engagé.',
        'Vos 750 salariés vous placent dans le champ de l\'obligation L. 229-25 : autant la transformer en levier.',
      ],
      generated_at: new Date().toISOString(),
    }
    const res = evaluateCase(c, simulated)
    expect(res.within_range).toBe(true)
    expect(res.abs_error).toBe(0)
    expect(res.order_respected).toBe(true)
    expect(res.reason_conformity).toBe(1)
  })

  it('détecte une INVERSION d\'ordre (légal avant gain)', () => {
    const c = cases.find((x) => x.id === 'grande-indus-beges-jamais-publie')
    expect(c).toBeDefined()
    if (!c) return

    const simulated: GeminiScoringResult = {
      interet_score: Math.round(rangeCenter(c.expected_score_range)),
      raisons: [
        'Vous êtes en infraction à l\'obligation légale L. 229-25, sous peine d\'amende.',
        'Un BEGES dégage ensuite des économies opérationnelles substantielles.',
        'Et améliore votre image de marque.',
      ],
      generated_at: new Date().toISOString(),
    }
    const res = evaluateCase(c, simulated)
    expect(res.order_respected).toBe(false)
  })

  it('détecte de l\'ALARMISME', () => {
    const c = cases[0]
    const simulated: GeminiScoringResult = {
      interet_score: Math.round(rangeCenter(c.expected_score_range)),
      raisons: [
        'Économies possibles sur vos consommations.',
        'Image de marque renforcée.',
        'Agissez immédiatement avant qu\'il ne soit trop tard, c\'est urgent.',
      ],
      generated_at: new Date().toISOString(),
    }
    const checks = evaluateReasons(c.input, simulated.raisons, { no_alarmism: true })
    expect(checks.find((ch) => ch.property === 'no_alarmism')?.ok).toBe(false)
  })

  it('within-range = false quand le score sort de la fourchette', () => {
    const c = cases.find((x) => x.id === 'micro-services-froid-total')
    expect(c).toBeDefined()
    if (!c) return
    const simulated: GeminiScoringResult = {
      interet_score: 95, // beaucoup trop haut pour une micro-entreprise hors obligation
      raisons: ['a'.repeat(10), 'b'.repeat(10), 'c'.repeat(10)],
      generated_at: new Date().toISOString(),
    }
    const res = evaluateCase(c, simulated)
    expect(res.within_range).toBe(false)
    expect(res.abs_error).toBeGreaterThan(50)
  })

  it('les raisons simulées valident le schéma Zod réel du module', () => {
    const good = {
      interet_score: 88,
      raisons: [
        'Économies opérationnelles identifiables par un BEGES.',
        'Image renforcée auprès des donneurs d\'ordre.',
        'Conformité L. 229-25 en appui.',
      ],
    }
    expect(_internal.geminiResponseSchema.safeParse(good).success).toBe(true)

    // 2 raisons seulement → doit échouer (RAISONS_MIN = 3).
    const tooFew = { interet_score: 50, raisons: ['une raison.', 'deux raisons.'] }
    expect(_internal.geminiResponseSchema.safeParse(tooFew).success).toBe(false)

    // Score hors borne → doit échouer.
    const badScore = {
      interet_score: 150,
      raisons: ['aaaaa', 'bbbbb', 'ccccc'],
    }
    expect(_internal.geminiResponseSchema.safeParse(badScore).success).toBe(false)
  })
})

// ============================================================
// MODE LIVE — APPELS RÉELS GEMINI (skip si pas de clé / CI)
// ============================================================

describe.skipIf(!LIVE)('eval/live — scoring réel Gemini sur le golden set', () => {
  it(
    'calcule MAE / within-range / conformité / ordre et écrit last-report.json',
    async () => {
      const cases = loadGolden()
      const results: CaseResult[] = []

      // Séquentiel volontaire : préserve le quota et l'ordre de log lisible.
      for (const c of cases) {
        const scored = await scoreLeadAvecGemini(c.input)
        results.push(evaluateCase(c, scored))
      }

      const report = aggregate(results)
      printReport(report)
      writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8')

      // Garde-fous souples : on documente les seuils sans bloquer brutalement
      // un run d'observation. Ajuster au fil de l'amélioration du prompt.
      expect(report.n_scored, 'au moins la moitié des cas doivent répondre').toBeGreaterThan(
        report.n_cases / 2,
      )
      expect(report.mae, 'MAE attendu < 25 pts vs centre de fourchette').toBeLessThan(25)
      expect(
        report.reason_conformity_rate,
        'conformité des raisons attendue >= 70%',
      ).toBeGreaterThanOrEqual(0.7)
    },
    // Timeout généreux : N appels réseau séquentiels.
    120_000,
  )
})

// ============================================================
// MODE LLM-AS-JUDGE — STUB DOCUMENTÉ (bonus, live uniquement)
//
// Idée : au lieu d'heuristiques lexicales, on demande à un second appel Gemini
// (le « juge ») de noter la qualité commerciale de chaque jeu de raisons sur
// une rubrique (spécificité, ordre des piliers, absence d'alarmisme), en JSON
// structuré + Zod. Avantages : capte la nuance sémantique. Inconvénients :
// coût, variance, besoin d'ancrage (calibration sur quelques exemples notés à
// la main). À activer seulement en mode LIVE, jamais en CI.
//
// Esquisse d'intégration (non câblée pour rester hors réseau par défaut) :
//   const judgePrompt = buildJudgePrompt(case.input, result.raisons)
//   const verdict = await callGeminiJudge(judgePrompt)  // {note:0-10, ordre_ok, alarmisme}
//   report.llm_judge = aggregateJudge(verdicts)
// ============================================================

describe('eval/llm-as-judge — stub documenté', () => {
  it('est documenté mais non actif par défaut (pas de réseau en CI)', () => {
    // Présence d'un placeholder vérifiable : la rubrique du juge est figée ici.
    const JUDGE_RUBRIC = ['specificite', 'ordre_piliers', 'absence_alarmisme'] as const
    expect(JUDGE_RUBRIC).toHaveLength(3)
  })
})
