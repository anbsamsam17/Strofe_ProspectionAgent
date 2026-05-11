# Sécurité — récap

## 1. Row Level Security (RLS)

Activée sur les 5 tables : `profiles`, `prospects`, `daily_lists`, `daily_list_items`, `agent_runs`.

**4 policies par table** (SELECT / INSERT / UPDATE / DELETE) avec la même règle :

```sql
auth.uid() = user_id    -- pour prospects, daily_lists, daily_list_items, agent_runs
auth.uid() = id         -- pour profiles (PK = auth.users.id)
```

Conséquences pratiques :
- **Côté client / API en session user** : ne JAMAIS doubler par un `.eq('user_id', userId)` dans le code — RLS le fait. Doubler masque des bugs (par ex. user_id absent du contexte) et n'apporte rien.
- **Côté orchestrator / cron** : on utilise `createAdminClient()` (service_role) qui **bypasse RLS**. Donc on filtre **explicitement** par `user_id` à chaque requête (le code de `orchestrator.ts` le fait partout).
- `daily_list_items.user_id` est **dénormalisé** (FK vers auth.users) pour éviter une jointure coûteuse dans la policy RLS — décision documentée dans `memory/project-context.md`.

## 2. Service role key

`SUPABASE_SERVICE_ROLE_KEY` :
- Utilisée **uniquement** côté serveur dans `lib/supabase/server.ts → createAdminClient()`.
- Appelée par : l'orchestrator (`runAgentNocturne`, `runSourcing`) et la route `/api/agent/run` en mode cron.
- **Jamais** dans un Client Component, jamais préfixée `NEXT_PUBLIC_`, jamais exposée au navigateur.
- Définie en prod via Vercel Environment Variables (scope Production uniquement, pas Preview public).

Une fuite de cette clé donne accès complet à la base **sans RLS** → tous les prospects, tous les users.

## 3. CRON_SECRET — timing-safe

Comparaison dans `app/api/agent/run/route.ts` :

```ts
function isCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false

  const authHeader = request.headers.get('authorization') ?? ''
  const provided = authHeader.replace('Bearer ', '').trim()

  // Padding 128 octets pour ne pas leaker la longueur via timing
  const expectedBuf = Buffer.from(cronSecret.padEnd(128, '\0'))
  const providedBuf = Buffer.from(provided.padEnd(128, '\0'))

  return timingSafeEqual(expectedBuf, providedBuf) && provided.length === cronSecret.length
}
```

Points clés :
- `crypto.timingSafeEqual` empêche les attaques timing.
- Padding à longueur fixe (128) empêche le leak de longueur (timingSafeEqual exige des buffers de même taille).
- Vérification de longueur **après** pour rejeter les secrets trop courts/longs.
- **Jamais loggé** : ni le header `Authorization`, ni `provided`, ni `expected`.

Le même pattern doit être appliqué dans `/api/notifications/daily` (à vérifier dans le code).

## 4. Secrets — gestion

- `.env.local` est dans `.gitignore`, jamais commité.
- `.env.example` (si présent) liste les noms de variables sans valeurs — à versionner.
- Vercel : variables définies par environnement (Production / Preview / Development) dans les Project Settings.
- CI GitHub Actions (si présent) : secrets via `secrets.<NAME>`, jamais en clair dans les workflows.
- Rotation : `CRON_SECRET` et `SUPABASE_SERVICE_ROLE_KEY` à régénérer si fuite suspectée.

## 5. Sentry — scrub PII

Configuration dans `sentry.client.config.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts`.

Le `beforeSend` doit :
- Retirer les champs `contact_email`, `contact_telephone`, `email` des breadcrumbs et `extra`.
- Masquer les patterns email (`/[\w.+-]+@[\w-]+\.[\w.-]+/`) et téléphones (`/\+?\d[\d\s.-]{8,}/`) dans les messages.
- Ne pas envoyer les bodies de requête entrants tels quels.

À vérifier dans le code (`sentry.*.config.ts`) — si `beforeSend` manque, c'est un trou PII à combler immédiatement (RGPD).

## 6. Validation Zod aux frontières

Toutes les routes API entrantes parsent leur body avec un schéma Zod (cf. `RunBodySchema` dans `/api/agent/run/route.ts`). Échec → 400 `VALIDATION_ERROR` avec `fieldErrors`.

Règles :
- **Frontière entrante uniquement** (API routes, env vars, JSON externe).
- Pas de Zod entre fonctions internes typées TS — gaspillage.
- Pour les Server Actions : valider l'input avec Zod avant de toucher Supabase.

## 7. SSRF — whitelist domaines

Les `fetch()` sortants du pipeline ne vont QUE vers :
- `api.openai.com`
- `api.insee.fr` / `recherche-entreprises.api.gouv.fr`
- `data.ademe.fr`
- `api.pappers.fr`
- `api.hunter.io`
- `api.resend.com`
- `*.supabase.co` (Supabase SDK)

Aucune URL fournie par un utilisateur ne doit être passée à `fetch()` sans validation. Si une feature future le requiert (ex : enrichir depuis un site web fourni), implémenter une vérification :
- Résolution DNS et refus des IPs privées (RFC1918, loopback, link-local).
- Whitelist explicite des hostnames si possible.
- Timeout court (5-10 s) et taille max de réponse.

## 8. Auth Supabase

- Sessions cookies SSR via `@supabase/ssr` (middleware.ts rafraîchit à chaque requête).
- `supabase.auth.getUser()` à utiliser dans les API routes (pas `getSession()` qui est moins sûr côté serveur).
- Pas d'usurpation : dans `/api/agent/run` mode manuel, on vérifie `body.userId === user.id` → 403 sinon.

## 9. Pages publiques minimales

`PUBLIC_ROUTES = ['/', '/login', '/signup', '/auth/callback']` dans `middleware.ts`. Tout le reste exige une session valide.

## 10. Sanitization prompts GPT-4o

Les données externes injectées dans le prompt OpenAI (raison sociale, signaux scrapés, etc.) sont :
- Enveloppées dans `<données_entreprise>...</données_entreprise>` avec instruction explicite d'ignorer leur contenu.
- Scannées contre `INJECTION_PATTERNS` (cf. `lib/agent/pitch-gen.ts`) — log warn si match (non bloquant).

Voir `prompts-guide.md` pour le détail.

## Checklist avant déploiement prod

- [ ] `CRON_SECRET` défini dans Vercel (rotation après staging).
- [ ] `SUPABASE_SERVICE_ROLE_KEY` scope Production uniquement.
- [ ] Sentry `beforeSend` scrub PII testé.
- [ ] RLS activée sur les 5 tables (vérifier : `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('profiles','prospects','daily_lists','daily_list_items','agent_runs');`).
- [ ] `/api/agent/run` rejette les requêtes sans Bearer valide ET sans session (test 401).
- [ ] Aucune référence `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` ni équivalent.
- [ ] `.env.local` absent du commit (`git log --all --full-history -- .env.local` doit être vide).
