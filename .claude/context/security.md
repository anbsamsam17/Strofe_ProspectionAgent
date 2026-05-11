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

---

## Audit Wave 1+2 — fix/sourcing-pagination (2026-05-11)

**Périmètre** : commits `8c39600` (Wave 1 — migration 005, mapping, fixtures), `4e8aed9` (Wave 2 — pagination curseur + boucle adaptative + route Zod + modal UI), `08baf4d` (deps Supabase CLI), + migration 005 appliquée en prod via Management API (PAT révoqué).

### Verdict global

**GO sans réserve.** Aucune régression sécurité introduite par la Wave 1+2. Le diff respecte toutes les règles `.claude/rules/security.md`. Une seule observation de hardening optionnel (cf. §Recommandations).

Synthèse : 0 critique, 0 important, 14 conformes vérifiés.

### Findings

#### Critiques (bloquants)

Aucun.

#### Importants (à fixer avant prod)

Aucun.

#### Conformes (vérifié)

**A. RLS et isolation tenant**

- **A1 — `profiles.sourcing_state` couvert par RLS existante** : `001_initial.sql:98-115` définit 4 policies S/I/U/D sur `profiles` avec `auth.uid() = id`. Postgres applique ces policies à TOUTES les colonnes de la table (pas de policy par colonne nécessaire). La nouvelle colonne `sourcing_state` ajoutée par `005_sourcing_state_and_counters.sql:35-36` est automatiquement isolée par user. Aucune nouvelle policy nécessaire — confirmé par le commentaire SQL `005:14-19`.
- **A2 — Nouvelles colonnes `agent_runs` couvertes par RLS existante** : `001_initial.sql:695-712` définit 4 policies S/I/U/D sur `agent_runs` avec `auth.uid() = user_id`. Les 6 nouvelles colonnes (`prospects_new`, `prospects_updated`, `sirene_total_available`, `sirene_pages_loaded`, `sirene_debut_final`, `sirene_curseur_final` — cf. `005:49-65`) héritent automatiquement de ces policies. OK.
- **A3 — Service role bypass scopé serveur uniquement** : `createAdminClient` n'apparaît dans aucun fichier sous `components/` (vérifié via grep récursif). Les 6 usages sont tous dans `app/api/*/route.ts` (`agent/sourcing`, `agent/run`, `notifications/daily`, `daily-list/*`). `lib/supabase/server.ts:49-60` est l'unique fabrique et n'est jamais importé depuis un Client Component. La policy `'use client'` dans `components/dashboard/sourcing-modal.tsx` n'importe aucun module Supabase serveur — la modal passe uniquement par `fetch('/api/agent/sourcing')`.
- **A4 — Filter `user_id` manuel cohérent avec le mode admin** : `app/api/agent/sourcing/route.ts:127-132` filtre explicitement `.eq('user_id', user.id)` AVANT le check anti-concurrent. Le commentaire `route.ts:118-124` justifie correctement la dérogation à la règle `.claude/rules/security.md §RLS` : le client est `createAdminClient()` (service_role) car la suite (`runSourcing`) écrit dans `agent_runs` avec ce même client. Sans ce filter explicite, on inspecterait les runs cross-user. Conformément à `lib/agent/sourcing-runner.ts:339-349` où `persistSourcingState` filtre `.eq('id', userId)` sur `profiles` (même justification).

**B. CRON_SECRET et auth de cron**

- **B1 — Timing-safe compare préservé** : `app/api/agent/run/route.ts:43-55` n'a pas été touché en Wave 2 (vérifié par lecture). La fonction `isCronRequest` utilise toujours `crypto.timingSafeEqual` avec padding à 128 octets + vérification de longueur post-check. Conforme à `.claude/rules/security.md §CRON_SECRET`.
- **B2 — Aucune nouvelle surface d'appel hors auth** : la boucle adaptative `phaseSourcingAdaptive` (`orchestrator.ts:229-287`) est appelée uniquement depuis `runAgentNocturne` (orchestrator), elle-même appelée depuis `/api/agent/run/route.ts:245` SOUS protection cron OU session. La nouvelle route `/api/agent/sourcing/route.ts:76-87` exige une session Supabase valide (`auth.getUser()`) avant toute opération — pas de bypass possible.

**C. Secrets et données sensibles**

- **C1 — Aucun secret literal dans le diff** : grep `sbp_|sk-[a-zA-Z0-9]{20,}|eyJhbG[a-zA-Z0-9_-]{30,}` sur tous les commits depuis le 2026-05-01 ne retourne que des placeholders dans `.env.example:11-13` (`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` — chaîne de doc, pas de payload réel). Aucun `sbp_*` (PAT Supabase) trouvé dans tout le repo. Le PAT temporaire utilisé pour appliquer la migration 005 via Management API n'a pas laissé de trace dans git history.
- **C2 — PAT Management API non commit** : `grep -r "api.supabase.com|management|supabase\.com/v1"` ne retourne aucun fichier du code. Aucun script `migrate.sh` ou équivalent n'a été ajouté. Le call était un one-shot bash hors arborescence. OK.
- **C3 — Logs structurés sans PII** :
  - `sourcing-runner.ts:158-164` (fonction `log`) sérialise `phase`, `message`, `level`, `data` + `run_id`, `user_id` (UUID). `user_id` n'est pas une PII RGPD (juste un identifiant interne, autorisé en logs serveur — cf. `rules/security.md`).
  - Les `pushLog` push uniquement : signature filtres, curseurs, counters, codes NAF, tranches, `siren`, `total_available`, `pages_loaded` (cf. `sourcing-runner.ts:500-513`, `746-754`, `763-768`).
  - **Aucun log ne contient `contact_email`, `contact_telephone`, `courriel`** (vérifié par grep dans `sourcing-runner.ts` et `sourcing.ts` : les seuls usages de ces champs sont dans la construction de l'objet `Prospect` final, pas dans les logs).
  - `sourcing.ts:251-271` (retries fetch) loggue l'URL + statut + message d'erreur — l'URL contient une query Lucene Sirene avec NAF/tranches/codes postaux, pas de PII. OK.
- **C4 — `agent_runs.logs` JSONB sans PII** : confirmé que `pushLog` n'écrit jamais `contact_email`/`contact_telephone`. Le seul log avec `siren` (cf. `enrichirProspect` warn `sourcing-runner.ts:574-581`) est conforme — SIREN/SIRET sont des identifiants d'entreprise, pas des données personnelles (RGPD art. 4).

**D. SSRF et fetch externes**

- **D1 — URLs Sirene hardcodées** : `sourcing.ts:48` (`INSEE_SIRET_URL`) et `sourcing.ts:597` (`RECHERCHE_ENTREPRISES_URL`) sont des constantes module-level. Les params passent via `URL.searchParams.set()` (`sourcing.ts:443-447`, `644-651`) qui encode automatiquement les caractères spéciaux. Pas d'injection possible.
- **D2 — Pas de nouveau fetch user-controlled** : grep `fetch\(` dans `lib/agent` retourne uniquement les call sites attendus (`sourcing.ts:242`, `contact-enrichment.ts:262-888`). Aucun n'utilise une URL provenant du body API. Les domaines sont tous dans la whitelist `.claude/rules/security.md §SSRF` (api.insee.fr, recherche-entreprises.api.gouv.fr, data.ademe.fr, api.pappers.fr, api.hunter.io).
- **D3 — Aucun call Management API dans le code** : vérifié, le call `api.supabase.com/v1/projects/{ref}/database/query` était hors-arbre (bash one-shot). Pas de résidu.

**E. Validation aux frontières (Zod)**

- **E1 — Route `/api/agent/sourcing` strictement validée** : `route.ts:42-68` définit `SourcingBodySchema` avec `.strict()` (refuse champs inconnus, cf. ligne 58), regex NAF stricte (`^\d{2}\.\d{2}[A-Z]$`), regex `targetRegion` (caractères Unicode + dash/quote, max 30), bornes `effectifMin/Max` (0..100_000, entiers), refine cross-field `min <= max`. Couverture défensive maximale.
- **E2 — `sourcerEntreprises` valide ses params en pré-flight** : `sourcing.ts:313-376` (`validateSourcerParams`) lève `SireneValidationError` sur tranche INSEE invalide, codePostalRange mal formé, maxPages non-entier. Appelée systématiquement en début de `sourcerEntreprises` (`sourcing.ts:430`). Pas de contournement possible.
- **E3 — `sourcing_state` parsé défensivement** : `sourcing-runner.ts:235-247` (`parseSourcingState`) tolère `null`, non-objet, array — retourne `{}`. Type-check par champ via `typeof obj.curseur === 'string'`, etc. Robuste contre la corruption ou changement de shape entre versions.

**F. Erreurs de sécurité communes**

- **F1 — Pas de `as any` dans le diff Wave 2** : grep `as any` dans `lib/agent/` et `app/api/agent/sourcing/` retourne 0 match. Les seules échappées de typage sont des `as unknown as Json` (sourcing-runner.ts:311, 348, 906) et `as unknown as Database['public']['Tables']['prospects']['Insert'][]` (lignes 649, 658) — patterns documentés et corrects pour les casts JSONB Supabase (pas un bypass de type, juste une conversion structurée).
- **F2 — Pas de promise non-awaited problématique** : tous les `await supabase.*.update/insert/select` sont attendus. Les `Promise.allSettled` dans `runAdaptiveSourcing` (via `enrichAndScore` `sourcing-runner.ts:565`) et `/api/agent/run/route.ts:148` sont corrects (les rejets sont capturés et loggués).
- **F3 — Pas de catch silencieux sur auth** : les seuls `catch {}` silencieux sont dans `sourcing.ts:835` (rechercherTelephone — fallback graceful, non-critique) et `sourcing.ts:776` (parse JSON ADEME — fallback null, non-critique). Aucun n'avale d'erreur d'auth.
- **F4 — Conformité globale aux règles** : auth en TÊTE de route (`sourcing/route.ts:74-87`, AVANT parse body — pas de leak via timing JSON), pas d'`error.message` brut en prod (`route.ts:172-177` gate sur `NODE_ENV === 'development'`), pas de stack trace exposée, pas de CORS wildcard, pas de `redirect()` user-controlled.

### Recommandations facultatives

1. **Centraliser `isCronRequest`** : `/api/agent/run/route.ts:43-55` contient une copie locale (TODO `route.ts:18-20`). À déplacer dans `lib/auth/cron.ts` pour éviter la divergence si un nouveau cron est ajouté. Pas urgent — copie correcte.
2. **Logger niveaux `agent_runs.logs`** : `data` peut être un `Record<string, unknown>` arbitraire (`sourcing-runner.ts:148`). En théorie, un caller pourrait y injecter un `contact_email` par mégarde. Hardening : ajouter un scrub explicite dans `pushLog` (regex email/tel sur les valeurs sérialisées) — défense en profondeur cohérente avec Sentry `beforeSend`.
3. **Rate-limit `/api/agent/sourcing`** : la route accepte une session valide mais aucun rate-limit per-user (l'anti-concurrent ne bloque que pendant un run actif). Un user pourrait spammer des runs courts qui échouent vite. Ajouter un rate-limit léger (5 runs / heure) via Vercel KV ou Upstash si abus constaté.
4. **Hash signature filtres** : `computeFiltersSignature` (`sourcing-mapping.ts:296-312`) hash SHA-256 tronqué à 12 chars hex = 48 bits = ~10^14 combinaisons. Collisions négligeables à l'échelle d'un user (au pire quelques signatures stockées). OK.

### Reste à faire (non bloquant)

- Cleanup TODO de `lib/auth/cron.ts` (cf. R1).
- Vérifier en pre-deploy que Sentry `beforeSend` scrub bien les nouveaux champs `sourcing_state`, `sirene_curseur_final` s'ils transitent par un breadcrumb (peu probable : ce sont des données opérationnelles, mais à confirmer).
