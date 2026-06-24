---
name: deploy
description: "Checklist de déploiement Vercel pour l'agent de prospection bilan carbone. À activer quand l'utilisateur parle de déployer, ship, release, mise en production, push to prod."
---

# Skill : Deploy — Agent IA Prospection Bilan Carbone

Activé quand l'utilisateur mentionne : déployer, ship, release, mise en production, push to prod, livraison.

## Pré-déploiement local (obligatoire)

Avant tout push sur `main` :

```bash
npm run lint
npm run type-check
npm run test
npm run build    # build local Next.js — détecte les erreurs runtime / RSC
```

Si un de ces 4 échoue, **on ne déploie pas**.

## Migrations Supabase

Vérifier que les migrations dans `supabase/migrations/` sont déjà push en prod :

```bash
npx supabase migration list --linked
```

Si une migration locale n'est pas en prod : `npx supabase db push` **avant** le déploiement Vercel (le code prod attend le nouveau schema).

## Secrets Vercel

Vérifier que les env vars suivantes existent en prod (dashboard Vercel → Settings → Environment Variables) :

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `GEMINI_API_KEY`
- `RESEND_API_KEY`
- `INSEE_CLIENT_ID`, `INSEE_CLIENT_SECRET`
- `PAPPERS_API_KEY`, `HUNTER_API_KEY`
- `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`

Toute env manquante = build Vercel ok mais runtime cassé.

## Déploiement

- Push sur `main` déclenche le build Vercel.
- Suivre le build sur le dashboard Vercel. Lire les logs si KO.

## Vérifs post-déploiement

1. **Smoke test app** : ouvrir l'URL prod, login, voir le dashboard.
2. **Test cron en prod via curl** (vérif que `CRON_SECRET` est bien set et que la route répond) :

   ```bash
   curl -X POST https://<prod-url>/api/agent/run \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

   Doit retourner 200 (ou 409 si un run existe déjà aujourd'hui). 401 = secret cassé, 500 = bug.

3. **Vérifier Vercel Crons** : dashboard → Crons → l'entrée `0 22 * * *` (run nocturne) et `30 7 * * *` (notification matin) sont actives.

4. **Monitor Sentry 10 minutes** : nouvelle erreur post-deploy = rollback (Vercel → Deployments → Promote previous).

## Documentation

- Si bump non trivial : entry datée dans `memory/hindsight.md` (changement, raison, observations).
- Si nouveau cron ou nouvelle env : note dans `memory/session-context.md`.
