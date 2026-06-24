---
name: agent-debugging
description: "Debug du pipeline nocturne (sourcing → scoring déterministe → enrichissement → scoring commercial Gemini → pipeline commercial). À activer quand l'utilisateur dit : agent ne tourne pas, pas de prospects, scoring bizarre, scoring Gemini KO, pipeline cassé."
---

# Skill : Agent Debugging — Pipeline Nocturne

Activé quand l'utilisateur parle de debug du pipeline : "l'agent n'a pas tourné", "pas de prospects générés", "scoring bizarre", "le scoring Gemini renvoie 0", "le cron a échoué".

## Architecture rapide (pour rappel)

Cron 22h → `POST /api/agent/run` → `lib/agent/orchestrator.ts` :
1. **Sourcing adaptatif** (`sourcing.ts` / `sourcing-runner.ts`) : Sirene INSEE par curseur (API Key) → liste entreprises éligibles. Fallback Recherche Entreprises gouv.
2. **BEGES** (ADEME) : cross-check si BEGES publié (`beges_publie` / `beges_valide`).
3. **Scoring déterministe** (`scoring.ts`) : score composite 0-100, `statut = score >= 20 ? 'qualified' : 'sourced'`.
4. **Upsert `prospects`** (`onConflict: 'user_id,siren'`).
5. **Enrichissement contact** (`contact-enrichment.ts`) : Recherche Entreprises → Pappers → Hunter (cascade).
6. **Scoring commercial Gemini** (`gemini-scoring.ts`) : `gemini-2.0-flash`, intérêt 0-100 + 3-5 raisons d'appel, structured output + Zod → `UPDATE prospects` (`gemini_interet_score`, `gemini_raisons`, `gemini_generated_at`).

Pas de génération de « liste de 15 appels/jour » depuis le pivot du 2026-05-14 : les prospects qualifiés alimentent le pipeline commercial (statut CRM). Les tables `daily_lists` / `daily_list_items` ont été supprimées (migration 014).

## Étape 1 : Lire `agent_runs`

Toujours commencer ici. Cette table loggue chaque run avec ses phases :

```sql
SELECT id, started_at, finished_at, status, current_phase, error_message
FROM agent_runs
ORDER BY started_at DESC
LIMIT 5;
```

- `status = 'failed'` : voir `error_message` + `current_phase` pour savoir où ça a cassé.
- `status = 'running'` depuis > 1h : run probablement bloqué (timeout Vercel à 300s sur les serverless functions hors cron — vérifier `vercel.json`).
- Pas de row pour aujourd'hui : le cron Vercel n'a pas tiré. Voir étape 2.

## Étape 2 : Vercel Crons

- Dashboard Vercel → Project → Crons.
- Les deux crons (`0 22 * * *` et `30 7 * * *`) doivent être actifs.
- Si désactivés (free tier limit, désactivation manuelle) → réactiver.
- Logs Vercel → Functions → filtrer sur `/api/agent/run` pour voir si l'invocation a eu lieu et son code retour.

## Étape 3 : Sentry

- Filtrer sur `route:/api/agent/run` ou `route:/api/notifications/daily`.
- Filtrer sur les 24 dernières heures.
- Pattern fréquents :
  - Erreur INSEE 401 / 403 → `INSEE_API_KEY` invalide, rotatée, ou app non abonnée à l'API Sirene (depuis sept. 2025 : API Key, plus d'OAuth2).
  - Pappers 402 / 403 → crédits épuisés.
  - Hunter 429 → quota mensuel atteint.
  - Gemini 429 / timeout → quota/RPM dépassé. Le scoring fait 1 retry puis fallback `transient_failure` (`gemini_generated_at` laissé NULL → re-tenté au prochain run). Voir `GEMINI_BATCH_DELAY_MS` / `GEMINI_PARALLEL_GROUP_SIZE` dans `gemini-scoring.ts`.
  - Resend 422 → email destinataire invalide dans `profiles.settings.notification_email`.

## Étape 4 : Test isolé d'une phase

Pour reproduire localement la phase qui a cassé, sans rejouer tout le pipeline :

```bash
# Sourcing seul (route dédiée)
curl -X POST http://localhost:3000/api/agent/sourcing \
  -H "Authorization: Bearer $CRON_SECRET"

# Status du dernier run (lecture seule)
curl http://localhost:3000/api/agent/status \
  -H "Authorization: Bearer $CRON_SECRET"
```

Pour les autres phases : importer la fonction depuis `lib/agent/<phase>.ts` dans un script `scripts/`, l'appeler avec un input fixture.

## Étape 5 : Quotas et tokens

| Source | Quota | Comment vérifier |
|---|---|---|
| INSEE Sirene | API Key (depuis sept. 2025, plus d'OAuth2), ~30 req/min plan gratuit | `lib/agent/sourcing.ts` (`getInseeApiKey`) ; app abonnée à l'API Sirene sur portail-api.insee.fr |
| ADEME | Pas de quota public | Endpoint `data.ademe.fr` joignable |
| Recherche Entreprises | Pas de clé, soft rate limit (~7 req/s) | Logs Sentry sur 429 |
| Pappers | Crédits payants | Dashboard Pappers |
| Hunter | ~25 recherches / mois (free) | Dashboard Hunter |
| Gemini | `gemini-2.0-flash` : ~30 req/min, ~1500 req/jour (free) | Dashboard Google AI Studio |
| Resend | 3 000 emails/mois (free) | Dashboard Resend |

## Étape 6 : Dry-run local

Pour rejouer sans écrire en DB ni envoyer d'email :

```bash
DRY_RUN=true npm run dev
```

(Vérifier que `lib/agent/orchestrator.ts` respecte `process.env.DRY_RUN`. Sinon, c'est une amélioration à proposer.)

## Étape 7 : Si toujours bloqué

- Comparer le dernier run KO au dernier run OK (`agent_runs`).
- Diff des migrations Supabase depuis le dernier run OK.
- Diff git depuis le dernier deploy OK.
- Si tout pointe vers une API externe down : attendre + replanifier manuellement (`POST /api/agent/run` avec Bearer).

Logger les findings dans `memory/hindsight.md`.
