# Crons Vercel

Définis dans `vercel.json`. Deux jobs, tous les deux protégés par `CRON_SECRET`.

```json
{
  "crons": [
    { "path": "/api/agent/run",            "schedule": "0 22 * * *"    },
    { "path": "/api/notifications/daily",  "schedule": "30 7 * * 1-5"  }
  ]
}
```

## 22h00 tous les jours — pipeline

- **Path** : `POST /api/agent/run`.
- **Schedule** : `0 22 * * *` (heure du serveur Vercel = UTC ; ajuster mentalement = 23h Paris l'hiver, 00h l'été).
- **Action** : mode cron → boucle sur tous les `profiles.onboarded=true`, lance `runSourcing` puis (en mode manuel) `runAgentNocturne`. Voir `pipeline-nightly.md`.
- **Durée** : `export const maxDuration = 300` (5 min, plan Vercel Pro requis si plusieurs users).
- **Authentification** : Vercel injecte automatiquement `Authorization: Bearer ${CRON_SECRET}`. Le handler appelle `isCronRequest()` qui fait une comparaison timing-safe (cf. `security.md`).

## 7h30 jours ouvrés (lun-ven) — notification

- **Path** : `POST /api/notifications/daily`.
- **Schedule** : `30 7 * * 1-5`.
- **Action** : pour chaque `daily_lists` du jour avec `status='ready'` et `notified_at IS NULL` → envoi email Resend → SET `notified_at = NOW()`.
- **Garde-fou** : `notified_at` empêche le double envoi en cas de retry Vercel.
- **Authentification** : même Bearer `CRON_SECRET`.

## Injection du Bearer côté Vercel

Vercel ajoute automatiquement le header `Authorization: Bearer ${CRON_SECRET}` aux requêtes générées par les jobs cron, à condition que la variable `CRON_SECRET` soit définie dans les **Project Settings → Environment Variables** (Production + Preview si besoin).

**Ne jamais** :
- Hardcoder le secret dans `vercel.json` (il n'y est pas, c'est intentionnel).
- Loguer le header `Authorization` reçu.
- Le commiter dans `.env.local` versionné.

## Retry policy Vercel

- Vercel **retry une fois** si la réponse n'est pas `200 OK` (statut 2xx en général).
- Au-delà, échec définitif, visible dans le dashboard Vercel Crons.
- Conséquence : tout endpoint cron doit être **idempotent**. Le pipeline l'est :
  - `phaseInit` rejette si run déjà `running` (409).
  - `phaseSelection` exclut les prospects déjà dans la daily list du jour.
  - `phaseCreateDailyList` upsert sur `(user_id, date)`.
  - Notification : `notified_at` empêche double envoi.

## Observabilité

- **Table `agent_runs`** : 1 ligne par lancement. Phase courante, compteurs, logs JSONB chronologiques. Requête utile pour debug :
  ```sql
  SELECT id, status, phase, prospects_sourced, prospects_qualified,
         list_generated, error_message, started_at, completed_at
    FROM agent_runs
   WHERE user_id = '<uuid>'
   ORDER BY started_at DESC LIMIT 10;
  ```
- **Console logs** : structurés JSON (`{ts, level, phase, msg, run_id, user_id}`). Visibles dans Vercel Functions logs.
- **Sentry** : exceptions non capturées remontent automatiquement avec contexte (mais PII scrub doit avoir retiré email/téléphone — cf. `security.md`).
- **Dashboard Vercel** : `Project → Settings → Cron Jobs` → historique d'exécution + statut HTTP.

## Test local

```powershell
# Démarrer Next en dev
npm run dev

# Dans un autre terminal — déclencher le cron en mode cron (Bearer)
curl -H "Authorization: Bearer $env:CRON_SECRET" -X POST http://localhost:3000/api/agent/run

# Déclencher la notif
curl -H "Authorization: Bearer $env:CRON_SECRET" -X POST http://localhost:3000/api/notifications/daily
```

Pour tester en mode manuel (un seul user via session) : se connecter sur `/login`, puis appeler depuis le navigateur ou Postman avec les cookies Supabase.

## Mode dégradé

- Si `CRON_SECRET` n'est pas défini → `isCronRequest()` retourne `false` → toute requête cron est traitée comme non authentifiée → 401. Symptôme : tous les crons échouent en prod.
- Si Vercel ne déclenche pas le cron (panne, oubli de déploiement) : lancer manuellement via `curl` ou créer un trigger temporaire dans un autre orchestrateur (GitHub Actions schedule par exemple).

## Considérations fuseau horaire

Vercel cron tourne en **UTC**. `0 22 * * *` = 22h UTC = 23h Paris hiver (CET) / 00h Paris été (CEST). À garder en tête quand on lit `started_at` (TIMESTAMPTZ) dans `agent_runs` — la valeur est en UTC, le client Supabase la convertit selon le fuseau JS du navigateur.
