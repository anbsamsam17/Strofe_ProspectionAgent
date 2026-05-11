---
description: "Workflow correction de bug avec test rouge avant fix et non-régression pipeline."
argument-hint: "<description du bug ou ID Sentry>"
---

# /fix-issue

Tu corriges un bug sur l'agent de prospection BEGES. Argument : `$ARGUMENTS` (description ou ID Sentry).

## 1. Récupération du contexte

1. Si l'argument est un ID/lien Sentry : consulte l'issue sur dashboard Sentry pour récupérer stack trace, breadcrumbs, user_id concerné, route affectée. Note la fréquence et la première occurrence.
2. Sinon : lis les logs JSON de l'orchestrateur (`console.log` JSON structuré dans `lib/agent/orchestrator.ts`) ou la table `agent_runs.logs` pour la run incriminée.
3. Identifie la **cause racine**, pas le symptôme. Liste les fichiers impliqués avec leur chemin absolu.

## 2. Reproduction locale

1. Reproduis le bug dans `npm run dev`. Si c'est une route API, utilise `curl` ou un client HTTP avec la session Supabase.
2. Si le bug est dans l'orchestrateur nocturne : lance `/agent-dry-run` pour rejouer le pipeline sans toucher la BDD.
3. Confirme que tu vois le même comportement que celui rapporté.

## 3. Test rouge AVANT fix

1. Écris un test Vitest qui **échoue** sur le comportement bugué. Place-le dans `lib/**/__tests__/` à côté du fichier source (ex: `lib/agent/__tests__/scoring.test.ts`).
2. Lance `npm run test -- <pattern>` et vérifie que le test échoue pour la bonne raison (assertion, pas erreur d'import).
3. Si le bug est dans une route API : préfère un test unitaire sur la fonction extraite plutôt qu'un test d'intégration HTTP.

## 4. Fix minimal

1. Applique le changement le plus petit possible qui rend le test vert.
2. Ne modifie pas le style/format autour. Pas de refactoring opportuniste.
3. Respecte les invariants du repo : pas de `any`, pas de filter user_id manquant, pas d'import service_role côté client.
4. Si le fix demande un refactoring de plus de ~50 lignes : arrête-toi et signale-le à l'utilisateur avant de continuer.

## 5. Validation

1. `npm run test` — le nouveau test passe, aucun ancien test ne casse.
2. `npm run type-check` — zéro erreur TS.
3. Si le fix touche `lib/agent/orchestrator.ts`, `lib/agent/sourcing.ts`, `lib/agent/scoring.ts`, `lib/agent/pitch-gen.ts` ou `lib/agent/contact-enrichment.ts` : lance `/agent-dry-run` pour vérifier que le pipeline complet tourne toujours bout en bout sans crash.
4. Si le fix touche une route API : `curl` la route en local avec un payload valide ET un payload invalide (Zod doit toujours rejeter proprement).

## 6. Documentation

1. Commit message : `fix(<scope>): <résumé court>` — mentionne l'ID Sentry si applicable.
2. Si la leçon est réutilisable (ex: piège récurrent sur Supabase RLS, OpenAI rate limit, etc.) : ajoute une entrée dans `memory/hindsight.md`.
3. Ne ferme l'issue Sentry qu'après le déploiement (`/deploy`) et confirmation que l'erreur ne réapparaît pas pendant 24h.
