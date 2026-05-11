# Code Style — Agent IA Prospection Bilan Carbone

> Règles de style et conventions appliquées sur ce projet.
> Lu par Claude Code à chaque session.

---

## Stack réelle

- Next.js 15 (App Router, Turbopack) + React 19
- TypeScript 5 en mode strict (`tsconfig.json`)
- Tailwind v4 brut via `@tailwindcss/postcss` (pas de shadcn, pas de styled-components)
- Supabase Postgres + Auth via `@supabase/ssr`
- OpenAI SDK (`openai@^4`) — modèle figé `gpt-4o`
- Zod 3 pour la validation aux frontières
- Resend pour l'envoi d'emails
- Sentry pour les erreurs et le monitoring

## Conventions TypeScript

- **Strict mode obligatoire** : `noImplicitAny`, `strictNullChecks` activés.
- **Pas de `any`**. Si le type est inconnu, utiliser `unknown` puis narrower avec un type guard ou `z.parse()`.
- **Pas de `as`** sauf cast sûr et commenté (ex. `as const`, narrowing après check). `as any` interdit, c'est une sentinelle.
- Types partagés dans `lib/types.ts` ; types Supabase générés dans `lib/supabase/database.types.ts`.

## Naming

- `camelCase` pour fonctions, variables, props.
- `PascalCase` pour composants React, types, interfaces, enums.
- `kebab-case` pour les noms de fichiers (`daily-list-generator.ts`).
- `SCREAMING_SNAKE_CASE` pour les constantes au niveau module (`GPT_MODEL`, `BATCH_DELAY_MS`).

## Next.js / React

- **Server Components par défaut**. `'use client'` uniquement si state, effects, event handlers, ou API browser.
- Routes API dans `app/api/<path>/route.ts`, exportant `GET`/`POST`/`PATCH`/`DELETE` nommés.
- Composants React dans `components/` ; logique métier dans `lib/`. Pas de logique fetch dans les composants serveur — extraire dans `lib/`.
- Voir `rules/api-design.md` pour le pattern des routes.

## Imports

Ordre strict, une ligne vide entre groupes :
1. Standard library Node (`crypto`, `fs`).
2. Dépendances externes (`next`, `react`, `zod`, `openai`).
3. Alias projet `@/lib/...`, `@/components/...`.
4. Imports relatifs `./`, `../`.

Pas d'imports non utilisés (lint failure).

## Validation et erreurs

- **Zod aux frontières** : tout body d'API entrant passe par `schema.safeParse()`. Toute donnée externe (Sirene, ADEME, Pappers, Hunter, OpenAI) parsée via un schema.
- Préférer `Result<T, E>` ou exceptions typées explicites. **Jamais** de `catch {}` silencieux ni `catch (e) { /* ignore */ }`.
- Les erreurs sont remontées avec contexte (cause, prospect_id, run_id si dispo) à Sentry.

## Tailwind v4

- Utilisation directe des classes utilitaires dans le JSX.
- `@apply` toléré pour patterns réutilisés (boutons, cards) dans `app/globals.css`, mais pas abusif.
- **Pas de CSS-in-JS**, pas de `styled-components`, pas de `emotion`.

## Style général

- Une fonction = une responsabilité. Idéal < 40 lignes.
- **Pas de magic numbers** : extraire en constante nommée au niveau module (ex. `BATCH_DELAY_MS = 150`).
- **Commentaires : pourquoi, pas quoi.** Le code dit déjà le quoi.
- **Pas de code mort commenté.** Git garde l'historique.
- `TODO` accepté uniquement avec contexte (`// TODO(samir): X parce que Y`).
- Pas de `console.log` en code de prod ; utiliser le logging structuré ou Sentry.

## Lint et type-check

Avant tout commit :
```bash
npm run lint
npm run type-check
npm run test
```
