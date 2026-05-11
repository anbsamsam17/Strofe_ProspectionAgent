---
description: "Checklist de déploiement Vercel pour l'agent de prospection BEGES."
---

# /deploy

Tu prépares un déploiement de l'agent IA sur Vercel (Next.js 15 + Supabase + OpenAI). Pas de staging séparé — la preview Vercel sur PR fait office de pré-prod.

## 1. Validation locale avant push

Exécute dans l'ordre, arrête-toi à la première erreur :

1. `npm run type-check` — TS strict, zéro erreur tolérée.
2. `npm run lint` — ESLint Next.js.
3. `npm run test` — Vitest (vérifie au minimum `lib/agent/__tests__/scoring.test.ts`).
4. `npm run build` — build Next 15 turbopack complet, sans warning bloquant.

Si l'un échoue : ne déploie pas, corrige d'abord. Référence `/fix-issue` si besoin.

## 2. Vérification git

1. `git status` — working tree propre, aucun fichier non committé.
2. `git log origin/main..HEAD --oneline` — liste les commits qui partiront en prod.
3. Confirme que la branche cible est `main` (déploiement Vercel auto sur push).

## 3. Variables d'environnement Vercel (production)

Vérifie sur le dashboard Vercel que les vars suivantes sont définies en environnement **Production** :

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `INSEE_CLIENT_ID`, `INSEE_CLIENT_SECRET` (OAuth2 token 7j)
- `PAPPERS_API_KEY`, `HUNTER_API_KEY`
- `RESEND_API_KEY`, `EMAIL_FROM`
- `CRON_SECRET` (token Bearer du cron Vercel — doit matcher `lib/auth/cron.ts`)
- `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`

Lance `/sync-env` si tu doutes de la liste complète. Ne logge jamais les valeurs.

## 4. Migrations Supabase

1. Vérifie que toutes les migrations de `supabase/migrations/` sont appliquées en production (Supabase dashboard → SQL → table `supabase_migrations.schema_migrations`).
2. Si une migration locale n'est pas en prod : applique-la AVANT le déploiement du code (sinon les routes API qui en dépendent crasheront).
3. Lance `/check-rls` pour confirmer que les policies RLS sont actives sur les 5 tables (`profiles`, `prospects`, `daily_lists`, `daily_list_items`, `agent_runs`).

## 5. Crons Vercel

Vérifie `vercel.json` puis le dashboard Vercel → Crons :

- `POST /api/agent/run` à `0 22 * * *` (run nocturne sourcing)
- `POST /api/notifications/daily` à `30 7 * * 1-5` (email Resend 7h30 jours ouvrés)

Confirme que les deux crons apparaissent comme **enabled** côté Vercel après déploiement.

## 6. Sentry release

1. Vérifie que `instrumentation.ts` et `sentry.{client,server,edge}.config.ts` sont à jour.
2. Le wizard `@sentry/nextjs` upload automatiquement les sourcemaps au build — confirme dans les logs Vercel.
3. Crée la release Sentry sur la version Git (auto via plugin si `SENTRY_AUTH_TOKEN` est set).

## 7. Smoke tests post-déploiement

Dans les 10 minutes qui suivent le déploiement :

1. Login sur l'app — la session Supabase fonctionne (middleware `middleware.ts` OK).
2. Charge `/dashboard` — pas de 500.
3. `GET /api/agent/status` avec session → 200 JSON.
4. Vérifie le dashboard Sentry — pas de spike d'erreurs.
5. Note dans `memory/session-context.md` : version déployée + heure.

En cas de régression critique : Vercel → Deployments → "Promote to Production" sur le précédent déploiement vert.
