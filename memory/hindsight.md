---
project: "Agent IA - Prospection Bilan Carbone"
domain: "saas"
type: "hindsight"
created: "2026-04-05"
tags: [project/agent-ia---prospection-bilan-carbone, memory/hindsight, retrospective]
links:
  - "[[memory/MOC]]"
  - "[[memory/session-context]]"
  - "[[CLAUDE]]"
---

# Hindsight — Agent IA - Prospection Bilan Carbone

> Journal de rétrospectives du projet.
> Après chaque session ou milestone important, Claude (ou toi) ajoute une entrée ICI.
> Ces notes sont re-lues au début de chaque nouvelle session pour éviter de répéter les erreurs.

---

## Comment utiliser ce fichier

Claude doit ajouter une entrée à la fin de chaque session significative :

```
## [Date] — [Titre de la session]
**Ce qui a bien marché** : ...
**Ce qui n'a pas marché** : ...
**Décision prise** : ...
**À ne pas répéter** : ...
**À refaire** : ...
```

---

## 2026-04-05 — Initialisation du projet

**Ce qui a bien marché** : Génération automatique de la structure de fichiers via Claude Prompt Optimizer.

**À faire en priorité** :
- Compléter les `[PLACEHOLDERS]` dans `memory/project-context.md`
- Définir la stack technique définitive
- Configurer l'environnement de développement

**Points de vigilance identifiés dès le départ** :

- [À documenter au fil du projet]

---

## 2026-04-05 — Schéma DB multi-tenant Supabase

**Ce qui a bien marché** :
- Dénormaliser `user_id` dans `daily_list_items` évite un JOIN dans les policies RLS, ce qui est critique sur Supabase où chaque query passe par le RLS check.
- Utiliser des ENUM PostgreSQL plutôt que des CHECK constraints rend le schéma auto-documenté et les erreurs plus lisibles côté application.
- Les index partiels (ex: `WHERE status = 'running'`) sont très efficaces pour les requêtes de monitoring sur de petits sous-ensembles.

**Points de vigilance** :
- Le trigger `handle_new_user` s'exécute sur `auth.users` avec `SECURITY DEFINER` — vérifier que le search_path est bien fixé à `public` pour éviter les injections via search_path.
- La colonne `date` dans `daily_lists` est un mot réservé SQL — surveiller les éventuels conflits de nommage avec certains ORMs (Prisma gère bien, Drizzle aussi).
- `CHAR(9)` pour SIREN : PostgreSQL pad avec des espaces si la valeur est courte — préférer `VARCHAR(9)` ou un CHECK `LENGTH(siren) = 9` si l'API peut retourner des valeurs mal formatées.

**Règle à retenir** :
- Sur Supabase, toujours dénormaliser `user_id` dans les tables enfant quand elles ont beaucoup de lignes — la policy RLS sans jointure est significativement plus rapide.

---

## 2026-04-05 — Instrumentation Sentry sur Next.js 15

**Ce qui a bien marché** : La séparation nodejs/edge dans `register()` évite les crashs du middleware Edge qui ne supporte pas les APIs Node.js natives.

**Règle à retenir** : Sur Next.js 15, Sentry DOIT être initialisé via `instrumentation.ts` (register() + onRequestError). Ne pas mettre `Sentry.init()` directement dans `layout.tsx` ou dans les Server Components.

**A ne pas répéter** : Ne pas laisser `skipOpenTelemetrySetup` à sa valeur par défaut (false) sur le server config — Next.js 15 gère déjà OTEL, le double setup crée des conflits silencieux sur les traces distribuées.

**Décision prise** : `profilesSampleRate: 0.05` (5%) pour le profiling serveur — assez bas pour ne pas impacter les performances en prod, assez haut pour avoir des données significatives lors des investigations de perf.

---

## 2026-04-05 — CI GitHub Actions : cache .next et variables SENTRY

**Ce qui a bien marché** : Séparation lint/typecheck/test en jobs parallèles réduit le time-to-feedback de ~60% par rapport au job séquentiel initial.

**Règle à retenir** : `withSentryConfig` dans `next.config.ts` lit `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` au build time. Sans ces variables (même fictives), le build CI peut crasher ou produire des warnings bloquants.

**Comment l'éviter** : Toujours définir ces 3 variables dans le job `build` du CI, même avec des valeurs placeholder. Le token placeholder ne téléchargera pas les sourcemaps vers Sentry — c'est le comportement attendu en CI (pas de release Sentry sur chaque build).

**A ne pas répéter** : Ne pas utiliser `concurrency: cancel-in-progress: true` sur le job `build` en production sans vérifier que les artefacts Vercel ne sont pas corrompus par une annulation en cours de route.

---

## 2026-04-05 — Agent Core : gestion du cache token INSEE et null vs undefined Supabase

**Ce qui a bien marché** :
- Le cache mémoire du token INSEE au niveau module (variable `_inseeTokenCache`) est la bonne approche pour les serverless Vercel avec warm instances — évite 1 appel OAuth2 par exécution de cron.
- La séparation claire des phases dans l'orchestrateur (init/settings/sourcing/scoring/selection/pitchs/daily-list/finalization) rend le code très lisible et facilite le debug via les logs.
- Le batch de 50 pour l'upsert Supabase évite les timeouts sur de gros volumes sans complexité supplémentaire.

**Erreur commise** :
- Import de `DailyListItem` supprimé par erreur lors d'un refactor de type, puis réintroduit — le `Omit<DailyListItem, ...>` avait besoin du type importé.

**Règle à retenir** :
- Supabase attend `null` (pas `undefined`) pour les champs optionnels dans les insert/update — `undefined` est silencieusement ignoré par `JSON.stringify`, ce qui peut créer des colonnes avec des valeurs stale ou des erreurs NOT NULL implicites. Toujours utiliser `null` dans les objets d'insertion.

**Comment l'éviter** :
- Créer un type d'insertion dédié (ex: `DailyListInsert`) avec les champs optionnels typés `null` plutôt que `undefined` dès qu'on insert en base via Supabase.

**À ne pas répéter** :
- Utiliser `ReturnType<typeof fn> extends Promise<infer T> ? T : never` pour le type de retour d'une phase async — trop verbeux et fragile. Préférer nommer explicitement le type de retour (`Promise<GeneratedPitch[]>`).

## 2026-04-05 — API Routes : adaptation signature email + colonne manquante

**Ce qui a bien marché** :
- Lire `lib/email/send.ts` avant de coder la route notifications a permis d'utiliser la vraie signature (`SendDailyReadyOptions`) au lieu d'inventer une interface qui n'existait pas.
- La comparaison CRON_SECRET en temps constant (bitwise XOR) évite les timing attacks sans dépendance tierce (`crypto.timingSafeEqual` n'est pas dispo dans tous les runtimes Edge).
- `Promise.allSettled()` dans le mode cron multi-user garantit qu'un run qui échoue n'arrête pas les autres — pattern à réutiliser pour tous les traitements batch.

**Erreur commise** :
- Supposer que `notified_at` existait déjà dans `daily_lists` sans vérifier la migration initiale → colonne absente → query `.is('notified_at', null)` aurait crashé en prod.

**Règle à retenir** :
- Toujours vérifier la migration SQL ET le `database.types.ts` avant d'utiliser une colonne dans une API Route. Si la colonne manque : créer une migration + mettre à jour les types avant de coder la route.

**Comment l'éviter** :
- Checklist avant chaque nouvelle route : (1) la table existe ? (2) les colonnes utilisées existent dans la migration ? (3) database.types.ts est à jour ?

**À ne pas répéter** :
- Écrire une API Route qui importe un module (`lib/email/send.ts`) sans avoir lu ce module d'abord — la signature peut être différente de celle supposée.

---

## 2026-04-06 — Séparation sourcing / daily list : deux types de clients Supabase

**Ce qui a bien marché** :
- Utiliser `SupabaseAdminClient` (retour de `createAdminClient()`) dans les nouveaux runners est correct et cohérent — les orchestrateurs n'ont pas besoin des cookies de session.
- Définir un `correlationId` via `crypto.randomUUID()` dans `generateDailyList()` permet de tracer chaque génération dans les logs sans avoir un `agent_run` en DB pour chaque opération.
- Le pattern de logging `AgentLog[]` accumulés + `updateRunInDB()` périodique évite les appels DB superflus.

**Erreur commise** :
- Cast `(prospect as Record<string, unknown>)` rejeté par TypeScript car `Prospect` est une interface sans index signature. Fix : `(prospect as unknown as Record<string, unknown>)`.
- `await createAdminClient()` dans `app/api/agent/run/route.ts` — `createAdminClient()` est synchrone (pas de `async`), le `await` était erroné même s'il ne causait pas d'erreur runtime (await sur une valeur non-Promise retourne la valeur telle quelle). Supprimé pour la cohérence.

**Règle à retenir** :
- Pour muter dynamiquement les champs d'une interface TypeScript nommée, toujours utiliser le double cast `as unknown as Record<string, unknown>` — le cast direct `as Record<string, unknown>` est refusé si le type source n'a pas d'index signature.
- Avant d'écrire `await f()`, vérifier que `f()` est bien `async` ou retourne une `Promise`. Un `createAdminClient()` synchrone wrappé dans `await` ne plante pas mais crée une confusion de lecture.

**Comment l'éviter** :
- Toujours relire la signature de la fonction appelée (async/sync) avant d'écrire `await`.
- Préférer `Object.assign(prospect, nouveauxChamps)` ou un objet mutable intermédiaire plutôt qu'un cast dynamique.

---

## 2026-04-05 — Apostrophes typographiques dans les string literals TypeScript

**Erreur commise** : Les descriptions dans les tableaux STEPS et TIPS du template welcome.tsx contenaient des apostrophes typographiques (`'` U+2019) à l'intérieur de string literals délimités par des apostrophes ASCII (`'`). TypeScript parse ces caractères comme la fin de la string, générant des erreurs TS1005 et TS1002 en cascade.

**Règle à retenir** : Dans les string literals TypeScript, les apostrophes typographiques sont valides dans le contenu JSX (rendu HTML) mais invalides comme délimiteurs. Si le texte contient une apostrophe (`n'avez`, `l'agent`), utiliser les double-quotes (`"...n'avez..."`) ou des template literals.

**Comment l'éviter** : Avant d'écrire des templates email avec du texte français, repérer les contractions (n', l', qu', c', j', s') et choisir systématiquement les double-quotes pour ces strings. Lancer `tsc --noEmit` immédiatement après la création de tout nouveau fichier.

## 2026-04-05 — Mise à jour @supabase/supabase-js v2.101 : compatibilité @supabase/ssr

**Erreur commise** : Mise à jour de `@supabase/supabase-js` vers `2.101.1` sans mettre à jour `@supabase/ssr` en parallèle. La v2.101 a changé la signature de `SupabaseClient` de 3 paramètres génériques à 5, ce qui a cassé `@supabase/ssr@0.6.1` qui compilait encore avec l'ancienne signature (3e param = Schema objet, non SchemaName string).

**Règle à retenir** :
- `@supabase/supabase-js` et `@supabase/ssr` forment un binôme : toujours les mettre à jour ensemble. Vérifier via `npm view @supabase/ssr peerDependencies` la version de supabase-js attendue.
- Version compatible : `@supabase/ssr@0.10.0` ↔ `@supabase/supabase-js@^2.100.1`
- Toujours définir `export type Database = {...}` (type alias) pas `export interface Database` — requis pour que `Omit<Database, '__InternalSupabase'>` fonctionne dans les génériques conditionnels de SupabaseClient.
- Exporter `SupabaseServerClient = ReturnType<typeof createServerClient<Database>>` depuis `server.ts` — évite de se battre avec les paramètres génériques de SupabaseClient directement.
- Les colonnes JSONB (score_details, signaux, logs) retournent le type `Json` depuis Supabase — toujours utiliser `as unknown as MonType` à la frontière DB/app-types.
- La relation `daily_lists.user_id → profiles.id` n'est pas visible statiquement par postgrest-js (la FK est vers `auth.users`, pas `public.profiles`) — le join `profiles!inner` dans un select Supabase compile en `SelectQueryError` côté TypeScript → cast `as unknown as T`.
- `next.config.ts` : `typedRoutes` a quitté `experimental` dans Next.js 15 récent — le déplacer au niveau racine de `NextConfig`.

**Comment l'éviter** :
1. Avant chaque `npm install @supabase/supabase-js@latest`, vérifier `npm view @supabase/ssr@latest peerDependencies`.
2. Après toute mise à jour Supabase, exécuter immédiatement `npx tsc --noEmit`.
3. Chercher les erreurs `never` dans les queries Supabase — signe d'un schema mal résolu (souvent interface vs type ou mismatch de version).

## 2026-04-05 — Tailwind CSS v4 : migration de tailwind.config.ts vers @theme CSS

**Erreur commise** : Le projet avait installe `tailwindcss@^4` mais conservait un `tailwind.config.ts` (syntaxe v3) et n'avait pas de `postcss.config.mjs`. Tailwind v4 ignore completement `tailwind.config.ts` et exige un plugin PostCSS dedie.

**Regle a retenir** :
- Tailwind v4 utilise la configuration CSS-first via `@theme {}` dans le fichier CSS principal — pas de `tailwind.config.ts`.
- Le plugin PostCSS de Tailwind v4 s'appelle `@tailwindcss/postcss` (pas `tailwindcss` directement). Il faut creer `postcss.config.mjs` avec `{ plugins: { "@tailwindcss/postcss": {} } }`.
- La detection des fichiers templates est automatique en v4 (pas besoin de `content: [...]`).
- Les couleurs custom se declarent comme `--color-brand-500: #22c55e` dans `@theme {}`.
- Les polices custom se declarent comme `--font-sans: 'Inter', system-ui` dans `@theme {}`.
- Les animations custom vont dans `@keyframes` reguliers en CSS — pas dans `theme.extend.keyframes`.
- Le dark mode via `class` est le comportement par defaut en v4, aucune config necessaire.

**Comment l'eviter** :
- A chaque initialisation d'un projet Next.js avec Tailwind, verifier la version : si `^4`, creer immediatement `postcss.config.mjs` et utiliser `@theme {}`.
- Ne jamais copier un `tailwind.config.ts` d'un projet v3 vers un projet v4.
- Verifier que `@import "tailwindcss"` est bien present (et non `@tailwind base; @tailwind components; @tailwind utilities;` syntaxe v3).

## 2026-04-06 — Audit debug pipeline : patterns de bugs récurrents identifiés

**Erreurs commises (dans le code existant)** :

**1. Resource ID externe en dur sans validation**
- `ADEME_RESOURCE_ID = 'dbe07a87-...'` est un placeholder qui retourne silencieusement `null` à chaque appel.
- Règle : tout identifiant de ressource externe (dataset ID, resource ID, workspace ID) doit être dans `.env` et validé au démarrage avec un test de connectivité.

**2. Fire-and-forget incompatible avec Vercel serverless**
- `promise.catch(...)` lancé après `return NextResponse.json()` est tué par Vercel immédiatement.
- Règle : utiliser `import { after } from 'next/server'` (Next.js 15 natif) pour tout traitement en arrière-plan dans une API Route. Ne jamais utiliser de fire-and-forget nu dans un handler serverless.

**3. Aucun timeout sur les appels LLM**
- Un appel OpenAI sans timeout peut durer 10 minutes et dépasser la limite Vercel (300s).
- Règle : toujours configurer `timeout` sur le client OpenAI (`new OpenAI({ timeout: 30_000 })`) et ajouter un retry avec `maxRetries: 2`.

**4. Run concurrent non protégé**
- Deux runs simultanés peuvent créer une condition de course sur `daily_list_items` (DELETE + INSERT concurrent).
- Règle : toujours vérifier l'absence d'un run `status = 'running'` avant d'en créer un nouveau. Pattern : SELECT FOR UPDATE ou INSERT avec CHECK via trigger.

**5. Merge partiel de settings JSONB**
- Des champs (`notification_email`, `target_postal_codes`) présents dans le schema Zod mais oubliés dans le merge conditionnel → silencieusement ignorés.
- Règle : quand on merge un JSONB, construire le payload merged via une boucle sur les clés du schema Zod plutôt qu'en listant manuellement chaque clé.

**6. Regex UUID : ne pas réinventer une validation qui existe déjà dans le projet**
- Une helper `isValidUUID` correcte existait dans `prospects/[id]/route.ts` mais n'a pas été réutilisée dans `feedback/route.ts` — regex différente et moins stricte.
- Règle : les helpers de validation (UUID, SIREN, date) doivent être dans `lib/utils/validation.ts` et importés partout. Ne jamais dupliquer.

**7. pitchs[] et prospects[] décorrélés sans vérification de longueur**
- Si un batch de pitchs échoue complètement et retourne `[]`, les items créés ont des pitchs vides sans warning visible.
- Règle : quand deux tableaux sont liés par index (items[i] → pitchs[i]), vérifier `pitchs.length >= prospects.length` avant l'étape de construction des items. Si incohérence, logger un warn avec les counts.

**Comment l'éviter** :
- Avant tout run de cron : health check des 3 APIs (INSEE, ADEME, OpenAI) avec log du résultat.
- Avant tout handler API avec body merge : faire la revue exhaustive des clés du schema Zod vs les clés du merge.
- Avant tout lancement d'une Promise dans un handler serverless : vérifier si `after()` est disponible.

## 2026-04-06 — Audit Performance : Pipeline Agent Nocturne

**Ce qui a bien marché dans la conception actuelle** :
- Index composite `idx_prospects_user_score_statut` (migration 003) couvre parfaitement phaseSelection : index-only scan, 5-15ms.
- Dénormalisation `user_id` dans `daily_list_items` validée : policies RLS sans JOIN, O(1).
- Cache token INSEE au niveau module : bonne pratique serverless, économise 1 appel OAuth2 par run warm.
- `Promise.allSettled` pour batchs ADEME et cron multi-user : un échec n'arrête pas les autres.

**Bottleneck principal identifié** :
- `genererPitchsBatch` séquentiel avec delay 500ms = 55-75% du temps pipeline (52-75s sur 62-93s total).
- Le delay 500ms est 4x plus conservateur que nécessaire (RPM gpt-4o = 500 sur compte standard → 120ms minimum).

**Règle à retenir** :
- Pour les pipelines LLM avec plusieurs appels, toujours mesurer le RPM réel de l'API avant de choisir un delay. Groupes de 3-5 appels parallèles + delay entre groupes est optimal vs séquentiel pur.
- Un cron multi-user partageant des credentials API tiers doit tenir compte du rate limit global : 10 users × 2 pages Sirene = 300 req/min vs limite 30 req/min → blocage systématique. Dimensionner les rate limits pour N users dès la conception.

**Risque de scaling critique identifié** :
- Le handler cron Vercel (`Promise.allSettled` de N runs) a un timeout de 300s global. Si N > 5 et qu'un run est lent, le handler expire avant que tous les runs se terminent. Solution : queue asynchrone (Inngest, Trigger.dev).

**Comment l'éviter** :
- Avant d'implémenter un pipeline LLM séquentiel, documenter le RPM de l'API cible et calculer le délai minimum réel.
- Toujours simuler le scénario multi-user dès la conception du cron : multiplier les requêtes API par le nombre d'users attendus et comparer aux rate limits.

## 2026-04-06 — INSEE API : migration OAuth2 → API Key (changement breaking)

**Erreur commise** : L'API Sirene INSEE avait été migrée de `api.insee.fr` vers `portail-api.insee.fr` (commit 5cc69c4) mais l'endpoint `/token` retournait une page HTML Gravitee au lieu de JSON. Le système d'authentification OAuth2 (client_id/secret → Bearer token) avait été **complètement supprimé** par l'INSEE en septembre 2025.

**Règle à retenir** :
- Depuis septembre 2025, l'INSEE utilise une **API Key simple** (header `X-INSEE-Api-Key-Integration`) au lieu du flow OAuth2 (client_credentials).
- L'URL de l'API est `https://api.insee.fr/api-sirene/3.11/siret` (nouveau chemin `/api-sirene/3.11/` au lieu de `/entreprises/sirene/V3.11/`).
- `portail-api.insee.fr` est le **portail développeur** (UI), pas l'API. L'API est sur `api.insee.fr`.
- Les anciennes variables `INSEE_CLIENT_ID` et `INSEE_CLIENT_SECRET` sont remplacées par une seule `INSEE_API_KEY`.

**Comment l'éviter** :
- Quand une API externe retourne du HTML au lieu de JSON, c'est probablement un portail/gateway qui a changé — pas un bug réseau.
- Toujours vérifier le Content-Type de la réponse avant de parser du JSON. Si `text/html`, logger l'erreur clairement.
- Pour les APIs gouvernementales françaises, surveiller les annonces de migration (souvent sur X/Mastodon des comptes officiels).

## 2026-04-06 — Middleware Next.js : ne pas bloquer les routes API

**Erreur commise** : Le middleware Supabase Auth interceptait TOUTES les routes (y compris `/api/*`) et redirigeait vers `/login` quand il n'y a pas de cookie de session. Les endpoints cron/webhook qui s'authentifient via `Authorization: Bearer {CRON_SECRET}` étaient bloqués avant que leur propre logique d'auth ne s'exécute.

**Règle à retenir** :
- Les routes API (`/api/*`) gèrent leur propre authentification (Bearer token, API Key, etc.) — le middleware ne doit PAS interférer.
- Ajouter `isApiRoute = pathname.startsWith('/api/')` dans le middleware et bypasser le redirect auth.
- Le middleware reste utile pour les security headers sur les routes API (X-Content-Type-Options, X-Frame-Options).

**Comment l'éviter** :
- À chaque ajout d'un endpoint API avec une auth non-session (Bearer, API Key, webhook signature), vérifier que le middleware ne le bloque pas.
- Tester les routes API avec curl SANS cookies de session.

## 2026-04-06 — Fallback sourcing : stratégie de résilience API

**Erreur commise** : Quand l'API Sirene INSEE retournait 0 résultats (HTTP 401 silencieux), `sourcerEntreprises()` ne throw pas — elle retourne un tableau vide. L'orchestrateur ne basculait donc pas sur le fallback.

**Règle à retenir** :
- Le fallback doit se déclencher aussi quand le résultat est vide (pas seulement sur une erreur throw).
- L'API Recherche Entreprises (`recherche-entreprises.api.gouv.fr`) est un fallback viable : open data, pas de clé, format similaire.
- Attention : cette API utilise le format NAF AVEC point (`49.41A`) tandis que l'API Sirene utilise SANS point (`4941A`). Les deux conventions existent.

**Comment l'éviter** :
- Pour toute API externe critique, prévoir un fallback et le tester indépendamment.
- Le fallback doit se déclencher sur 3 conditions : (1) throw, (2) résultat vide, (3) résultat invalide.

## 2026-04-06 — API ADEME BEGES : migration CKAN mort → API Data Fair

**Erreur commise** : L'endpoint CKAN (`data.ademe.fr/api/3/action/datastore_search` avec `ADEME_RESOURCE_ID = 'dbe07a87-...'`) était un placeholder hardcodé retournant silencieusement des résultats vides. Le scoring BEGES était donc inopérant depuis l'origine.

**Règle à retenir** :
- Le nouvel endpoint ADEME BEGES est `https://data.ademe.fr/data-fair/api/v1/datasets/bilan-ges/lines?q={siren}&size=5` (API Data Fair).
- Champs utiles : `siren_principal`, `annee_de_reporting`, `date_de_publication`, `responsable_du_suivi`, `fonction`, `courriel`, `id`.
- URL bilan : `https://bilans-ges.ademe.fr/bilans/{id}`.
- Le full-text peut matcher sur la raison_sociale — toujours filtrer sur `siren_principal === siren`.
- Tout identifiant de dataset externe DOIT être en env var, validé au démarrage.

**Comment l'éviter** :
- Avant d'implémenter un appel API externe, tester l'endpoint en curl et vérifier que les champs attendus sont bien présents.

## 2026-04-06 — Scoring BEGES 3 niveaux : absent / expiré / valide

**Règle à retenir** :
- Un BEGES expiré (beges_publie=true, beges_valide=false) est une cible prioritaire — obligation de renouvellement non respectée. Score intermédiaire (15 pts) entre absent (20 pts) et valide (0 pts).
- Tester `beges_valide === false` (strict) : `undefined` signifie "inconnu", traiter comme valide pour ne pas pénaliser.

## 2026-04-06 — Mode append daily_list : ne jamais effacer l'historique des appels

**Règle à retenir** :
- Un DELETE total sur `daily_list_items` efface les appels déjà effectués. Toujours filtrer `.is('called_at', null)` pour ne supprimer que les items non traités.
- Récupérer MAX(ordre) des items conservés et utiliser comme offset pour les nouveaux items.

## 2026-04-06 — API Routes : 6 corrections (BUG-04/05/06/08 + IMP-03/04)

**Règles à retenir** :

**1. after() vs fire-and-forget dans les handlers serverless**
- Un `promise.catch(...)` nu lancé APRES `return NextResponse.json()` est tué immédiatement par Vercel. La réponse HTTP ferme le contexte d'exécution.
- Solution : `import { after } from 'next/server'` — le callback s'exécute après la réponse mais AVANT que la fonction serverless soit détruite. Disponible nativement en Next.js 15.
- Ne jamais écrire : `runSomething().catch(...)` après un `return` dans un handler. Toujours utiliser `after()`.

**2. Constante `now` unique pour éviter les bugs à minuit**
- Si `new Date()` est appelé plusieurs fois dans un handler (calcul targetDate, conditions, message de réponse), les valeurs peuvent différer si le handler s'exécute exactement à minuit.
- Règle : extraire `const now = new Date()` et `const today = now.toISOString().split('T')[0]` comme premières lignes du handler, puis référencer `today` partout.

**3. Merge JSONB exhaustif : révision systématique vs listing manuel**
- Le listing manuel des champs à merger dans un JSONB est sujet aux oublis — si Zod valide N champs, le merge doit couvrir les N mêmes champs.
- Méthode de vérification : compter les clés dans le schema Zod et compter les blocs `...(payload.X !== undefined && { X })` — les deux comptes doivent être égaux.

**4. GET avec effets de bord = violation HTTP**
- Un GET qui envoie des emails et modifie la base de données viole les spécifications HTTP (idempotence et safety).
- Règle : tout handler qui crée, modifie ou déclenche un effet de bord doit être POST, PATCH ou PUT. Les crons Vercel supportent POST nativement.

**5. Regex UUID : toujours utiliser la variante stricte RFC 4122**
- `/^[0-9a-f-]{36}$/` est trop permissive — elle accepte des chaînes du type `"---...---"` (36 tirets).
- Regex correcte : `/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`
- Cette regex valide la variante (1-5) et les variant bits ([89ab]) conformément à RFC 4122.

**6. Vérifier les runs concurrents avant tout lancement d'orchestrateur**
- Deux runs simultanés sur la même table `daily_list_items` créent une condition de course (DELETE/INSERT concurrent).
- Pattern standard : `SELECT id FROM agent_runs WHERE user_id = $1 AND status = 'running' LIMIT 1` avant tout INSERT de run. Si résultat non-null → retourner HTTP 409 avec le `runId` existant.

## 2026-04-06 — Migration DB requise quand on ajoute des colonnes au type Prospect

**Erreur commise** : Ajout de `beges_url` et `beges_valide` dans `lib/types.ts` sans migration SQL. L'upsert Supabase a echoue avec "Could not find the 'beges_url' column".

**Regle a retenir** : Toute nouvelle colonne dans un type TypeScript DOIT avoir une migration SQL. L'upsert doit etre resilient (fallback sans champs manquants si migration non appliquee).

## 2026-04-06 — API ADEME Data Fair : le bon endpoint

**Endpoint correct** : `https://data.ademe.fr/data-fair/api/v1/datasets/bilan-ges/lines?q={siren}&size=5`
**Champs cles** : `siren_principal`, `date_de_publication`, `annee_de_reporting`, `responsable_du_suivi`, `fonction`, `courriel`, `id`
**URL bilan** : `https://bilans-ges.ademe.fr/bilans/{id}`

## 2026-04-06 — Filtre Lucene INSEE Sirene : liste NAF vide → HTTP 400

**Erreur commise** : `nafCodes.map(c => c.replace('.', '')).join(' ')` produit une chaîne vide quand `nafCodes = []`. Le filtre Lucene `activitePrincipaleEtablissement:()` est syntaxiquement invalide → HTTP 400 "Erreur de syntaxe dans le paramètre q".

**Règle à retenir** : Tout filtre Lucene construit dynamiquement doit être conditionnel. Utiliser un tableau `queryParts[]` et n'y `push()` un filtre que si les valeurs sources sont non vides. Ne jamais concatener directement dans une string.

**Comment l'éviter** : Avant tout `.join(' AND ')` sur un filtre Lucene, logger les parts pour vérification. Ajouter un test unitaire avec `nafCodes = []` sur `sourcerEntreprises()`.

## 2026-04-06 — Enrichissement téléphone : API Recherche Entreprises via siege.telephone

**Règle à retenir** : L'API Recherche Entreprises (`recherche-entreprises.api.gouv.fr`) retourne un champ `siege.telephone` qui peut contenir un numéro de standard. C'est la seule source open-data sans token disponible. L'API Entreprise (`entreprise.api.gouv.fr/v3`) et l'API Annuaire Entreprises ne sont pas exploitables sans token ou ne retournent pas de téléphone. Traiter cet enrichissement comme best-effort (silencieux si null).

## 2026-04-06 — Dashboard stale : `force-dynamic` + `.limit(1)` + `.order(referencedTable)`

**Erreur commise** : La page `dashboard/page.tsx` affichait un ancien run échoué même après des runs réussis plus récents, à cause de trois problèmes combinés.

**Règle 1 — `export const dynamic = 'force-dynamic'` sur toute page dashboard** :
Next.js 15 peut mettre en cache les Server Components même quand `cookies()` est utilisé dans un module importé. Pour les pages affichant des données temps-réel (statut agent, métriques), toujours ajouter `export const dynamic = 'force-dynamic'` en tête de fichier.

**Règle 2 — Ne pas combiner `.limit(1)` et `.maybeSingle()`** :
`.maybeSingle()` de postgrest-js v2 impose déjà `LIMIT 1` en interne. Ajouter `.limit(1)` avant est redondant. Forme canonique : `.order('started_at', { ascending: false }).maybeSingle()` — sans `.limit(1)`.

**Règle 3 — Ne pas utiliser `.order(referencedTable)` sur une requête avec `.maybeSingle()`** :
Trier une relation imbriquée via `.order('colonne', { referencedTable: 'table_enfant' })` peut provoquer une multiplication des lignes retournées par postgrest. `.maybeSingle()` retourne alors `null` au lieu de la ligne attendue (erreur PGRST116 silencieuse). Trier côté JS avec `.sort()`.

**Comment l'éviter** :
- Toute page dashboard lisant `agent_runs` ou `daily_lists` → `export const dynamic = 'force-dynamic'`
- Postgrest : `.maybeSingle()` = pas de `.limit(1)`, pas de `.order(referencedTable)`
- Tri des relations imbriquées : toujours côté JS via `.sort()`, jamais via la chaîne postgrest

## 2026-04-06 — Enrichissement contacts : compteur crédits en mémoire module + AbortSignal.timeout()

**Règle à retenir** :
- Pour les APIs avec quotas gratuits (Hunter 50/mois, Pappers 100 total), un compteur en mémoire module (`let _credits = {...}`) est la solution appropriée sur Vercel warm instances. Il se réinitialise à chaque cold start mais couvre les runs intra-session.
- `AbortSignal.timeout(ms)` est disponible nativement en Node.js 18+ et Next.js 15 — préférer à `AbortController` + `setTimeout` pour les timeouts sur fetch. Plus concis et sans fuite mémoire.
- Un accès `process.env.PAPPERS_API_KEY` retourne `undefined` (pas une erreur) si la variable n'est pas définie — utiliser `Boolean(process.env.X)` pour les guards de mode dégradé.
- Les champs contact Supabase peuvent être `null` (valeur DB) mais TypeScript les type comme `string | null`. Lors du passage à `enrichirContact()`, utiliser `?? undefined` pour convertir `null` → `undefined` (le type attendu par `Partial<EnrichedContact>`).

**Comment l'éviter** :
- Avant tout module qui appelle des APIs tierces avec quota, définir le compteur dès la conception et exposer `getCreditsUsed()` pour le logging.
- Toujours vérifier si `AbortSignal.timeout()` est disponible avant d'opter pour la version longue avec AbortController.

## 2026-04-06 — Sourcing fallback : pagination page=1 seulement + déduplication post-fetch

**Erreur commise** : `sourcerEntreprisesFallback()` ne paginait qu'une seule page par code NAF (`page=1` fixe). Avec 13 codes NAF et ~7 résultats/page en Gironde, le plafond était ~96 entreprises. Après le 1er run, tous étaient en base → 0 nouveaux → daily list piochait dans les existants.

**Règle à retenir** :
- Tout sourcing qui pagine doit avoir : (1) une boucle `while (hasMore && count < maxResults && page <= MAX_PAGES)`, (2) un guard anti-boucle infinie (ex: `MAX_PAGES_PER_NAF = 10`), (3) la condition de fin `results.length < perPage → hasMore = false`.
- La déduplication doit se faire EN AMONT du sourcing (passer `excludeSirens: Set<string>` au fallback), pas après. Sinon on fetche des pages entières pour les jeter, et on ne continue pas à paginer pour trouver des nouvelles.
- Le seuil d'effectif doit être calibré selon la densité locale : 200+ salariés en Gironde = ~96 entreprises total tous secteurs confondus. Baisser à 50+ (tranche 21) multiplie le bassin par 5-10x.

**Comment l'éviter** :
- Avant de lancer un sourcing géographiquement ciblé, estimer la taille du bassin : `N codes NAF × résultats/code × pages attendues`. Si < 3× le daily_call_target, élargir les critères avant d'implémenter.
- Tester le fallback indépendamment avec `nafCodes = ['49.41A']` et vérifier que la pagination remonte bien la page 2 quand page 1 = 25 résultats.

## 2026-04-06 — Audit complet pipeline + frontend : 8 corrections

**Erreurs confirmées lors de l'audit** :

**1. `force-dynamic` manquant sur toutes les pages dashboard (5 fichiers + layout)**
- `daily-list/page.tsx`, `prospects/page.tsx`, `pipeline/page.tsx`, `settings/page.tsx` et `layout.tsx` n'avaient pas `export const dynamic = 'force-dynamic'`.
- Next.js 15 peut mettre en cache les Server Components même si `cookies()` est utilisé indirectement dans un module importé.
- Règle : toute page dashboard lisant des données temps-réel (agent_runs, daily_lists, prospects) doit avoir `force-dynamic` comme première ligne après les imports.

**2. `.single()` au lieu de `.maybeSingle()` dans le layout — crash pour les nouveaux utilisateurs**
- Le layout utilisait `.single()` sur `agent_runs` et `daily_lists` — PGRST116 si aucun run n'existe.
- Règle : `.single()` uniquement quand la ligne est GARANTIE par un trigger ou une contrainte DB. Pour toute table qui peut être vide, utiliser `.maybeSingle()`.

**3. `.order(referencedTable)` + `.maybeSingle()` — pattern détecté dans 2 fichiers**
- `api/daily-list/route.ts` + ancienne `daily-list/page.tsx` avaient ce pattern.
- Ce bug est documenté dans hindsight depuis le 2026-04-06 mais continue d'apparaître.
- Règle de vérification avant commit : grepper `.order.*referencedTable` dans tout fichier utilisant `.maybeSingle()`.

**4. `topProspects` email non triés par score**
- La route notifications prenait `items.slice(0, 3)` sans trier — l'email montrait les 3 premiers items insérés, pas les 3 meilleurs. En mode cumulatif, les plus anciens (moins bons scores) apparaissaient.
- Règle : dans tout contexte "top N", trier par score DESC AVANT de slicer.

**Comment l'éviter** :
- Checklist avant merge d'une page/route dashboard :
  1. `export const dynamic = 'force-dynamic'` présent ?
  2. Toutes les queries Supabase utilisent `.maybeSingle()` (sauf lignes garanties par trigger) ?
  3. Aucun `.order(referencedTable)` avant `.maybeSingle()` ?
  4. Tous les "top N" triés explicitement par score avant slice ?

<!-- Les entrées suivantes seront ajoutées automatiquement par Claude après chaque session -->
