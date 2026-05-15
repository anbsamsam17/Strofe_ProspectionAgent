// ============================================================
// legacy-copy.test.ts — garde-fou contre régression copy post-pivot
//
// Pivot produit 2026-05-14 (cf memory/project_pivot_glan.md) : l'app a
// abandonné le modèle "15 appels par jour / pitchs Claude Sonnet / livraison
// 7h30" au profit du modèle "sourcing incrémental + pipeline commercial".
//
// Ce test scan les fichiers source visibles utilisateur (pages, composants,
// emails) à la recherche de phrases obsolètes qui ne devraient plus apparaître :
//   - "15 appels" / "15 prospects qualifiés livrés"
//   - "7h30" (la promesse horaire matinale)
//   - "Claude Sonnet" (révélation du LLM dans la copy)
//   - "pitchs sur-mesure" / "pitch personnalisé" / "pitchs GPT-4o"
//   - "votre liste est prête" (formulation old "daily_list")
//
// Si le test échoue, c'est que quelqu'un a réintroduit la copy obsolète.
// Fix : remplacer par la formulation pivot (sourcing incrémental, pipeline
// commercial, scoring 3 piliers, multi-contacts, échanges horodatés).
//
// Hors scope intentionnel :
//   - Comments code (ils peuvent référencer l'historique)
//   - Memory files (.claude/, memory/) — archive
//   - Test files eux-mêmes (peuvent décrire le legacy)
//   - lib/agent/orchestrator.ts (commentaires expliquant la suppression)
//   - lib/types.ts (commentaires @deprecated)
// ============================================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

// Dossiers à scanner — copy visible utilisateur
const SCAN_DIRS = ['app', 'components', 'lib/email']

// Extensions de fichiers concernés
const SCAN_EXTS = new Set(['.tsx', '.ts'])

// Fichiers exclus (chemins relatifs depuis ROOT)
const EXCLUDE_FILES = new Set<string>([
  // Tests eux-mêmes
  'lib/__tests__/legacy-copy.test.ts',
  // Commentaires d'archive
  'lib/agent/orchestrator.ts',
  // Types avec @deprecated comments
  'lib/types.ts',
])

// Sous-arbres à ignorer
const EXCLUDE_PATTERNS = [
  '__tests__',
  '__fixtures__',
  '.test.ts',
  '.test.tsx',
  'node_modules',
  '.next',
  '.claude',
]

// Phrases bannies (regex insensible à la casse).
// On évite les false-positives en exigeant des phrases-mots, pas juste "15".
const FORBIDDEN: { pattern: RegExp; rationale: string }[] = [
  {
    pattern: /15\s*appels\s*(par jour|qualifi[ée]s|du jour|à\s*\d)/i,
    rationale: '"15 appels par jour/qualifiés/du jour/à Xh" — modèle obsolète pré-pivot',
  },
  {
    pattern: /pitchs?\s*(sur[-\s]mesure|personnalis[ée]s?|gpt-?4o?|claude)/i,
    rationale: '"pitchs sur-mesure / personnalisés / GPT-4o / Claude" — génération auto retirée',
  },
  {
    pattern: /Claude\s*Sonnet/i,
    rationale: '"Claude Sonnet" — nom de LLM ne doit pas apparaître dans la copy visible',
  },
  {
    pattern: /à\s*7\s*h\s*30|7h30\s*(chaque|du)\s*matin|livré[es]?\s*à\s*7h30/i,
    rationale: '"7h30 du matin / livré à 7h30" — promesse horaire matinale retirée',
  },
  {
    pattern: /votre\s*liste\s*est\s*prête|liste\s*du\s*jour\s*\d+\s*appels/i,
    rationale: '"votre liste est prête / liste du jour 15 appels" — formulation daily_list pré-pivot',
  },
]

function walk(dir: string, files: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return files
  }
  for (const entry of entries) {
    const abs = join(dir, entry)
    const rel = relative(ROOT, abs)

    if (EXCLUDE_PATTERNS.some((p) => rel.includes(p))) continue

    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walk(abs, files)
    } else if (st.isFile()) {
      const dotIdx = entry.lastIndexOf('.')
      const ext = dotIdx >= 0 ? entry.slice(dotIdx) : ''
      if (SCAN_EXTS.has(ext)) files.push(abs)
    }
  }
  return files
}

function findOffenses(filePath: string): { line: number; text: string; rule: string }[] {
  const rel = relative(ROOT, filePath).replaceAll(sep, '/')
  if (EXCLUDE_FILES.has(rel)) return []

  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    return []
  }

  const offenses: { line: number; text: string; rule: string }[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Skip pure comments (//, /*, *)
    const trimmed = line.trim()
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('* ')
    ) {
      continue
    }

    for (const { pattern, rationale } of FORBIDDEN) {
      if (pattern.test(line)) {
        offenses.push({
          line: i + 1,
          text: line.trim().slice(0, 140),
          rule: rationale,
        })
      }
    }
  }

  return offenses
}

describe('legacy-copy guard (pivot 2026-05-14)', () => {
  it("ne contient plus de copy du modèle obsolète '15 appels / 7h30 / Claude Sonnet / pitchs'", () => {
    const allFiles: string[] = []
    for (const dir of SCAN_DIRS) {
      walk(join(ROOT, dir), allFiles)
    }

    const failures: string[] = []
    for (const file of allFiles) {
      const offenses = findOffenses(file)
      for (const o of offenses) {
        const rel = relative(ROOT, file).replaceAll(sep, '/')
        failures.push(`  ${rel}:${o.line}\n    Règle violée : ${o.rule}\n    Texte : ${o.text}`)
      }
    }

    if (failures.length > 0) {
      const msg = [
        `Régression copy détectée — ${failures.length} occurrence(s) du modèle obsolète "15 appels / 7h30 / Claude Sonnet / pitchs sur-mesure".`,
        '',
        'Détail :',
        ...failures,
        '',
        "Fix : remplacer par la nouvelle promesse pivot — sourcing incrémental Sirene+ADEME, pipeline commercial, scoring 3 piliers transparent.",
        "Cf memory/feedback_glan_persona.md + memory/project_pivot_glan.md pour la persona Glan.",
      ].join('\n')
      throw new Error(msg)
    }

    expect(failures).toHaveLength(0)
  })

  it('scan au moins 30 fichiers source (sanity check)', () => {
    const allFiles: string[] = []
    for (const dir of SCAN_DIRS) {
      walk(join(ROOT, dir), allFiles)
    }
    expect(allFiles.length).toBeGreaterThan(30)
  })
})
