# CI/CD — ProspectionAgent

Ce document decrit la chaine d'integration et de deploiement continu du projet
(Next.js + Supabase, deploye sur Vercel). Tous les workflows sont definis dans
`.github/workflows/` et la configuration des crons Vercel dans `vercel.json`.

> Stack : Next.js (App Router), Supabase, Vercel. Application **en production**
> (2 clients). Toute intervention sur la CI/CD doit preserver le comportement
> existant et ne jamais exposer la prod ou la base.

## Vue d'ensemble

| Workflow                | Fichier                              | Declencheur                                  | Role |
|-------------------------|--------------------------------------|----------------------------------------------|------|
| CI                      | `.github/workflows/ci.yml`           | push `develop`/`main`, PR vers `main`        | Qualite : lint, typecheck, tests+coverage, build |
| Deploy Preview          | `.github/workflows/deploy-preview.yml` | PR vers `main` (opened/synchronize/reopened) | Gate tests -> deploiement Vercel preview + commentaire PR |
| Sirene Cache Monthly    | `.github/workflows/sirene-import.yml`  | cron mensuel + `workflow_dispatch`           | Import ETL mensuel des donnees SIRENE |

---

## 1. `ci.yml` — Integration continue

**Declencheurs**

- `push` sur `develop` et `main`
- `pull_request` ciblant `main`

**Concurrency** — `group: ci-${{ github.ref }}`, `cancel-in-progress: true` :
un nouveau push sur la meme branche/PR annule le run precedent encore en cours
(economie de minutes GitHub Actions).

**Jobs**

1. **lint** (`runs-on: ubuntu-latest`)
   - `actions/checkout@v4` + `actions/setup-node@v4` (Node 20, `cache: 'npm'`)
   - `npm ci`
   - `npm run lint` (= `next lint`)

2. **typecheck**
   - Memes etapes d'install (Node 20, cache npm)
   - `npm run type-check` (= `tsc --noEmit`)

3. **test** (Unit Tests)
   - Memes etapes d'install
   - `npm run test:coverage` (= `vitest run --coverage`)
   - Upload de l'artefact `coverage/` via `actions/upload-artifact@v4`
     (`if: always()`, retention 7 jours) — meme en cas d'echec.

4. **build**
   - `needs: [lint, typecheck, test]` — ne s'execute que si les trois jobs
     precedents passent (gate qualite avant build).
   - Variables d'environnement **fictives** (placeholders) pour que `next build`
     n'echoue pas en CI sans donner acces a aucune ressource reelle :
     `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SENTRY_DSN`, et cote serveur pour
     `@sentry/nextjs` (`withSentryConfig`) : `SENTRY_ORG`, `SENTRY_PROJECT`,
     `SENTRY_AUTH_TOKEN`.
   - **Cache** : en plus du cache npm (`setup-node`), le repertoire `.next/cache`
     est mis en cache via `actions/cache@v4`. Cle :
     `nextjs-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}-${{ hashFiles('**/*.ts','**/*.tsx') }}`
     avec `restore-keys` retombant sur la cle sans le hash du code source
     (acceleration des builds successifs).
   - `npm run build` (= `next build`)

---

## 2. `deploy-preview.yml` — Deploiement preview Vercel

**Declencheur** — `pull_request` vers `main`, types `opened`, `synchronize`,
`reopened`.

**Concurrency** — `group: deploy-preview-${{ github.event.pull_request.number }}`,
`cancel-in-progress: true` : un nouveau commit sur la PR annule le deploiement
preview en cours.

**Jobs**

1. **test (pre-deploy gate)** — `npm ci` puis `npm run test` (= `vitest run`).
   Les tests tournent **avant** tout deploiement (fail fast).

2. **deploy-preview** — `needs: [test]`, `permissions: pull-requests: write`
   (requis pour commenter la PR).
   - Install Vercel CLI : `npm install --global vercel@latest`
   - `vercel pull --yes --environment=preview --token=$VERCEL_TOKEN`
     (recupere la config et les variables d'environnement Vercel **preview**)
   - `vercel build --token=$VERCEL_TOKEN` (les vraies variables viennent de
     Vercel via `pull` ; des placeholders servent de repli si les secrets GitHub
     correspondants sont absents)
   - `vercel deploy --prebuilt --token=$VERCEL_TOKEN` -> URL de preview exposee
     en sortie d'etape (`preview_url`)
   - **Commentaire PR** via `actions/github-script@v7` : recherche un commentaire
     bot existant contenant « Vercel Preview » et le **met a jour** (sinon en
     cree un nouveau). Le commentaire affiche l'URL, le SHA court du commit et le
     statut — rafraichi a chaque commit.

---

## 3. `sirene-import.yml` — Import mensuel SIRENE

**Declencheurs**

- `schedule` : cron `0 4 1 * *` — le 1er de chaque mois a 04:00 UTC
  (~05:00 Paris hiver / 06:00 ete).
- `workflow_dispatch` : trigger manuel (UI GitHub ou `gh workflow run`) avec un
  input booleen `force` (defaut `false`) pour outrepasser le check de fraicheur.

**Environment** — `Production – strofe-prospection-agent`. Les secrets de cet
**Environment** GitHub sont injectes automatiquement dans le job
(`APP_URL`, `CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`). `timeout-minutes: 60`.

**Variables d'environnement du job** : `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, plus `MAX_STORAGE_MB=100` et `SIRENE_BATCH_SIZE=500`.

**Etapes**

1. `checkout` + `setup-node` (Node **22**, cache npm) + `npm ci`.
2. **Freshness check** (`if: !inputs.force`) : appel a
   `/api/admin/sirene-status` (Bearer `CRON_SECRET`) pour lire
   `days_since_import`. Si **< 25 jours**, l'etape positionne `skip=true` et
   emet un `::notice::` ; sinon `skip=false`.
3. **Run SIRENE import ETL** (`if: skip != 'true' || inputs.force`) :
   `npm run import-sirene`, `timeout-minutes: 45`.
4. **Verify post-import status** : re-appel a `/api/admin/sirene-status` (log JSON).
5. **Notify on failure** (`if: failure()`) : `::error::` + emplacement prevu pour
   un webhook Discord/Slack.

> Note : l'application possede aussi des crons **Vercel** (voir ci-dessous),
> distincts de ce workflow GitHub Actions.

---

## Vercel : Preview vs Production

| Aspect            | Preview                                        | Production |
|-------------------|------------------------------------------------|------------|
| Declenchement     | Chaque PR vers `main` (via `deploy-preview.yml`) | Merge sur `main` (deploiement Vercel) |
| Environnement Vercel | `preview` (`vercel pull --environment=preview`) | `production` |
| URL               | URL ephemere par PR, commentee dans la PR      | Domaine de production (2 clients) |
| Variables d'env   | Scope **Preview** de Vercel                    | Scope **Production** de Vercel |
| Crons (`vercel.json`) | Non actifs sur les previews                 | Actifs : voir tableau ci-dessous |

**Crons Vercel** (definis dans `vercel.json`, actifs en production) :

| Path                          | Schedule (UTC) | Role |
|-------------------------------|----------------|------|
| `/api/agent/run`              | `0 22 * * *`   | Run quotidien de l'agent de prospection |
| `/api/agent/reap-stale`       | `0 4 * * *`    | Nettoyage des executions agent bloquees |
| `/api/cron/purge-prospects`   | `0 3 * * *`    | Purge quotidienne des prospects |

---

## Matrice des secrets requis

Noms uniquement (les valeurs ne sont jamais committees). Repartition par
emplacement de configuration.

### Secrets GitHub Actions (repository / org)

| Secret                          | Utilise par            | Usage |
|---------------------------------|------------------------|-------|
| `VERCEL_TOKEN`                  | `deploy-preview.yml`   | Authentification Vercel CLI (pull/build/deploy) |
| `NEXT_PUBLIC_SUPABASE_URL`      | `deploy-preview.yml`   | Repli build preview (sinon placeholder) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `deploy-preview.yml`   | Repli build preview (sinon placeholder) |
| `NEXT_PUBLIC_APP_URL`           | `deploy-preview.yml`   | Repli build preview (sinon placeholder) |

> `GITHUB_TOKEN` est fourni automatiquement par GitHub Actions (commentaire PR
> via `permissions: pull-requests: write`) — aucune declaration manuelle.

### Secrets GitHub Environment (`Production – strofe-prospection-agent`)

| Secret                       | Utilise par         | Usage |
|------------------------------|---------------------|-------|
| `APP_URL`                    | `sirene-import.yml` | Base URL pour appeler `/api/admin/sirene-status` |
| `CRON_SECRET`                | `sirene-import.yml` | Bearer d'authentification des endpoints admin/cron |
| `NEXT_PUBLIC_SUPABASE_URL`   | `sirene-import.yml` | Connexion Supabase (ETL) |
| `SUPABASE_SERVICE_ROLE_KEY`  | `sirene-import.yml` | Cle service role Supabase (ETL, ecriture cache SIRENE) |

### Variables Vercel (Preview + Production)

Configurees dans le dashboard Vercel, recuperees via `vercel pull`. Au minimum :

| Variable                        | Scope                  |
|---------------------------------|------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`      | Preview + Production    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Preview + Production    |
| `NEXT_PUBLIC_APP_URL`           | Preview + Production    |
| `SUPABASE_SERVICE_ROLE_KEY`     | Production (cote serveur) |
| `CRON_SECRET`                   | Production (auth crons Vercel) |
| `NEXT_PUBLIC_SENTRY_DSN`        | Preview + Production    |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | Production (build Sentry) |

> Les variables `NEXT_PUBLIC_*` sont exposees au navigateur (cote client) ; les
> autres restent strictement cote serveur.

---

## Dependabot

Les mises a jour de dependances sont gerees par `.github/dependabot.yml` :
ecosystemes `npm` (racine `/`) et `github-actions` (racine `/`), cadence
**hebdomadaire** (lundi). Les mises a jour **patch** et **minor** sont
regroupees pour limiter le nombre de PR ; les **major** restent en PR
individuelles pour revue manuelle.
