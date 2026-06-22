# Migrations Supabase — ProspectionAgent (Glan)

Schéma PostgreSQL du SaaS de prospection BEGES (Bilan des Émissions de Gaz à Effet de
Serre). Ce dossier contient l'historique versionné du schéma, appliqué via
`supabase db push` (ou le SQL Editor du Dashboard).

> Base de référence : ce SaaS est **en production** (2 clients). Toute migration
> est *forward-only* et idempotente — voir la section [Conventions](#conventions).

---

## Points techniques notables

Les patterns Postgres les plus structurants du schéma, avec leur point d'ancrage
`fichier:ligne` (vérifié dans les migrations) :

| Pattern | Description | Référence |
|---------|-------------|-----------|
| **Colonne `GENERATED ALWAYS … STORED`** | `prospects.is_hot_lead` est un flag composite recalculé par la base (jamais écrit par l'app, absent du type *Insert*). | `024_hot_lead_composite.sql:39-49` |
| **Index GIN trigram (ILIKE)** | `pg_trgm` + `GIN (secteur_libelle gin_trgm_ops)` pour les filtres `ILIKE '%…%'` de la page Prospects (O(n) → O(log n)). | `003_perf_indexes.sql:15,27-29` |
| **Index GIN full-text FR** | `GIN (to_tsvector('french', coalesce(raison_sociale,'')))` sur `sirene_cache` — recherche par nom d'entreprise via `to_tsquery('french', …)`. | `019_sirene_search_function.sql:80-82` |
| **RPC `SECURITY DEFINER`** | `search_sirene_cache(...)` encapsule le sourcing en une seule requête PL/pgSQL ; `STABLE + SECURITY DEFINER` bypass la RLS (lecture publique sans PII). | `019_sirene_search_function.sql:95,118` |
| **Index composite** | `(user_id, score_priorite DESC, statut)` couvrant le tri+filtre de `phaseSelection`. | `003_perf_indexes.sql:48-49` |
| **Index partiel** | `WHERE is_hot_lead = TRUE` (n'indexe que les lignes « hot ») ; idem index partiels `opt_out` (`WHERE siren/email IS NOT NULL`). | `024_hot_lead_composite.sql:62-64`, `015_enrichment_v2.sql:253-258` |
| **RLS dénormalisée** | `daily_list_items.user_id` était dénormalisé pour une RLS sans jointure (table supprimée en 014 ; pattern conservé pour mémoire). | `001_initial.sql:585` |
| **Unicité multi-tenant** | `UNIQUE(user_id, siren)` — clé de conflit des upserts `onConflict: 'user_id,siren'`. Variantes : `UNIQUE(user_id, provider, month_start)`, `UNIQUE(user_id, domain)`. | `001_initial.sql`, `015_enrichment_v2.sql:191-192`, `021_domain_blacklist.sql:44` |

---

## Tableau des migrations

29 fichiers `.sql` au total. La colonne **#** reprend le préfixe numérique du nom de
fichier (l'ordre d'application réel est traité dans la note sur l'ordonnancement).

| #   | Fichier                                       | But |
|-----|-----------------------------------------------|-----|
| 001 | `001_initial.sql`                             | Schéma initial : `profiles`, `prospects`, `daily_lists`, `daily_list_items`, `agent_runs`, ENUMs, RLS, triggers `updated_at`, `handle_new_user`. |
| 002 | `002_daily_lists_notified_at.sql`             | Colonne `daily_lists.notified_at` (anti-doublon de la notification email du cron 7h30). |
| 003 | `003_perf_indexes.sql`                         | Index perf : GIN trigram sur `prospects.secteur_libelle` (ILIKE) + composite `(user_id, score_priorite DESC, statut)`. |
| 004 | `004_prospects_beges_fields.sql`              | Colonnes `prospects.beges_url` + `beges_valide` (BEGES < 4 ans, issu de l'enrichissement ADEME). |
| 005 | `005_sourcing_state_and_counters.sql`         | `profiles.sourcing_state` (curseur Sirene persistant) + compteurs d'observabilité sur `agent_runs` (new/updated, métriques Sirene). |
| 006 | `006_prospects_archive_notes.sql`             | Colonnes `prospects.archived_at` + `notes` (archivage non destructif + notes CRM inline). |
| 007 | `007_call_result_extended.sql`                | Élargit l'ENUM `call_result` : `email_sent`, `no_contact_point`. *(en-tête interne du fichier libellé « 006 » par erreur)*. |
| 008 | `008_prospect_contact_linkedin_entreprise.sql`| Colonne `prospects.contact_linkedin_entreprise` (page LinkedIn entreprise, distincte du profil dirigeant). |
| 009 | `009_prospects_priorite.sql`                  | Colonne `prospects.priorite` (haute/moyenne/basse, éditable) + backfill depuis `score_priorite`. |
| 010 | `010_prospect_status_offer_sent.sql`          | ENUM `prospect_status` += `offer_sent` (offre/devis envoyé). |
| 011 | `011_prospect_contacts.sql`                   | Table `prospect_contacts` (multi-contacts par prospect, `is_primary` unique partiel) + RLS. |
| 012 | `012_prospect_exchanges.sql`                  | Table `prospect_exchanges` (journal libre des échanges manuels) + RLS. |
| 013 | `013_profile_scoring_weights.sql`             | Doc-only : documente la clé JSONB `profiles.settings.scoring_weights` (taille/beges/contact = 100). |
| 014 | `014_prospects_gemini_scoring.sql`            | Colonnes `prospects.gemini_score` / `gemini_raisons` / `gemini_generated_at` (scoring qualitatif Gemini). |
| 014 | `014_drop_daily_lists_and_rename.sql`         | Cleanup post-pivot : `DROP` de `daily_lists`, `daily_list_items`, types `daily_list_status`/`call_priority` ; renomme `daily_call_target` → `sourcing_target_per_run`. |
| 014 | `014_notification_callback_done.sql`          | Colonne `prospect_exchanges.callback_done` (marque une relance comme traitée). |
| 015 | `015_enrichment_v2.sql`                        | Enrichissement v2 : qualité email sur `prospect_contacts`, complétude/tier sur `prospects`, tables `api_quotas` + `opt_out` (RGPD) + RLS. |
| 017 | `017_do_not_contact_status.sql`               | ENUM `prospect_status` += `do_not_contact` (opt-out manuel CRM). |
| 018 | `018_sirene_cache.sql`                         | Table `sirene_cache` (miroir bulk INSEE, lecture publique / écriture service_role). |
| 019 | `019_sirene_search_function.sql`              | Index composites/FTS sur `sirene_cache` + fonction `search_sirene_cache()` + vue `sirene_cache_size`. |
| 020 | `020_entite_publique.sql`                     | Colonne `prospects.entite_publique` (personne morale de droit public → validité BEGES 3 ans vs 4 ans). |
| 021 | `021_domain_blacklist.sql`                    | Table `domain_blacklist` (blacklist par domaine email, clients/concurrents) + RLS. |
| 022 | `022_first_contact_at.sql`                    | Colonne `prospects.first_contact_at` (preuve délai information art. 14 RGPD / CNIL). |
| 023 | `023_bilan_ges_data.sql`                      | Colonnes `prospects.bilan_ges_data` (JSONB ADEME complet) + `beges_decret_2022_compliant` (tristate). |
| 024 | `024_hot_lead_composite.sql`                  | Colonne générée `prospects.is_hot_lead` (`GENERATED ALWAYS … STORED`) + index partiel. |
| 025 | `025_email_verification.sql`                  | Élargit le CHECK `prospect_contacts.email_status` aux statuts Hunter (`accept_all`, `webmail`, `disposable`, `unverified`). |
| 026 | `026_deal_value.sql`                          | Colonnes `prospects.deal_value` + `deal_probability` (forecast pipeline pondéré). |
| 028 | `028_status_to_contact.sql`                   | ENUM `prospect_status` += `to_contact` (décision humaine « à contacter »). |
| 029 | `029_domain_blacklist_update_with_check.sql`  | Durcissement RLS : recrée la policy UPDATE de `domain_blacklist` avec `WITH CHECK (auth.uid() = user_id)` (la 021 ne déclarait que `USING`), seule table déviant du standard 4-policies. |

---

## ERD (tables principales)

> `auth.users` est la table gérée par Supabase Auth. `profiles.id` la prolonge en
> 1:1 ; toutes les tables métier référencent `auth.users(id)` via `user_id`
> (`ON DELETE CASCADE`). Les tables `daily_lists` / `daily_list_items` du schéma
> initial (001) ont été supprimées en 014 et ne figurent donc pas ici.

```mermaid
erDiagram
    auth_users ||--|| profiles : "1:1 (id)"
    auth_users ||--o{ prospects : "user_id"
    auth_users ||--o{ prospect_contacts : "user_id"
    auth_users ||--o{ prospect_exchanges : "user_id"
    auth_users ||--o{ agent_runs : "user_id"
    auth_users ||--o{ api_quotas : "user_id"
    auth_users ||--o{ opt_out : "user_id"
    auth_users ||--o{ domain_blacklist : "user_id"

    prospects ||--o{ prospect_contacts : "prospect_id"
    prospects ||--o{ prospect_exchanges : "prospect_id"

    sirene_cache }o..o{ prospects : "source de sourcing (siren, pas de FK)"

    auth_users {
        uuid id PK
        text email
    }
    profiles {
        uuid id PK_FK
        text email
        jsonb settings
        jsonb sourcing_state
        boolean onboarded
    }
    prospects {
        uuid id PK
        uuid user_id FK
        char siren "UNIQUE(user_id, siren)"
        char siret
        text raison_sociale
        prospect_status statut
        smallint score_priorite
        integer gemini_score
        boolean obligation_beges
        boolean beges_publie
        boolean entite_publique
        jsonb bilan_ges_data
        boolean is_hot_lead "GENERATED"
        numeric deal_value
        smallint deal_probability
        timestamptz archived_at
        timestamptz first_contact_at
    }
    prospect_contacts {
        uuid id PK
        uuid user_id FK
        uuid prospect_id FK
        text email
        text email_status
        smallint email_confidence
        boolean is_primary "UNIQUE partiel par prospect"
        text source
    }
    prospect_exchanges {
        uuid id PK
        uuid user_id FK
        uuid prospect_id FK
        timestamptz occurred_at
        text type
        text result
        timestamptz callback_date
        boolean callback_done
    }
    agent_runs {
        uuid id PK
        uuid user_id FK
        agent_run_status status
        text phase
        integer prospects_sourced
        integer prospects_qualified
        jsonb logs
    }
    api_quotas {
        uuid id PK
        uuid user_id FK
        text provider "UNIQUE(user_id, provider, month_start)"
        integer used_count
        integer limit_count
        date month_start
    }
    opt_out {
        uuid id PK
        uuid user_id FK
        text siren "CHECK siren OR email NOT NULL"
        text email
        text reason
    }
    domain_blacklist {
        uuid id PK
        uuid user_id FK
        text domain "UNIQUE(user_id, domain)"
        text reason
    }
    sirene_cache {
        text siren PK
        text siret
        text raison_sociale
        text activite_principale
        text tranche_effectifs
        text etat_administratif
    }
```

**Notes de lecture**

- `sirene_cache` n'a **aucune clé étrangère** vers `prospects` : c'est un miroir
  public mutualisé (bulk INSEE) interrogé au sourcing. Le lien logique se fait par
  `siren`, sans contrainte référentielle.
- `prospects.is_hot_lead` est une colonne `GENERATED ALWAYS … STORED` (recalculée
  par la DB ; absente du type *Insert*).
- ENUMs Postgres applicatifs : `prospect_status`, `call_result`, `contact_type`,
  `agent_run_status`. Les types `daily_list_status` et `call_priority` ont été
  supprimés en 014.

---

## Conventions

### RLS (Row Level Security) — isolation multi-tenant
- RLS **activée sur toutes les tables métier**.
- Pattern unique : `auth.uid() = user_id` (et `auth.uid() = id` pour `profiles`,
  dont la PK *est* l'identifiant utilisateur).
- 4 policies explicites par table (SELECT / INSERT / UPDATE / DELETE). Les
  UPDATE portent à la fois `USING` et `WITH CHECK`.
- Les colonnes ajoutées par les migrations ultérieures **héritent** automatiquement
  des policies de leur table — aucune nouvelle policy n'est requise pour un simple
  `ADD COLUMN`.
- Exceptions assumées :
  - `sirene_cache` : `SELECT` ouvert (`USING (true)`) car données publiques INSEE
    mutualisées ; **aucune** policy INSERT/UPDATE/DELETE → écriture réservée au
    `service_role` (script ETL `scripts/import-sirene-bulk.ts`).
  - `search_sirene_cache()` : `SECURITY DEFINER` + `STABLE` (bypass RLS, lecture
    seule sans PII), `GRANT EXECUTE` à `authenticated, anon, service_role`.

### Unicité & intégrité
- `prospects` : `UNIQUE(user_id, siren)` — un même SIREN n'apparaît qu'une fois par
  utilisateur (cible des upserts `onConflict: 'user_id,siren'`).
- `prospect_contacts` : index UNIQUE partiel garantissant **un seul** `is_primary`
  par `prospect_id`.
- `api_quotas` : `UNIQUE(user_id, provider, month_start)`.
- `domain_blacklist` : `UNIQUE(user_id, domain)`.
- `opt_out` : `CHECK (siren IS NOT NULL OR email IS NOT NULL)`.

### Idempotence (rejouabilité)
- `CREATE TABLE / INDEX … IF NOT EXISTS`, `ADD COLUMN … IF NOT EXISTS`.
- ENUMs étendus via `ALTER TYPE … ADD VALUE IF NOT EXISTS` (valide en transaction
  depuis PG 12 — Supabase tourne PG 15+).
- Policies recréées via `DROP POLICY IF EXISTS … ; CREATE POLICY …`.
- CHECK constraints modifiés via `DROP CONSTRAINT IF EXISTS` puis `ADD CONSTRAINT`.
- Fonctions/vues via `CREATE OR REPLACE`.

### Rollback documenté
- **Forward-only** : pas de `DROP`/`RENAME` destructif (hors le cleanup volontaire
  014). Chaque migration documente son rollback en commentaire d'en-tête.
- Limite Postgres connue : une valeur d'ENUM **ne peut pas** être retirée une fois
  utilisée → le rollback d'un `ADD VALUE` passe par une migration de remplacement
  (`CREATE TYPE new` + `ALTER COLUMN` + `DROP TYPE old`).

### Divers
- Trigger `public.set_updated_at()` (défini en 001) réutilisé par toutes les tables
  portant `updated_at`.
- `public.handle_new_user()` crée automatiquement la ligne `profiles` à chaque
  inscription (`AFTER INSERT ON auth.users`).
- Régénération des types TS après push :
  `npx supabase gen types typescript --linked > lib/supabase/database.types.ts`.

---

## Ordre d'application : collision 014 & gaps 016 / 027

L'ordre d'application est **purement alphabétique sur le nom de fichier** (comportement
de `supabase db push`). Le préfixe numérique ne joue donc que via ce tri lexicographique.

### Collision de numéro 014 (3 fichiers)
Trois migrations partagent le préfixe `014_` :

| Fichier                              | Date      | Effet |
|--------------------------------------|-----------|-------|
| `014_drop_daily_lists_and_rename.sql`| 2026-05-15| DROP `daily_lists`/`daily_list_items`, types orphelins, rename clé JSONB. |
| `014_notification_callback_done.sql` | 2026-05-17| `ADD COLUMN prospect_exchanges.callback_done`. |
| `014_prospects_gemini_scoring.sql`   | 2026-05-14| `ADD COLUMN prospects.gemini_*`. |

Conséquence du tri alphabétique : l'ordre réel d'exécution est
**`drop_daily_lists_and_rename` → `notification_callback_done` → `prospects_gemini_scoring`**
(et non l'ordre chronologique des dates d'en-tête : gemini 05-14 < drop 05-15 < callback 05-17).
Cet ordre est **sans risque** ici car les trois migrations sont disjointes (tables/colonnes
indépendantes) et toutes idempotentes — l'ordre relatif n'a aucun impact fonctionnel.

> Recommandation pour les prochaines migrations : éviter les numéros dupliqués. Si
> l'historique appliqué en prod doit rester intact, ne pas renuméroter rétroactivement
> ces trois fichiers (ils sont déjà exécutés sur les bases clients) — la contrainte
> ne porte que sur les nouveaux fichiers.

### Gaps 016 et 027
Les numéros **016** et **027** n'existent pas dans le dossier. Ce sont des trous
d'historique (numéros réservés/abandonnés en cours de développement), **sans aucune
incidence** : `supabase db push` applique les fichiers présents dans l'ordre du tri
et ne requiert pas de séquence numérique continue. La séquence appliquée est donc :

```
001 … 015, 017, 018 … 026, 028, 029
```

(015 suivi directement de 017 ; 026 suivi directement de 028, puis 029.)
