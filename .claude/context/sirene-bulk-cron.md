# Bulk SIRENE — Cron mensuel GitHub Actions

> Sourcing primaire des entreprises depuis le 2026-05-17.
> Remplace l'API Sirene live INSEE (instable, quotas, HTTP 400 Solr).
> Source : data.gouv.fr (open data, sans clé API).

---

## Pourquoi un cron externe (pas Vercel)

- L'ETL prend **30-40 min** (download ~1.1 GB, parse 43M lignes, upsert ~11k).
- Vercel Hobby = `maxDuration` 60s (300s sur Pro étendu).
- **Vercel Hobby = 1 cron/jour max** — déjà occupé par `reap-stale` (`vercel.json`).
- → GH Actions = runner gratuit Ubuntu, timeout 6h, secrets gérés par environment.

## Architecture en 30 secondes

```
1er du mois 04:00 UTC
       │
       ▼
GitHub Actions "Sirene Cache Monthly Import"
       │
       ▼
freshness check ──▶ skip si < 25 jours (sauf force=true)
       │
       ▼
npm run import-sirene  (Node 22, ~35 min)
       │
       ├─▶ resolveStockEtablissementUrl()  ─▶ data.gouv.fr/api/1/datasets/<slug>/
       │   (résolution dynamique, l'id change chaque mois)
       │
       ├─▶ download ZIP  (~1.1 GB, retry x3)
       │
       ├─▶ unzip + csv-parse en flux
       │
       ├─▶ filtre BEGES (etat=A + siege=true + tranche≥10 + section ACDEFH)
       │
       └─▶ upsert batch 500 dans `sirene_cache` (Supabase service_role)
              ↳ garde-fou : abort si > 100 MB (cap Free tier)
       │
       ▼
status post-import (curl /api/admin/sirene-status)
```

## Fichiers en jeu

| Fichier | Rôle |
|---|---|
| `.github/workflows/sirene-import.yml` | Workflow GH Actions (cron + dispatch) |
| `scripts/import-sirene-bulk.ts` | ETL Node 22 (résolution + download + filtre + upsert) |
| `app/api/admin/sirene-status/route.ts` | Endpoint Bearer CRON_SECRET → métadonnées cache |
| `app/api/admin/sirene-import/route.ts` | Sanity-check pré-import (ne lance pas l'ETL — Vercel timeout) |
| `lib/agent/sirene-cache.ts` | `searchSireneCache()` + `getSireneCacheHealth()` |
| `supabase/migrations/018_*.sql` | Table `sirene_cache` + index composite |
| `supabase/migrations/019_*.sql` | Fonction `search_sirene_cache()` + vue `sirene_cache_size` |

## Schéma `sirene_cache`

```sql
siren TEXT PRIMARY KEY (9 chiffres)
siret TEXT NOT NULL (14 chiffres, siège uniquement)
raison_sociale TEXT
activite_principale TEXT (NAF normalisé avec point, ex. "01.21Z")
tranche_effectifs TEXT (codes INSEE '21'..'53')
effectif_min INT, effectif_max INT
code_postal TEXT, commune TEXT, adresse TEXT
etat_administratif TEXT ('A' uniquement)
date_creation DATE, date_maj_insee TIMESTAMPTZ
source_file TEXT (ex. "StockEtablissement_utf8_202605.zip")
imported_at TIMESTAMPTZ DEFAULT now()
```

Pas de RLS — table publique en lecture, écriture service_role exclusivement.

## Filtre BEGES (ETL ligne 245-282)

Sur 43M établissements en entrée :
1. `etatAdministratifEtablissement === 'A'` (actif) → rejette ~61% (fermés)
2. `etablissementSiege === 'true'` (siège unique par entreprise) → rejette ~4%
3. `trancheEffectifsEtablissement ∈ {21,22,31,32,41,42,51,52,53}` (≥10 salariés) → rejette ~35%
4. section NAF dérivée ∈ {A, C, D, E, F, H} (Agriculture / Industrie / Énergie / Eau-déchets / Construction / Transport) → rejette le résiduel

Résultat typique : **~11k entreprises**, ~4 MB de données.

## Variables d'env nécessaires (GH Actions secrets)

| Secret | Usage |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Upsert dans `sirene_cache` (bypass RLS) |
| `CRON_SECRET` | Bearer pour `/api/admin/sirene-status` (freshness check) |
| `APP_URL` | Base URL de l'app (ex. `https://prospection-agent.vercel.app`) |

**Important : ces secrets vivent dans l'environment GitHub `"Production – strofe-prospection-agent"`**, pas en Repository Secrets. Sans la directive `environment:` dans le job, les secrets ne sont pas injectés.

## Variables d'env optionnelles

| Variable | Défaut | Usage |
|---|---|---|
| `SIRENE_DOWNLOAD_URL` | (résolution dynamique) | Override pour tests/CI — court-circuite la résolution data.gouv.fr |
| `MAX_STORAGE_MB` | 100 | Cap storage cache, abort si dépassé |
| `SIRENE_BATCH_SIZE` | 500 | Taille des upserts |
| `SIRENE_DRYRUN` | (off) | `=1` parse les N premières lignes puis exit (debug) |
| `SIRENE_DRYRUN_LIMIT` | 2000 | Limite lignes en dry-run |

## Résolution dynamique de la resource data.gouv.fr

Les resource IDs data.gouv.fr **changent à chaque republication mensuelle INSEE**. Un ID en dur finit toujours par pointer sur un mauvais fichier après quelques mois.

Pattern (cf. `scripts/import-sirene-bulk.ts:380-440`) :
1. GET `https://www.data.gouv.fr/api/1/datasets/base-sirene-des-entreprises-et-de-leurs-etablissements-siren-siret/`
2. Parcourir `resources[]`
3. Match titre `StockEtablissement` **excluant** : Historique, LiensSuccession, Doublons, UniteLegale, parquet, .pdf, .csv (les `liste-csv-des-variables-*.csv` sont des docs, pas le ZIP)
4. Renvoyer `url` de la resource trouvée

Garde-fou : après unzip, on vérifie que `csvEntry.path` commence par `StockEtablissement_utf8`. Sinon, échec immédiat avec message clair (pas 30 min de parse pour 0 résultat — cf. bug 2026-05-17).

## Mode dry-run

Indispensable pour debug rapide sans toucher Supabase :

```powershell
$env:SIRENE_DRYRUN = '1'
$env:SIRENE_DRYRUN_LIMIT = '50000'
npm run import-sirene
```

Log final :
- `columns` : liste des colonnes réelles du CSV (54 attendues)
- `samples_critical_fields` : 5 lignes brutes (siren, etat, siege, tranche, naf)
- `rejection_counts` : compteurs par cause (etat / siege / tranche_missing / tranche_excluded / naf_missing / naf_excluded / siren_missing / siret_missing / siren_format / siret_format)

Sur 50k lignes : attendu ~30-50 kept (concentration ~0.08% en début de fichier, plus dense en fin).

## Whitelist SSRF

Domaines tapés par l'ETL :
- `www.data.gouv.fr` — métadonnée du dataset
- `object.files.data.gouv.fr` — S3 backend, URL résolue dynamiquement

Whitelist `rules/security.md` à maintenir cohérente.

## Trigger manuel (dispatch)

```powershell
# Skip le freshness check (force=true)
gh workflow run sirene-import.yml -f force=true

# Suivi
gh run watch
```

## Lecture du cache depuis l'app

`lib/agent/sirene-cache.ts` expose :
- `searchSireneCache(filters)` — query la fonction PL/pgSQL `search_sirene_cache` avec composite index sur (section_naf, tranche_effectifs, code_postal).
- `getSireneCacheHealth()` — lit la vue `sirene_cache_size` (total_bytes, active_count, last_import_at, days_since_import).

Le widget Settings consomme `getSireneCacheHealth()` pour afficher l'âge du cache et alerter si `days_since_import > 35`.
