// ============================================================
// ESLint flat config — pour ESLint v9 + eslint-config-next 15.2.4
//
// eslint-config-next n'a pas encore migré vers flat config (au 2026-05-14),
// donc on bridge via FlatCompat. Pattern recommandé par Next.js dans la doc :
// https://nextjs.org/docs/app/api-reference/config/eslint#with-eslint-9
// ============================================================

import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

const eslintConfig = [
  ...compat.extends('next/core-web-vitals'),
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'build/**',
      'coverage/**',
      'public/**',
      '.claude/worktrees/**',
      'next-env.d.ts',
    ],
  },
  {
    rules: {
      // Le projet utilise des SVG inline + Tailwind ; on garde des règles strictes
      // mais on autorise les apostrophes non échappées pour le copy FR (sinon
      // chaque "l'agent" devient "l&apos;agent" en JSX, ce qui n'est pas demandé).
      'react/no-unescaped-entities': 'off',
      // Préfère <Link href=…> mais autorise <a> pour les liens externes (mailto, tel).
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
]

export default eslintConfig
