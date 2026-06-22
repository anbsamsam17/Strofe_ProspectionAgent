// =============================================================================
// Configuration Vitest (tests unitaires + couverture)
// -----------------------------------------------------------------------------
// Environnement jsdom, globals actives, setup via ./vitest.setup.ts.
// coverage.include = ['lib/agent/**'] : choix assume (et non un oubli) — la
// couverture est volontairement restreinte a la logique metier critique de
// l'agent (lib/agent), ou les seuils lines/functions a 80 % sont pertinents.
// Etendre l'include diluerait la mesure avec du code UI/glue moins critique.
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
      thresholds: {
        lines: 80,
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
