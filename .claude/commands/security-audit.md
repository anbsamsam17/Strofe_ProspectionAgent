---
description: "Audit sécurité complet de l'agent de prospection BEGES."
---

# /security-audit

Tu fais un audit sécurité du repo. Sors un rapport classé Critique / Moyen / Faible.

## 1. Authentification cron

1. Lis `lib/auth/cron.ts` — confirme l'usage de `crypto.timingSafeEqual` avec padding à longueur fixe (128 octets) pour éviter le leak de longueur.
2. Vérifie que `app/api/agent/run/route.ts` et `app/api/notifications/daily/route.ts` utilisent bien `isCronRequest()` AVANT toute logique.
3. Si une route a une copie locale de `isCronRequest` au lieu d'importer le module : flag en Moyen et propose la consolidation.

## 2. RLS Supabase

1. Lance `/check-rls` pour récupérer l'état des policies sur les 5 tables.
2. Confirme que chaque table a 4 policies (SELECT/INSERT/UPDATE/DELETE) avec `auth.uid() = user_id` (ou `auth.uid() = id` pour `profiles`).
3. Cherche les usages de `createAdminClient()` dans `app/**` et `lib/**` :
   - Toute route admin DOIT avoir une auth manuelle (Bearer ou check explicite de `user.id`).
   - Toute query admin sur une table multi-tenant DOIT filtrer explicitement par `user_id` (le service_role bypass RLS).

## 3. Service role isolation

1. Grep `SUPABASE_SERVICE_ROLE_KEY` dans le repo — interdit dans `components/**`, `app/**/page.tsx`, tout fichier avec `'use client'`.
2. Confirme que `createAdminClient` n'est référencé que dans `lib/agent/**`, `app/api/**`, ou hooks server.
3. Vérifie `lib/supabase/client.ts` : ne doit JAMAIS importer la service_role key.

## 4. SSRF / injection sur fetches externes

Pour chaque appel externe (INSEE, ADEME, Pappers, Hunter, Recherche Entreprises, Gemini, Resend) dans `lib/agent/sourcing.ts`, `lib/agent/contact-enrichment.ts`, `lib/agent/gemini-scoring.ts`, `lib/email/send.ts` :

1. Confirme que les URLs sont construites à partir de **constantes** + paramètres validés (SIREN regex `^\d{9}$`, code postal regex, etc.).
2. Aucun param non sanitizé inséré dans l'URL via template string.
3. Timeout HTTP défini (`AbortController` ou option du SDK).
4. Pas de redirection follow infinie.

## 5. Secrets et logs

1. Grep `console.log`, `console.error`, `console.warn` dans `lib/**` et `app/**` :
   - Aucun log ne doit contenir `process.env.*_KEY`, `process.env.*_SECRET`, `service_role`, tokens INSEE.
   - Les logs JSON structurés de l'orchestrateur ne doivent pas dump l'objet `Profile` ou `Prospect` complet (PII : email contact, téléphone, etc.).
2. Vérifie `sentry.server.config.ts` et `sentry.client.config.ts` : `beforeSend` doit scrub les emails, téléphones, et les headers `Authorization` / `Cookie`.

## 6. Validation des entrées

1. Toute route dans `app/api/**/route.ts` doit avoir un schéma Zod sur le body ET la query string.
2. Vérifie les limites : `MAX_LIMIT` sur les pagination (cf. `app/api/prospects/route.ts`), longueurs max sur les champs texte, formats stricts sur SIREN/SIRET/code postal.
3. Les enums runtime (`PROSPECT_STATUTS`) doivent être en sync avec l'ENUM Postgres et le type TS.

## 7. Dépendances

1. Lance `npm audit --production` — flag tout `high` ou `critical`.
2. Vérifie qu'aucune dep n'est en version `*` ou `latest` dans `package.json`.

## 8. Headers et middleware

1. Lis `middleware.ts` — confirme que la session Supabase est rafraîchie correctement et que les routes protégées redirigent vers `/login`.
2. Vérifie `next.config.ts` — headers de sécurité (CSP, HSTS, X-Frame-Options) si présents.

## Rapport final

```
## Audit sécurité — <date>

### Critique (à corriger avant prochain déploiement)
- ...

### Moyen (à corriger sous 7 jours)
- ...

### Faible (amélioration continue)
- ...

### Bonnes pratiques observées
- ...
```
