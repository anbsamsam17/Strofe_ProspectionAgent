// =============================================================================
// Configuration Vitest dédiée à l'EVAL HARNESS LLM (npm run eval:llm)
// -----------------------------------------------------------------------------
// Le harness vit dans des fichiers `*.eval.ts` (lib/agent/__evals__/), qui ne
// matchent PAS le glob include par défaut de vitest (`*.{test,spec}.ts`). Ils
// sont donc IGNORÉS par `npm run test` (la CI unitaire) — c'est voulu : un run
// d'éval (potentiellement réseau en mode live) ne doit pas se mélanger aux tests
// unitaires ni peser sur les seuils de couverture.
//
// Cette config sert exclusivement à `npm run eval:llm`. Pas de coverage, pas de
// setup jsdom (le harness est du Node pur : fs, fetch Gemini en mode live).
// =============================================================================

import path from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['lib/agent/__evals__/**/*.eval.ts'],
    // Pas de coverage ici : l'éval mesure la QUALITÉ du LLM, pas la couverture.
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
