---
name: agent-debugging
description: "Debug du pipeline nocturne (sourcing → scoring → enrichissement → pitch → email). À activer quand l'utilisateur dit : agent ne tourne pas, pas de prospects, scoring bizarre, pas reçu l'email, pipeline cassé."
---

# Skill : Agent Debugging — Pipeline Nocturne

Activé quand l'utilisateur parle de debug du pipeline : "l'agent n'a pas tourné", "pas de prospects générés", "scoring bizarre", "pas reçu l'email matinal", "le cron a échoué".

## Architecture rapide (pour rappel)

Cron 22h → `POST /api/agent/run` → `lib/agent/orchestrator.ts` :
1. **Sourcing** (`sourcing.ts`) : Sirene OAuth2 INSEE → liste entreprises éligibles.
2. **BEGES** (`sourcing.ts` + ADEME) : cross-check si BEGES publié.
3. **Scoring** (`scoring.ts`) : score composite 0-100.
4. **Top 15** non-appelés.
5. **Enrichissement** (`contact-enrichment.ts`) : Recherche Entreprises → Pappers → Hunter (cascade).
6. **Pitch** (`pitch-gen.ts`) : GPT-4o, JSON structuré.
7. **Daily list** (`daily-list-generator.ts`) : INSERT `daily_lists` + `daily_list_items`.

Cron 7h30 → `POST /api/notifications/daily` → email Resend.

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
  - Erreur INSEE 401 → token OAuth2 expiré ou `INSEE_CLIENT_SECRET` rotaté.
  - Pappers 402 / 403 → crédits épuisés.
  - Hunter 429 → quota mensuel 50 atteint.
  - OpenAI 429 → RPM dépassé (batch trop agressif — voir `BATCH_DELAY_MS` dans `pitch-gen.ts`).
  - Resend 422 → email destinataire invalide dans `profiles.notification_email`.

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
| INSEE Sirene | Token OAuth2 expire toutes les 7j | `lib/agent/sourcing.ts` doit re-fetch automatiquement |
| ADEME | Pas de quota public | Endpoint `data.ademe.fr` joignable |
| Recherche Entreprises | Pas de clé, soft rate limit | Logs Sentry sur 429 |
| Pappers | Crédits payants | Dashboard Pappers |
| Hunter | 50 recherches / mois (free) | Dashboard Hunter |
| OpenAI | RPM gpt-4o (~500) | Dashboard OpenAI |
| Resend | 100 emails/j (free) | Dashboard Resend |

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
