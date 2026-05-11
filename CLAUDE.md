# CLAUDE.md — ProspectionAgent

Agent de prospection automatique pour consultants en bilan carbone (BEGES) : sourcing nocturne d'entreprises soumises à l'obligation, scoring, génération de pitchs GPT-4o, livraison d'une liste de 15 appels/jour.

---

## Stack

- **Next.js 15.5.14** (App Router, Turbopack) + React 19, TypeScript 5 strict
- **Tailwind CSS v4** (brut, pas de shadcn/Radix), **next-themes** (dark mode)
- **Supabase** (`@supabase/ssr` 0.10, `@supabase/supabase-js` 2.49) — Postgres + Auth, RLS par `user_id`
- **OpenAI SDK 4.89** — modèle `gpt-4o` (pitchs)
- **Resend 4.2** + `@react-email/components` (emails transactionnels)
- **Zod 3.24** (validation aux frontières)
- **Vitest 3.1** + jsdom + `@testing-library/react`
- **Sentry 9** (`@sentry/nextjs`)
- **Vercel** (hébergement + crons via `vercel.json`)

Pas de Stripe, Clerk, Redis, Python/FastAPI, LaunchDarkly, k6/Locust, Datadog, PostHog.

---

## Architecture en 30 secondes

Cron Vercel 22h → `/api/agent/run` (Bearer CRON_SECRET) → `lib/agent/orchestrator.ts` → pour chaque user onboardé : sourcing Sirene INSEE (fallback Recherche Entreprises gouv) → enrichissement ADEME BEGES (batches de 20) → scoring composite 0-100 → top 15 non-appelés → enrichissement contact en cascade (Recherche Entreprises → Pappers → Hunter.io) → génération pitchs GPT-4o parallèle (groupes de 5) → insertion `daily_list` + items. Cron 7h30 jours ouvrés → `/api/notifications/daily` → email Resend "votre liste est prête".

---

## Modèle de données

- **`profiles`** — extension de `auth.users` : settings JSONB (offre, secteurs NAF cibles, ville, codes postaux, daily_call_target), flag `onboarded`.
- **`prospects`** — entreprises sourcées, identité Sirene, BEGES, score 0-100, statut CRM (sourced → qualified → contacted → interested → rdv → converted / rejected / on_hold), unique `(user_id, siren)`.
- **`daily_lists`** — 1 ligne par `(user_id, date)`, statut pending → generating → ready → completed, `notified_at` pour éviter double envoi email.
- **`daily_list_items`** — les 15 appels du jour : prospect, ordre, pitch, accroche, objections, `contact_type`, résultat d'appel renseigné par l'humain (`call_result`, `callback_date`, `call_notes`).
- **`agent_runs`** — journal cron : phase courante, compteurs (sourced/qualified), logs JSONB chronologiques, statut running → completed/failed.

Détails : [.claude/context/data-model.md](.claude/context/data-model.md).

---

## Sécurité non négociable

- **RLS strict** sur les 5 tables : `auth.uid() = user_id` (4 policies S/I/U/D par table). Jamais ajouter de filtre redondant `.eq('user_id', userId)` dans le code applicatif (sauf orchestrator avec service role).
- **CRON_SECRET** : comparaison timing-safe (`crypto.timingSafeEqual` avec padding 128 octets) dans `/api/agent/run`. Jamais loggé.
- **Service role key** (`SUPABASE_SERVICE_ROLE_KEY`) : exclusivement serveur dans l'orchestrator. Jamais dans un Client Component, jamais exposée au navigateur.
- **Secrets** : `.env.local` jamais commité. Production via Vercel project settings.
- **Validation Zod** sur tous les bodies d'API entrants.
- **Sentry** : `beforeSend` scrub PII (email/téléphone des prospects).

---

## Conventions

- TypeScript strict, types partagés dans `lib/types.ts` et `lib/supabase/database.types.ts` (généré).
- **Zod aux frontières uniquement** : API routes, parsing externe. Pas de Zod en interne entre fonctions typées.
- **RLS implicite** : les requêtes Supabase côté user (createClient SSR) sont déjà filtrées par RLS — ne pas doubler par un `.eq('user_id', ...)`. Côté orchestrator (admin/service_role), on filtre explicitement.
- **Prompts versionnés** : tout changement au SYSTEM_PROMPT de `lib/agent/pitch-gen.ts` → entrée dans `memory/hindsight.md` + dry-run sur 3 prospects test avant déploiement.
- **Tailwind v4 brut** : pas de composants UI tiers. Conventions de classes alignées avec `app/globals.css`.
- **Logs structurés JSON** dans l'orchestrator (`{ts, level, phase, msg, meta}`), persistés dans `agent_runs.logs`.

---

## Fichiers à consulter

- **`.claude/MEMORY.md`** — index des notes de contexte ciblées.
- **`.claude/context/`** — fiches détaillées (pipeline, scoring, APIs, prompts, crons, sécurité, etc.).
- `memory/primer.md` — glossaire et connaissance domaine (fond).
- `memory/hindsight.md` — leçons apprises (toujours relire avant changement sensible).
- `memory/session-context.md` — objectif de la session courante.
- `memory/prompt-history.md` — historique des tâches.

---

## Commandes utiles

```powershell
npm run dev          # Next dev (Turbopack)
npm run build        # Production build
npm run type-check   # tsc --noEmit
npm run test         # Vitest run
npm run test:watch
npm run lint

# Migrations Supabase
npx supabase migration new <nom_migration>
npx supabase db push

# Test local du cron (PowerShell)
curl -H "Authorization: Bearer $env:CRON_SECRET" -X POST http://localhost:3000/api/agent/run
```
