#!/usr/bin/env node
// ============================================================
// check-glan-banned-terms.mjs
//
// Garde anti-régression : détecte les termes bannis du persona Glan
// dans les fichiers source visibles utilisateur (app/, components/, lib/).
//
// Usage :
//   node scripts/check-glan-banned-terms.mjs
//
// Exit 0 si aucun hit, exit 1 si au moins un hit.
// Output format : path:line: <match>
//
// Source des termes bannis : docs/copy/glan-copy-refonte.md + memory/feedback_glan_persona.md
// ============================================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')

// ── Dossiers à scanner ─────────────────────────────────────────────────── //
const SCAN_DIRS = ['app', 'components', 'lib', 'docs/copy']

// ── Extensions concernées ──────────────────────────────────────────────── //
const SCAN_EXTS = new Set(['.tsx', '.ts', '.md'])

// ── Sous-arbres et fichiers à exclure ─────────────────────────────────── //
// Les tests peuvent décrire les bannis → toujours exclus.
// Les fichiers techniques de l'orchestrateur peuvent citer GPT-4o → exclus.
const EXCLUDE_PATH_FRAGMENTS = [
  '__tests__',
  '.test.ts',
  '.test.tsx',
  'node_modules',
  '.next',
  '.git',
  '.claude',
]

// Fichiers exclus spécifiquement (chemin relatif depuis ROOT, slash forward)
const EXCLUDE_FILES = new Set([
  'lib/agent/orchestrator.ts',
  // Le doc copy cite explicitement les termes bannis dans un tableau "Avant → Après"
  // → il est la source de vérité, pas une régression.
  'docs/copy/glan-copy-refonte.md',
])

// Exclusion des dossiers docs/ sauf docs/copy/
function isExcludedDocPath(relPath) {
  if (relPath.startsWith('docs/') && !relPath.startsWith('docs/copy/')) {
    return true
  }
  return false
}

// ── Termes bannis ─────────────────────────────────────────────────────── //
// Chaque entrée : { pattern: RegExp, label: string, note?: string }
// Les patterns sont case-insensitive sauf mention contraire.
const BANNED_TERMS = [
  {
    pattern: /\b22h\b/,
    label: '22h (heure cron bannie de la copy)',
  },
  {
    pattern: /chaque\s+nuit/i,
    label: 'chaque nuit (temporalité nocturne bannie)',
  },
  {
    pattern: /campagne\s+nocturne/i,
    label: 'campagne nocturne (formulation pré-pivot)',
  },
  {
    pattern: /dort\s+la\s+nuit/i,
    label: 'dort la nuit (métaphore de sommeil bannie)',
  },
  {
    pattern: /pitch\s+sur[-\s]mesure/i,
    label: 'pitch sur-mesure (génération auto retirée)',
  },
  {
    // GPT-4o est autorisé dans les fichiers techniques de l'orchestrateur
    // (exclus via EXCLUDE_FILES), mais pas dans la copy UI ou composants.
    pattern: /GPT-4o/,
    label: 'GPT-4o (nom de modèle banni de la copy)',
  },
  {
    pattern: /Claude\s+Sonnet/i,
    label: 'Claude Sonnet (nom de LLM banni de la copy)',
  },
  {
    pattern: /Powered\s+by\s+AI/i,
    label: 'Powered by AI (formulation bannie)',
  },
  {
    pattern: /pitchs?\s+g[eé]n[eé]r[eé]s?/i,
    label: 'pitchs générés (génération auto bannie de la copy)',
  },
  {
    pattern: /r[eé]ponses?\s+aux\s+objections/i,
    label: 'réponses aux objections (feature retirée du pivot)',
  },
]

// ── Walker ────────────────────────────────────────────────────────────── //

function walk(dir, files = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return files
  }
  for (const entry of entries) {
    const abs = join(dir, entry)
    const rel = relative(ROOT, abs).replaceAll('\\', '/')

    if (EXCLUDE_PATH_FRAGMENTS.some((frag) => rel.includes(frag))) continue
    if (isExcludedDocPath(rel)) continue

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

// ── Scanner ───────────────────────────────────────────────────────────── //

function scanFile(filePath) {
  const rel = relative(ROOT, filePath).replaceAll('\\', '/')
  if (EXCLUDE_FILES.has(rel)) return []

  let content
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    return []
  }

  const hits = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Ignorer les lignes qui sont uniquement des commentaires code
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*')
    ) {
      continue
    }

    for (const { pattern, label } of BANNED_TERMS) {
      if (pattern.test(line)) {
        hits.push({
          file: rel,
          line: i + 1,
          text: trimmed.slice(0, 120),
          label,
        })
      }
    }
  }

  return hits
}

// ── Main ──────────────────────────────────────────────────────────────── //

const allFiles = []
for (const dir of SCAN_DIRS) {
  walk(join(ROOT, dir), allFiles)
}

const allHits = []
for (const file of allFiles) {
  allHits.push(...scanFile(file))
}

if (allHits.length > 0) {
  for (const hit of allHits) {
    process.stdout.write(`${hit.file}:${hit.line}: [${hit.label}]\n  ${hit.text}\n`)
  }
  process.stderr.write(`\n${allHits.length} terme(s) banni(s) trouvé(s). Corrigez avant de déployer.\n`)
  process.exit(1)
} else {
  process.stdout.write('OK — aucun terme banni détecté.\n')
  process.exit(0)
}
