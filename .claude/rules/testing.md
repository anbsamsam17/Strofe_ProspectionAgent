# Testing — Agent IA Prospection Bilan Carbone

> Standards de test pour ce projet.
> Claude Code applique ces conventions dans tous les tests générés.

---

## Stack

- **Vitest 3** comme runner (`vitest.config.ts`).
- **jsdom** pour les tests React (`vitest.setup.ts`).
- **@testing-library/react** + `@testing-library/jest-dom` pour les composants.
- Mocks via `vi.mock()` (modules) et `vi.fn()` (fonctions).
- Coverage via `@vitest/coverage-v8` (`npm run test:coverage`).

## Philosophie

- **Teste le comportement, pas l'implémentation.** Un refacto interne ne doit pas casser les tests.
- AAA pattern : Arrange → Act → Assert.
- Un test = un seul concept vérifié. Les noms de test décrivent l'attente métier.
- Tests doivent tourner offline et de façon déterministe.

## Organisation des fichiers

- Tests unitaires à côté du fichier testé : `lib/agent/scoring.ts` → `lib/agent/__tests__/scoring.test.ts`, ou `scoring.test.ts` à côté.
- Tests de composants : `components/foo.tsx` → `components/foo.test.tsx`.
- Pas de dossier `tests/` séparé à la racine pour les unit tests.

## Mock systématique des APIs externes

**Jamais d'appel réel** en test vers :
- Sirene / INSEE (OAuth2 + recherche entreprises)
- ADEME (publications BEGES)
- Recherche Entreprises (api.gouv.fr)
- Pappers
- Hunter.io
- OpenAI (gpt-4o)
- Resend

Pattern :
```ts
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn().mockResolvedValue(/* fixture */) } },
  })),
}))
```

Stocker les fixtures (réponses Sirene, ADEME, etc.) en dur dans le test ou dans un fichier `__fixtures__/` adjacent. Ne pas fetcher de "vraie" réponse en CI.

## Supabase en test

- Pour les tests unitaires : mock `createClient` de `lib/supabase/server.ts` ou `lib/supabase/client.ts` avec un objet retournant des chainables `.from().select().eq().single()`.
- Pour les tests d'intégration de routes API : utiliser un schema test ou le mock complet. Pas de tap dans la prod Supabase.

## Orchestrateur

`lib/agent/orchestrator.ts` est testé **phase par phase**, pas en bout en bout :
- `sourcing.ts` isolé (input synthétique → liste prospects attendue).
- `scoring.ts` isolé (input prospect → score 0-100 — voir `__tests__/scoring.test.ts`).
- `contact-enrichment.ts` isolé (cascade Recherche Entreprises → Pappers → Hunter, chaque source mockée).
- `pitch-gen.ts` isolé (mock OpenAI, vérifier que le pitch suit l'ordre obligatoire — cf. `rules/llm-prompts.md`).
- `daily-list-generator.ts` isolé (insertion `daily_lists` + `daily_list_items`).

Un test E2E orchestrateur peut exister, mais il enchaîne les mocks — il ne sert qu'à vérifier le câblage.

## Ce qui doit toujours être testé

- Cas nominal.
- Cas limite : liste vide, score 0, score 100, prospect sans email, prospect sans téléphone.
- Cas d'erreur : API externe down (timeout, 500), quota dépassé (429), token INSEE expiré.
- Sécurité : auth Bearer cron (token valide / invalide / absent / longueur différente), validation Zod (body malformé).
- RLS implicite : un utilisateur ne récupère pas les prospects d'un autre (test d'intégration côté Supabase).

## Ce qu'on évite

- **Pas de snapshot tests** sur HTML/JSX (trop fragile, n'apporte rien sur du Tailwind).
- Pas de `setTimeout` réel — utiliser `vi.useFakeTimers()`.
- Pas de tests qui dépendent de l'ordre d'exécution.

## Coverage cible

- `lib/agent/` (cœur métier) : **70%** minimum.
- Reste du projet : **50%** minimum.
- Fonctions critiques (`isCronRequest`, scoring, pitch gen) : couvrir tous les cas d'erreur.

## Commandes

```bash
npm run test            # CI, exit après run
npm run test:watch      # dev, watch mode
npm run test:coverage   # rapport coverage v8
```

## Avant de marquer une tâche terminée

`npm run test` doit passer en vert. Coverage ne doit pas régresser sur `lib/agent/`.
