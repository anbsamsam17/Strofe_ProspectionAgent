# SIRENE bulk import — POC fallback sourcing

> Mai 2026. Fondations du fallback "sourcing offline" pour contourner
> l'instabilité chronique de l'API Sirene INSEE.

---

## Pourquoi

L'API Sirene INSEE (`api.insee.fr/api-sirene/3.11/siret`) plante de manière
persistante : 4xx silencieux, timeouts, throttling agressif, OAuth → API Key
en sept. 2025 (rupture) puis instabilité continue. Le sourcing nocturne
s'épuise et le runner finit en "Univers de recherche épuisé".

INSEE publie chaque mois un dump complet de la base SIRENE
(`StockEtablissement_utf8.zip`, ~1 GB compressé, ~3 GB décompressé,
~30 M lignes) sur https://files.data.gouv.fr/insee-sirene/.

Cette fondation :

1. Télécharge ce dump.
2. Le filtre côté ETL (entreprises actives avec salariés).
3. Le stocke en miroir local dans la table publique `sirene_cache`.

À terme, `searchSireneCache()` remplacera l'appel runtime à Sirene API
dans `lib/agent/sourcing-runner.ts` — Sirene API deviendra le fallback,
pas la source primaire.

## Comment lancer manuellement

Prérequis :

- Node 22.6+ (pour `--experimental-strip-types`).
- `.env.local` à la racine avec `NEXT_PUBLIC_SUPABASE_URL` et
  `SUPABASE_SERVICE_ROLE_KEY`.
- Migration `018_sirene_cache.sql` appliquée (`npx supabase db push`).
- Dépendances ETL installées : `csv-parse`, `unzipper` (déjà dans
  `package.json` devDependencies).

Commande :

```powershell
npm run import-sirene
```

Équivalent direct :

```powershell
node --experimental-strip-types --env-file=.env.local scripts/import-sirene-bulk.ts
```

Durée typique : 15-30 min sur une bonne connexion.

Sortie : logs JSON ligne par ligne, progression tous les 10 000 rows lus,
stats finales `{read, kept, inserted, duration_ms, source_file}`.

## Schéma des données

Table `public.sirene_cache` — voir `supabase/migrations/018_sirene_cache.sql`
pour les commentaires colonne par colonne.

| Colonne | Type | Description |
| --- | --- | --- |
| `siren` | TEXT PK | SIREN 9 chiffres. |
| `siret` | TEXT | SIRET 14 chiffres (siège ou premier établissement vu). |
| `raison_sociale` | TEXT | Dénomination unité légale. |
| `activite_principale` | TEXT | NAF rev. 2 normalisé `01.21Z`. |
| `tranche_effectifs` | TEXT | Code INSEE `11`-`53`. |
| `effectif_min` / `effectif_max` | INT | Bornes de la tranche (calculées ETL). |
| `code_postal`, `commune`, `adresse` | TEXT | Localisation établissement. |
| `etat_administratif` | TEXT | `A` uniquement (filtre ETL). |
| `date_creation`, `date_maj_insee` | DATE | Dates INSEE. |
| `imported_at` | TIMESTAMPTZ | Insertion locale. |
| `source_file` | TEXT | Nom du ZIP source (traçabilité fraîcheur). |

Index partiels (`WHERE etat_administratif = 'A'`) sur `activite_principale`,
`tranche_effectifs`, `code_postal`.

RLS : SELECT public (lecture ouverte à tous, données INSEE publiques sans
PII). INSERT/UPDATE/DELETE réservés `service_role` (le script ETL).

Estimation taille : ~250-500k lignes après filtrage tranche ≥ `11`,
~125 MB de données + ~75 MB d'index = ~200 MB sur Supabase.

## Filtres ETL appliqués

Côté script (`scripts/import-sirene-bulk.ts`) :

- `etatAdministratifEtablissement === 'A'` (entreprises actives).
- `trancheEffectifsEtablissement ∈ {11, 12, 21, 22, 31, 32, 41, 42, 51, 52, 53}` —
  on garde large jusqu'à 1-2 salariés pour permettre des filtres aval
  affinés en SQL (obligation BEGES = 250+ salariés, donc tranches `51`+,
  mais on garde de la marge pour les cas où l'INSEE est en retard).
- Pas de filtre NAF côté ETL — c'est le sourcing qui filtrera par secteurs
  cibles user au moment de la requête (les NAF varient d'un user à l'autre).

Upsert par batch de 500 lignes, `onConflict: 'siren'` : la première ligne
gagne (premier SIRET vu pour un SIREN). Acceptable pour le POC.

## Plan d'évolution

Travail restant pour activer le fallback en prod :

1. **`searchSireneCache()`** dans `lib/agent/sirene-cache.ts` (nouveau)
   — fonction qui interroge `sirene_cache` avec les mêmes paramètres que
   l'actuelle `sourcerEntreprises()` (NAF, codes postaux, tranche min),
   retourne un `Prospect[]` typé identique.
2. **Inversion cascade** dans `lib/agent/sourcing-runner.ts` :
   `searchSireneCache()` en primaire, `sourcerEntreprises()` (API Sirene)
   en fallback si cache vide ou stale.
3. **Cron mensuel** : déporter l'ETL sur un job externe (GitHub Actions
   schedule ou Render cron) — Vercel cron cap 800s, l'ETL dure 15-30 min.
   Alternative : découper en chunks + cron quotidien qui rejoue jusqu'à
   complétion.
4. **Test d'intégration** : fixture CSV minimale (10 lignes), vérifier
   filtres + mapping + upsert.
5. **Monitoring fraîcheur** : alerte si `MAX(imported_at) < NOW() - INTERVAL '45 days'`.

## Risques / limites connues

- Dump mensuel : data peut avoir 4-6 semaines de retard sur la réalité
  INSEE. Acceptable pour le sourcing primaire (les obligations BEGES
  bougent peu), pas pour des décisions opérationnelles temps réel.
- 1 SIRET par SIREN : on perd les multi-établissements. Si le siège
  social n'est pas le premier vu dans le CSV, on peut perdre l'adresse
  de référence. À améliorer dans v2 (filtre `etablissementSiege === 'true'`).
- Pas de PII dans le bulk, mais les entrepreneurs individuels (filtres
  tranche `00`/`NN` exclus) peuvent l'être — on les filtre déjà out.
