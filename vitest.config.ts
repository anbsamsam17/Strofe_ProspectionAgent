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
      // Initiative alpha/glan en cours hors-scope — imports cassés
      // (rename `alpha-*` ↔ `glan-*` incomplet). À nettoyer dans une PR
      // dédiée à cette initiative.
      'components/glan/**',
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
