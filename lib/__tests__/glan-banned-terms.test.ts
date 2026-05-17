// ============================================================
// glan-banned-terms.test.ts — garde anti-régression termes bannis Glan
//
// Ce test exécute le script check-glan-banned-terms.mjs et vérifie que
// seuls les fichiers pré-existants (non traités par Phase 2) contiennent
// des termes bannis.
//
// Logique :
//   - On exécute le script via child_process.spawnSync.
//   - On parse la sortie stdout pour extraire les chemins de fichiers touchés.
//   - On compare avec KNOWN_LEGACY_FILES : les fichiers qui contiennent des
//     termes bannis AVANT que Phase 3+ les corrige.
//   - Le test échoue si un fichier HORS de cette liste apparaît dans la sortie.
//
// Pour marquer un fichier comme corrigé : le retirer de KNOWN_LEGACY_FILES.
// Si le script détecte un nouveau hit hors liste → régression → CI rouge.
//
// Fichiers pré-existants connus (état au 2026-05-17, Phase 2 terminée) :
//   - app/(auth)/layout.tsx           — "chaque nuit"
//   - app/(auth)/onboarding/page.tsx  — "chaque nuit"
//   - app/(auth)/signup/page.tsx      — "chaque nuit"
//   - components/glan/glan-status-bar.tsx — "22h"
//   - components/ui/empty-state.tsx   — "campagne nocturne", "22h"
//   - lib/email/templates/daily-list-ready.tsx — "22h"
//   - lib/email/templates/welcome.tsx — "chaque nuit", "pitchs générés"
// ============================================================

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const ROOT = process.cwd()
const SCRIPT = join(ROOT, 'scripts', 'check-glan-banned-terms.mjs')

// Fichiers dont on accepte encore des occurrences bannies (migration en attente).
// Format : chemin relatif depuis ROOT avec slash forward.
// Pour "corriger" un fichier : le retirer de cette liste et corriger le fichier.
const KNOWN_LEGACY_FILES = new Set([
  'app/(auth)/layout.tsx',
  'app/(auth)/onboarding/page.tsx',
  'app/(auth)/signup/page.tsx',
  'components/glan/glan-status-bar.tsx',
  'components/ui/empty-state.tsx',
  'lib/email/templates/daily-list-ready.tsx',
  'lib/email/templates/welcome.tsx',
])

describe('glan-banned-terms — garde anti-régression copy persona', () => {
  it('aucun fichier HORS liste legacy ne contient de terme banni', () => {
    // Arrange + Act — exécuter le script
    const result = spawnSync('node', [SCRIPT], {
      cwd: ROOT,
      encoding: 'utf-8',
    })

    // Si exit 0 : aucun banni → test passe immédiatement
    if (result.status === 0) {
      expect(result.status).toBe(0)
      return
    }

    // Exit 1 : des bannis ont été trouvés. On parse la sortie pour identifier
    // les fichiers touchés et les comparer à la liste legacy connue.
    const stdout = result.stdout ?? ''
    const hitLines = stdout.split('\n').filter((l) => l.match(/^[a-zA-Z(].*:\d+:/))

    // Extraire les chemins (format : "path/to/file.tsx:42: [label]")
    const hitFiles = new Set(
      hitLines.map((l) => {
        const match = l.match(/^([^:]+):\d+:/)
        return match ? match[1].trim() : ''
      }).filter(Boolean),
    )

    // Déterminer les fichiers contaminés hors liste legacy
    const newOffenders = [...hitFiles].filter((f) => !KNOWN_LEGACY_FILES.has(f))

    if (newOffenders.length > 0) {
      const detail = newOffenders.map((f) => {
        const lines = hitLines.filter((l) => l.startsWith(f))
        return `  ${f}\n${lines.map((l) => `    ${l}`).join('\n')}`
      }).join('\n')

      throw new Error(
        [
          `${newOffenders.length} nouveau(x) fichier(s) contiennent des termes bannis persona Glan :`,
          detail,
          '',
          'Fix : supprimer les occurrences bannies (cf docs/copy/glan-copy-refonte.md)',
          'ou ajouter le fichier à KNOWN_LEGACY_FILES si la correction est planifiée.',
        ].join('\n'),
      )
    }

    // Seuls des fichiers legacy connus → on tolère, test passe
    // (on documente les legacy restants en information)
    const legacyHit = [...hitFiles].filter((f) => KNOWN_LEGACY_FILES.has(f))
    if (legacyHit.length > 0) {
      // Note informative — pas un échec tant que les fichiers sont dans la liste
      // On n'utilise pas console.log (règle code-style.md) mais on laisse passer.
    }

    expect(newOffenders).toHaveLength(0)
  })

  it('le script est exécutable et retourne un code de sortie 0 ou 1', () => {
    // Sanity check : le script tourne sans crash (exit 2 = erreur Node)
    const result = spawnSync('node', [SCRIPT], {
      cwd: ROOT,
      encoding: 'utf-8',
    })

    // Le statut doit être 0 (aucun banni) ou 1 (bannis trouvés, attendus)
    // mais jamais 2+ (erreur Node / fichier introuvable)
    expect(result.status).toBeLessThanOrEqual(1)
    expect(result.error).toBeUndefined()
  })
})
