# Sécurité — Agent IA Prospection Bilan Carbone

> Règles non négociables. Toute violation est un bug bloquant.

---

## RLS (Row Level Security) Supabase

- **4 policies par table** : `SELECT`, `INSERT`, `UPDATE`, `DELETE`. Toujours avec `auth.uid() = user_id`.
- Tables concernées : `profiles`, `prospects`, `daily_lists`, `daily_list_items`, `agent_runs`.
- Voir `supabase/migrations/001_initial.sql` pour la référence.
- **Jamais** filtrer manuellement `.eq('user_id', userId)` côté app pour "double-vérifier" — c'est un anti-pattern qui masque une RLS cassée. La session Supabase SSR + RLS fait le filtrage.
- Si tu vois un filter manuel sur `user_id` dans une route API authentifiée, c'est un code smell : ouvre une issue, ne le maintiens pas.

## Service role key

- `SUPABASE_SERVICE_ROLE_KEY` est utilisée **uniquement** dans les routes serveur du pipeline cron (typiquement `app/api/agent/run/route.ts` et `app/api/notifications/daily/route.ts`).
- **Aucun import** de la service_role depuis un composant client (`'use client'`) ni un composant serveur de page. Si un import existe ailleurs → bug critique, fix immédiat.
- Audit rapide : `grep -r "SERVICE_ROLE" app/ components/` ne doit rien retourner hors `app/api/agent/` et `app/api/notifications/`.

## CRON_SECRET

- Comparé via `crypto.timingSafeEqual` avec padding longueur fixe — voir `lib/auth/cron.ts` (`isCronRequest`).
- **Jamais** comparer avec `===`, `==`, ni `.includes()`. C'est une faille timing attack.
- Jamais logger la valeur du token (ni dans Sentry, ni dans `console.log`, ni dans `agent_runs.error_message`).
- Si tu ajoutes une nouvelle route protégée par cron, importe et utilise `isCronRequest()` — ne réécris pas la logique.

## Validation des entrées

- Tout body d'API parsé via Zod (`schema.safeParse(await req.json())`).
- Tout query param utilisé pour une query DB validé en amont.
- Toute réponse d'API externe (Sirene, ADEME, Pappers, Hunter, OpenAI) parsée via un schema Zod avant utilisation. Une 200 mal formée doit échouer proprement.
- **Jamais** `req.body as any`, `JSON.parse(...)` directement sans schema, ni `Object.assign` sur input user.

## Secrets

- Fichier `.env.local` jamais commité (dans `.gitignore`).
- Pas de secret en clair dans le code source.
- Variables d'env interdites à logger (à grep pour audit) :
  - `OPENAI_API_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `RESEND_API_KEY`
  - `INSEE_CLIENT_SECRET`
  - `CRON_SECRET`
  - `PAPPERS_API_KEY`, `HUNTER_API_KEY`
- En cas de leak : rotation immédiate côté provider + Vercel env.

## SSRF (Server Side Request Forgery)

- Tous les `fetch()` externes doivent cibler des domaines de cette whitelist :
  - `api.openai.com`
  - `api.insee.fr`
  - `data.ademe.fr`
  - `recherche-entreprises.api.gouv.fr`
  - `api.pappers.fr`
  - `api.hunter.io`
  - `api.resend.com`
  - `bodacc-datadila.opendatasoft.com`
  - `registre-national-entreprises.inpi.fr`
- **Jamais** d'URL user-controlled passée à `fetch()`. Pas de `fetch(req.body.url)`.
- Pas de proxy générique sortant.

## PII et logs

- Sentry est configuré dans `sentry.{client,server,edge}.config.ts`. Le hook `beforeSend` doit **scrub emails et téléphones** des prospects avant envoi (regex sur le payload).
- Pas de log brut d'un objet `prospect` complet (contient email + téléphone). Logger uniquement `prospect.id` et `prospect.siren`.
- Les pitchs générés (texte libre) peuvent contenir le nom du dirigeant — ok en DB (RLS protège), pas ok en log externe.

## Audit rapide

Commandes à passer périodiquement :
```bash
grep -r "SERVICE_ROLE" app/ components/        # leak service role côté client
grep -rn "CRON_SECRET ===" .                    # timing attack
grep -rn "as any" app/ lib/ components/         # type bypass
grep -rn "console.log" app/api/                 # logs en prod
grep -rn "process.env.CRON_SECRET" lib/         # toujours via isCronRequest()
```

Voir aussi `skills/security-review/` pour le workflow complet.
