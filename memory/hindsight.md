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

## 2026-04-05 — Apostrophes typographiques dans les string literals TypeScript

**Erreur commise** : Les descriptions dans les tableaux STEPS et TIPS du template welcome.tsx contenaient des apostrophes typographiques (`'` U+2019) à l'intérieur de string literals délimités par des apostrophes ASCII (`'`). TypeScript parse ces caractères comme la fin de la string, générant des erreurs TS1005 et TS1002 en cascade.

**Règle à retenir** : Dans les string literals TypeScript, les apostrophes typographiques sont valides dans le contenu JSX (rendu HTML) mais invalides comme délimiteurs. Si le texte contient une apostrophe (`n'avez`, `l'agent`), utiliser les double-quotes (`"...n'avez..."`) ou des template literals.

**Comment l'éviter** : Avant d'écrire des templates email avec du texte français, repérer les contractions (n', l', qu', c', j', s') et choisir systématiquement les double-quotes pour ces strings. Lancer `tsc --noEmit` immédiatement après la création de tout nouveau fichier.

<!-- Les entrées suivantes seront ajoutées automatiquement par Claude après chaque session -->
