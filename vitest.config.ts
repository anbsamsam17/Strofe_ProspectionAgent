// =============================================================================
// Configuration Vitest (tests unitaires + couverture)
// -----------------------------------------------------------------------------
// Environnement jsdom, globals actives, setup via ./vitest.setup.ts.
// coverage.include = ['lib/agent/**'] : choix assume (et non un oubli) — la
// couverture est volontairement restreinte a la logique metier critique de
// l'agent (lib/agent). Etendre l'include diluerait la mesure avec du code
// UI/glue moins critique.
// coverage.exclude = ['lib/agent/__evals__/**'] : l'eval harness LLM a son
// propre runner (vitest.evals.config.ts, `npm run eval:llm`) et ne doit pas
// peser sur la couverture unitaire (cf. commentaire de vitest.evals.config.ts).
// Seuil lines a 70 : calé sur la couverture reellement mesurée sur main
// (73 % en 2026-08 — orchestrator.ts, non couvert, est le prochain chantier
// de tests ; remonter le seuil vers 80 quand il le sera).
// =============================================================================

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '.claude/worktrees/**',
      // Rename alpha→glan terminé (LOT 1 du pivot 2026-05-14) — exclusion levée.
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['lib/agent/**'],
      exclude: ['lib/agent/__evals__/**'],
      thresholds: {
        lines: 70,
        functions: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
