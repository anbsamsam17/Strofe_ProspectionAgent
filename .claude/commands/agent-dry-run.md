---
description: "Lance l'orchestrateur nocturne en local sans écrire en base."
---

# /agent-dry-run

Tu exécutes le pipeline complet de `lib/agent/orchestrator.ts` en local pour vérifier le bon fonctionnement, SANS persister en base.

## 1. Pré-requis env

Vérifie d'abord que `.env.local` contient :

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY` (`gemini-2.0-flash`, scoring d'intérêt commercial + raisons)
- `INSEE_CLIENT_ID`, `INSEE_CLIENT_SECRET` (token OAuth2 valide 7j)
- `PAPPERS_API_KEY` (optionnel — fallback Recherche Entreprises sinon)
- `HUNTER_API_KEY` (optionnel)

Lance `/sync-env` si tu doutes. Si une clé essentielle (Supabase, INSEE) manque : arrête-toi. Sans `GEMINI_API_KEY`, le scoring Gemini est skippé proprement (fallback), le reste du pipeline tourne.

## 2. Activation du mode dry-run

L'orchestrateur ne contient pas nativement un flag `DRY_RUN`. Pour simuler :

1. Crée un script local `scripts/agent-dry-run.ts` (à ne PAS committer si éphémère) qui :
   - Importe `runAgentNocturne` depuis `@/lib/agent/orchestrator`.
   - Utilise un **mock** de `SupabaseAdminClient` qui retourne `{ data: [], error: null }` sur les SELECT et logge les INSERT/UPDATE sans les exécuter.
   - Ou : pointe sur un schéma Supabase de test (variable `SUPABASE_TEST_SCHEMA`).
2. Passe la variable d'env `DRY_RUN=true` au script et logge dans `lib/agent/orchestrator.ts` un `if (process.env.DRY_RUN === 'true')` qui court-circuite les `updateRunInDB`, `INSERT/UPDATE prospects` (dont la persistance `gemini_score`/`gemini_raisons`), `INSERT daily_list_items` et l'envoi Resend.

Note : si le flag `DRY_RUN` n'est pas encore implémenté dans `lib/agent/orchestrator.ts`, propose à l'utilisateur de l'ajouter d'abord — c'est un changement minimal mais structurel.

## 3. Exécution

1. Lance le script : `npx tsx scripts/agent-dry-run.ts <user_id_test>`.
2. Observe les logs JSON structurés sur stdout. Chaque phase apparaît avec son timestamp :
   - `phase: 'sourcing'` — combien d'entreprises sourcées via Sirene + fallback ?
   - `phase: 'enrichment_beges'` — combien ont un BEGES publié, combien d'obligation_beges ?
   - `phase: 'scoring'` — distribution des scores composites (min/max/médiane).
   - `phase: 'enrichment_contact'` — taux de succès Recherche Entreprises / Pappers / Hunter.
   - `phase: 'scoring_gemini'` — scoring d'intérêt commercial Gemini `gemini-2.0-flash` (`interet_score` + `raisons`), JSON valide.
   - `phase: 'selection'` — le top selon `score_priorite` desc.
3. Sauvegarde la sortie : `npx tsx scripts/agent-dry-run.ts <user_id> > dry-run-$(date +%s).log`.

## 4. Vérifications post-run

1. Aucun crash, aucune erreur Gemini rate-limit (le batch a `GEMINI_BATCH_DELAY_MS=200` et `GEMINI_PARALLEL_GROUP_SIZE=5` dans `lib/agent/gemini-scoring.ts`).
2. Chaque scoring Gemini a la structure attendue (cf. `geminiResponseSchema`) : `interet_score` (entier 0-100) et `raisons` (3 à 5 arguments commerciaux). En cas d'échec : fallback `interet_score: 0` + raison explicative.
3. L'ordre rhétorique des raisons respecte ROI → image → légal (relis le `SYSTEM_PROMPT` dans `lib/agent/gemini-scoring.ts`).
4. Vérifie via Supabase studio que **aucune** nouvelle ligne n'a été créée dans `prospects`, `daily_lists`, `daily_list_items`, `agent_runs`.

## 5. Nettoyage

1. Supprime le script `scripts/agent-dry-run.ts` s'il était éphémère.
2. Retire le flag `DRY_RUN` du code si tu l'avais ajouté ad-hoc — ou garde-le derrière `process.env.NODE_ENV !== 'production'` pour qu'il ne soit jamais activable en prod.
