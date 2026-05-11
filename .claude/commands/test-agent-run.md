---
description: "Test bout-en-bout du pipeline agent nocturne en local (écrit en base)."
---

# /test-agent-run

Tu testes le pipeline complet (sourcing → enrichissement → scoring → contacts → pitch → email). **Cette commande ÉCRIT en base** — pour un test sans persistance, utilise `/agent-dry-run`.

## 1. Pré-requis

1. `.env.local` complet (lance `/sync-env`).
2. `npm run dev` lancé dans un terminal séparé.
3. Un user de test `onboarded = true` avec `settings` renseignés (`target_sectors`, `target_city`/`target_postal_codes`, `daily_call_target`).
4. Aucun run actif pour cet user (sinon 409, cf. `app/api/agent/run/route.ts:~228`).

## 2. Récupération du CRON_SECRET

Sans afficher la valeur :

PowerShell : `$secret = (Get-Content .env.local | Select-String '^CRON_SECRET=').ToString().Split('=', 2)[1]`

Bash : `export CRON_SECRET=$(grep '^CRON_SECRET=' .env.local | cut -d'=' -f2-)`

## 3. Déclenchement

Mode cron (tous les users `onboarded = true`, lance `runSourcing` en parallèle) :

```bash
curl -X POST http://localhost:3000/api/agent/run \
  -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json"
```

Mode manuel (un user via session, lance `runAgentNocturne` = sourcing + daily list) — login via UI puis :

```bash
curl -X POST http://localhost:3000/api/agent/run -H "Cookie: <cookies-supabase>" -d '{}'
```

## 4. Observation des logs

Logs JSON structurés sur stdout. Phases attendues :

1. `sourcing` — INSEE + fallback Recherche Entreprises (~200 prospects).
2. `enrichment_beges` — batches de 20 vers data.ademe.fr.
3. `scoring` — `lib/agent/scoring.ts`. Top 15 attendus > 50.
4. `selection` — top 15 non-appelés.
5. `enrichment_contact` — cascade Recherche Entreprises → Pappers → Hunter.
6. `pitch_gen` — 15 pitchs gpt-4o (~30-60s, `BATCH_DELAY_MS=150`, `PARALLEL_GROUP_SIZE=5`).
7. `completed` — `status = 'completed'`, `list_generated = true`.

Si erreur : `level: 'error'`, `status: 'failed'`, `error_message` rempli.

## 5. Vérification en BDD (Supabase studio)

1. `agent_runs` : `status = 'completed'`, `prospects_sourced ~200`, `list_generated = true`, `completed_at` set.
2. `prospects` : nouvelles lignes, certaines avec `beges_publie = true`, `obligation_beges = true`, `score_priorite > 50`.
3. `daily_lists` : ligne du jour, `status = 'ready'`, `generated_at` set, `notified_at` null.
4. `daily_list_items` : 15 lignes liées, `accroche`, `pitch`, `objections_reponses[]`, `ordre` 1-15.

## 6. Test de la notification email

```bash
curl -X POST http://localhost:3000/api/notifications/daily \
  -H "Authorization: Bearer $CRON_SECRET"
```

Vérifie : (a) email reçu, (b) `daily_lists.notified_at` mis à jour, (c) contenu mentionne les 15 prospects.

## 7. Nettoyage

Si user de test dédié, supprime :

```sql
DELETE FROM agent_runs WHERE user_id = '<user_id_test>';
DELETE FROM daily_lists WHERE user_id = '<user_id_test>';
DELETE FROM prospects WHERE user_id = '<user_id_test>';
```

Ne touche jamais aux données d'un user réel.
