# Cache SIRENE — Guide d'utilisation

> Document utilisateur : pourquoi le cache SIRENE existe, comment il est cablé,
> comment l'opérer au quotidien. Pour les détails techniques internes voir
> `docs/sirene-bulk-import.md` (POC) et `docs/sirene-cache-cron.md` (CI).

---

## Pourquoi ce cache ?

- L'API Sirene INSEE (`api.insee.fr/api-sirene/3.11/siret`) plante de manière
  persistante :
  - HTTP 400 silencieux sur tokens NAF non quotés (regressions debug 2026-04-06,
    2026-05-12, 2026-05-17 — voir `lib/agent/__tests__/sirene-integration.test.ts`).
  - Throttling agressif et rupture OAuth → API Key en sept. 2025.
  - "Univers de recherche épuisé" sur le sourcing nocturne.
- Solution adoptée : **bulk download mensuel CSV → cache Supabase**.
  Robuste, autonome, gratuit, données INSEE publiques sans PII.

## Architecture

```
[GitHub Actions, 1er du mois 04:00 UTC]
        |
        v
[Download CSV 700 MB ZIP depuis files.data.gouv.fr]
        |
        v
[Stream parse + filtre BEGES strict (early-skip)]
        |
        v
[Upsert Supabase `sirene_cache` (~80-100k rows, ~80-100 MB)]
        |
        v
[Runtime sourcing : search SQL via PL/pgSQL `search_sirene_cache()`]
```

Composants :

| Fichier | Rôle |
| --- | --- |
| `supabase/migrations/018_sirene_cache.sql` | Table `sirene_cache` + RLS + 3 index partiels |
| `supabase/migrations/019_sirene_search_function.sql` | Fonction `search_sirene_cache()` + vue `sirene_cache_size` + 3 index composites |
| `scripts/import-sirene-bulk.ts` | ETL bulk : download → unzip → parse → filtre → upsert |
| `app/api/admin/sirene-import/route.ts` | Sanity-check pré-import (Vercel ne peut pas exécuter l'ETL — 15-30 min) |
| `app/api/admin/sirene-status/route.ts` | Status courant + freshness (dual-auth cron / session) |
| `.github/workflows/sirene-import.yml` | Cron mensuel hors Vercel |

## Filtre BEGES strict appliqué à l'ETL

Appliqué côté `scripts/import-sirene-bulk.ts` (early-skip ligne par ligne pour
ne pas faire exploser la mémoire sur 30 M de lignes) :

- État administratif = `A` (actif).
- Tranche effectifs ∈ `{21, 22, 31, 32, 41, 42, 51, 52, 53}` (>= 10 salariés).
- Section NAF dérivée ∈ `{A, C, D, E, F, H}` (Agriculture, Industrie, Énergie,
  Eau/déchets, Construction, Transport — secteurs BEGES prioritaires).
- Établissement siège uniquement (`etablissementSiege === 'true'`).
- Métropole : pas de filtre géo dur côté ETL ; le filtrage par code postal user
  se fait au runtime via `search_sirene_cache()`.

Volume cible : **~80-100k entreprises** (vs ~30 M lignes brutes INSEE).
Storage cible : **~80-100 MB** (garde-fou ETL à 100 MB par défaut, configurable
via `MAX_STORAGE_MB`).

## Setup initial (à faire une fois)

1. **Appliquer les migrations** :

   ```powershell
   npx supabase db push
   npx supabase gen types typescript --linked > lib/supabase/database.types.ts
   ```

2. **Configurer les secrets GitHub** (Repo > Settings > Secrets > Actions) :

   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (sensible, upsert massif)
   - `CRON_SECRET` (reuse du secret Vercel)
   - `APP_URL` (ex. `https://decarbonleads.strofe.fr`)

3. **Premier import** (15-30 min) :

   - Via GH UI : Actions > "Sirene Cache Monthly Import" > Run workflow > `force=true`.
   - Ou en local : `npm run import-sirene` (Node 22.6+ requis pour
     `--experimental-strip-types`, `.env.local` avec les deux vars Supabase).

4. **Vérifier le statut** :

   - Widget UI : Settings > "Cache SIRENE" (count + freshness).
   - API : `GET /api/admin/sirene-status` (Bearer `CRON_SECRET` OU session SSR).

## Refresh mensuel

- **Auto** : GitHub Actions, 1er du mois à 04:00 UTC (cron `0 4 1 * *`).
- **Skip auto** si `days_since_import < 25` (évite double import dans le mois).
- **Trigger manuel** : `gh workflow run sirene-import.yml -f force=true`.

## Troubleshooting

| Symptôme | Cause probable | Fix |
| --- | --- | --- |
| Storage > 100 MB pendant l'ETL | Filtre trop large ou retry de blocs déjà upsertés | L'ETL abort auto (exit 2). Affiner le filtre `KEPT_TRANCHES` / `KEPT_NAF_SECTIONS` ou bumper `MAX_STORAGE_MB` |
| Cache stale (> 60 j) | Cron raté | Trigger manuel `gh workflow run sirene-import.yml -f force=true`. Le runner sourcing fallback sur Recherche Entreprises gouv |
| Import échec en CI | data.gouv.fr 5xx, throttling, ZIP corrompu | Voir Actions tab + logs Sentry. Re-trigger. Le script fait déjà 3 retries avec backoff exponentiel |
| `400` côté `/api/admin/sirene-status` | Vue `sirene_cache_size` absente | Vérifier que `019_sirene_search_function.sql` est bien appliquée (pas seulement `019_sirene_cache_size.sql` qui n'expose pas `days_since_import`) |

## Coût mensuel

- Supabase Free : **0 €** (cache 80-100 MB / 500 MB free tier).
- GitHub Actions : **0 €** (30 min / 2000 min free tier).
- Bande passante : **0 €** (download 700 MB / 5 GB egress Supabase).
- **Total : 0 €**.

## Liens utiles

- POC technique : [`docs/sirene-bulk-import.md`](./sirene-bulk-import.md)
- CI cron : [`docs/sirene-cache-cron.md`](./sirene-cache-cron.md)
- Tests régression API Sirene : `lib/agent/__tests__/sirene-integration.test.ts`
