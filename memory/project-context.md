---
project: "Agent IA - Prospection Bilan Carbone"
domain: "saas"
type: "context"
created: "2026-04-05"
updated: "2026-05-11"
tags: [project/agent-ia---prospection-bilan-carbone, domain/saas, memory/context]
links:
  - "[[memory/MOC]]"
  - "[[memory/primer]]"
  - "[[memory/session-context]]"
  - "[[CLAUDE]]"
---

# Project Context — Agent IA - Prospection Bilan Carbone

> Fichier de contexte persistant. Mets-le à jour à chaque décision architecturale majeure.
> Index des fiches techniques détaillées : voir `.claude/MEMORY.md`.

---

## Description du projet

**Nom** : Agent IA - Prospection Bilan Carbone (alias **ProspectionAgent**, sous-domaine `decarbonleads.strofe.fr`).
**Domaine** : outil métier pour consultants RSE / bilan carbone (B2B).
**Date de démarrage** : 2026-04-05.

**Objectif** :
L'agent fait tout le travail amont (recherche d'entreprises soumises à l'obligation BEGES, qualification, scoring, préparation des pitchs). L'humain n'a plus qu'à décrocher son téléphone le matin avec une liste de 15 appels du jour, chacun avec un pitch sur-mesure, des objections préparées et un persona cible identifié.

Cible utilisateur : consultants RSE/bilan carbone en France prospectant les entreprises > 250 salariés soumises à l'obligation BEGES (article L229-25 du Code de l'environnement) mais n'ayant rien publié ou ayant un BEGES expiré. Secteurs prioritaires : logistique, aérospatial, viticulture, agro-alimentaire.

---

## Stack technique réelle

- **Next.js 15.5.14** (App Router, Turbopack) + React 19, TypeScript 5 strict
- **Tailwind CSS v4** (brut, pas de shadcn/Radix) + **next-themes** (dark mode)
- **Supabase** (`@supabase/ssr` 0.10, `@supabase/supabase-js` 2.49) — Postgres + Auth, RLS par `user_id`
- **OpenAI SDK 4.89** — modèle `gpt-4o` (génération pitchs)
- **Resend 4.2** + `@react-email/components` (emails transactionnels)
- **Zod 3.24** — validation aux frontières d'API
- **Vitest 3.1** + jsdom + `@testing-library/react` (tests)
- **Sentry 9** (`@sentry/nextjs`) — erreurs serveur + client
- **Vercel** — hébergement + crons (déclarés dans `vercel.json`)

Pas de Stripe (v1 sans monétisation), pas de Clerk (Supabase Auth), pas de Redis, pas de Python/FastAPI, pas de LaunchDarkly, pas de k6/Locust, pas de Datadog, pas de PostHog.

---

## Architecture

| Couche | Choix | Justification |
|--------|-------|---------------|
| Frontend + API | Next.js 15 App Router (TS) | Server Components + API Routes serverless dans un seul repo |
| Base de données | Supabase (PostgreSQL + RLS) | Auth intégrée, RLS native (isolation par `user_id`), gratuit |
| Authentification | Supabase Auth (email + magic link) | Pas de session custom à maintenir |
| LLM | OpenAI GPT-4o | Choix utilisateur, bon rapport qualité/prix |
| Sourcing primaire | API Sirene INSEE (OAuth2, token 7j) | Source légale de référence des établissements français |
| Sourcing fallback | Recherche Entreprises gouv (open data) | Gratuit, pas d'auth, illimité — bascule si Sirene down |
| Enrichissement BEGES | ADEME `data.ademe.fr` | API publique, source officielle des bilans déposés |
| Enrichissement contact | Recherche Entreprises → Pappers → Hunter.io | Cascade gratuit → payant ; économise les crédits |
| Emails | Resend (3000/mois gratuit) | Templates React Email, simple à intégrer |
| Monitoring | Sentry + Vercel Analytics | Erreurs serveur/client + perf |
| Déploiement | Vercel | Auto-deploy GitHub, crons natifs |
| CI/CD | GitHub Actions (à confirmer) | lint + types + tests + build |
| Domaine | `decarbonleads.strofe.fr` | Sous-domaine du domaine `strofe.fr` déjà possédé |

### Pipeline en 30 secondes

Cron Vercel 22h → `/api/agent/run` (Bearer `CRON_SECRET`) → `lib/agent/orchestrator.ts` :
1. **Sourcing** Sirene (200 max), fallback Recherche Entreprises si KO ;
2. **Enrichissement** ADEME BEGES en batches de 20 parallèles ;
3. **Scoring** composite 0-100 (obligation BEGES +30 / secteur prio +20 / BEGES non publié +20 ou expiré +15 / signaux +15 / taille +10 / contact tel +5 / pénalités) ;
4. **Sélection** top 15 (`daily_call_target`) statut `sourced|qualified` + BEGES manquant/expiré, hors prospects déjà dans la liste du jour ;
5. **Enrichissement contact** top 10 score>70 sans email/tel via Pappers + Hunter (séquentiel, économie crédits) ;
6. **Génération pitchs** GPT-4o en groupes de 5 parallèles, délai 150 ms ;
7. **Construction** `daily_lists` + `daily_list_items` (mode append cumulatif).

Cron Vercel 7h30 jours ouvrés → `/api/notifications/daily` → email Resend "votre liste de 15 appels est prête" (garde-fou `daily_lists.notified_at`).

Détails complets : voir `.claude/context/pipeline-nightly.md`.

---

## Tables Supabase (résumé)

| Table | Rôle |
|-------|------|
| `profiles` | Extension de `auth.users` : settings JSONB (offre, NAF cibles, ville, codes postaux, daily_call_target), `onboarded` |
| `prospects` | Entreprises sourcées : identité Sirene, BEGES, score 0-100, statut CRM, signaux. UNIQUE(user_id, siren) |
| `daily_lists` | 1 ligne par (user_id, date) : statut pending → generating → ready → completed, `notified_at` |
| `daily_list_items` | Les ~15 appels du jour : pitch GPT, accroche, objections, persona, résultat appel |
| `agent_runs` | Journal cron : phase, compteurs, logs JSONB chronologiques, status running/completed/failed |

RLS strict (`auth.uid()=user_id` ou `auth.uid()=id` pour profiles) sur les 5 tables, 4 policies S/I/U/D. Schéma SQL détaillé dans `supabase/migrations/001_initial.sql` (+ migrations 002-004). Description fonctionnelle dans `.claude/context/data-model.md`.

---

## Décisions techniques clés

| Date | Décision | Raison | Alternatives écartées |
|------|----------|--------|----------------------|
| 2026-04-05 | Initialisation du projet | Setup initial | — |
| 2026-04-05 | Next.js 15 App Router (mono-repo) | Server Components + API Routes serverless | FastAPI séparé (trop de complexité pour mono-utilisateur) |
| 2026-04-05 | OpenAI GPT-4o pour le LLM | Choix utilisateur | Claude Sonnet (préférence) |
| 2026-04-05 | Supabase (Postgres + Auth) | RLS natif, auth gratuite, SDK Next.js (`@supabase/ssr`) | Postgres custom + NextAuth |
| 2026-04-05 | Sous-domaine `decarbonleads.strofe.fr` | Domaine `strofe.fr` déjà possédé, plus descriptif que `app.strofe.fr` | Nouveau domaine (coût), chemin /path (impossible cross-host) |
| 2026-04-05 | Resend pour les emails | 3000/mois gratuit, React Email templates | SendGrid (plus complexe), Nodemailer (pas de dashboard) |
| 2026-04-05 | Pas de Stripe en v1 | Produit à valider avant monétisation | Stripe dès le début (prématuré) |
| 2026-04-05 | ENUM PostgreSQL pour les statuts | Sécurité valeurs au niveau DB, lisibilité schéma | CHECK constraints (moins expressives) |
| 2026-04-05 | `user_id` dénormalisé dans `daily_list_items` | RLS sans jointure coûteuse sur `daily_lists` | JOIN dans la policy RLS (perf dégradée sur gros volumes) |
| 2026-04-05 | JSONB pour `settings`, `score_details`, `signaux`, `logs` | Flexibilité d'évolution sans migration, indexable GIN | Colonnes séparées (rigidité), EAV (anti-pattern) |
| 2026-04-05 | Sourcing primaire Sirene + fallback Recherche Entreprises | Sirene = source de référence ; fallback = robustesse | Sirene seul (single point of failure) |
| 2026-04-05 | Cascade enrichissement contact gratuit → payant | Économie crédits Pappers/Hunter | Tout payant (coût), tout gratuit (couverture incomplète) |
| 2026-04-05 | Batches parallèles 20 (ADEME) et 5 (OpenAI) | Latence x10 vs séquentiel, sans dépasser rate limits | Séquentiel (60s vs 4s pour 200 prospects) |
| 2026-04-05 | Mode "append cumulatif" pour `daily_list_items` | Idempotence cron + conservation historique d'appels | DELETE+INSERT (perte des appels en cours) |
| 2026-04-05 | `crypto.timingSafeEqual` avec padding 128 octets pour `CRON_SECRET` | Anti-timing attack + anti-leak de longueur | Comparaison `===` (vulnérable timing) |

---

## Fonctionnalités principales

- [x] Sourcing nocturne Sirene + fallback open data
- [x] Enrichissement BEGES via ADEME
- [x] Scoring composite 0-100
- [x] Enrichissement contact en cascade (Pappers + Hunter)
- [x] Génération pitchs GPT-4o parallèle
- [x] Daily list + items (mode append cumulatif)
- [x] Notification email matinale (7h30 jours ouvrés)
- [x] Dashboard utilisateur (daily-list, prospects, pipeline, settings)
- [ ] Reporting de performance d'appels (taux conversion par persona/secteur)
- [ ] Import CSV manuel de prospects
- [ ] Intégration CRM tiers (à évaluer plus tard)

---

## Préoccupations métier — toujours garder en tête

- **Qualité des pitchs** : l'ordre des arguments (gains financiers → image de marque → contrainte légale) est testé en field et **non négociable** sans dry-run.
- **Conformité RGPD** : les données prospects contiennent emails et téléphones de personnes physiques (dirigeants). Sentry `beforeSend` doit scrubber. Pas de partage hors plateforme.
- **Idempotence du cron** : Vercel retry 1× sur non-200. Tout endpoint cron doit pouvoir être appelé 2× sans effet de bord (vérifié via anti-concurrence `agent_runs` + upsert `daily_lists` + exclusion prospects déjà dans la liste).
- **Coût OpenAI** : 15 pitchs/user/jour × N users. Surveiller la facturation.
- **Crédits Pappers/Hunter** : phase 4.5 séquentielle + cap à 10 prospects pour préserver le free tier.

---

## Contraintes et limites connues

- Cron Vercel 22h en UTC = 23h Paris hiver / 00h été. À expliciter aux utilisateurs.
- `maxDuration = 300` sur `/api/agent/run` exige le plan Vercel Pro pour N users en parallèle.
- Hunter.io gratuit = 25 recherches/mois → cap à 10 prospects enrichis/run.
- Sirene OAuth2 token valide 7 jours → rafraîchissement automatique en mémoire (vérifier la persistance après redémarrage cold start serverless).
- Pas encore de mécanisme de re-scoring périodique des prospects existants (le scoring se fait à l'insertion).

---

## Équipe

- **Développeur principal** : Samir Anbri (`samir.anbri@gmail.com`).
- **Cible utilisateur** : consultants RSE / bilan carbone indépendants en France (notamment Gironde / Bordeaux).
- **Environnements** : dev (local) / preview (Vercel par PR) / production (`decarbonleads.strofe.fr`).

---

## Pour approfondir

- Index des fiches techniques : `.claude/MEMORY.md`.
- Fiches détaillées : `.claude/context/` (pipeline-nightly, data-model, routes, beges-glossary, scoring-rules, external-apis, prompts-guide, crons, security).
- Journal des leçons : `memory/hindsight.md`.
- Glossaire / connaissance de fond : `memory/primer.md`.
