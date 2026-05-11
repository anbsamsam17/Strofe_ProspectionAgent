# Modèle de données — Supabase

Migrations dans `supabase/migrations/` (001_initial.sql, 002_daily_lists_notified_at.sql, 003_perf_indexes.sql, 004_prospects_beges_fields.sql).

## Schéma ER textuel

```
auth.users (Supabase Auth)
   │ 1:1
   ▼
profiles (id == auth.users.id)
   │ 1:N
   ├─────────► prospects (user_id)
   │ 1:N        │ 1:N
   ├──► daily_lists (user_id, date) ──► daily_list_items ──► prospects
   │ 1:N                                  (user_id, prospect_id, daily_list_id)
   └──► agent_runs (user_id)
```

## profiles

Extension de `auth.users` créée automatiquement via le trigger `handle_new_user` (sécurité definer).

| Colonne          | Type        | Notes |
|------------------|-------------|-------|
| `id`             | UUID PK     | == `auth.users.id`, ON DELETE CASCADE |
| `email`          | TEXT        | dupliqué depuis auth.users |
| `full_name`      | TEXT        | |
| `company_name`   | TEXT        | |
| `settings`       | JSONB       | offre, NAF cibles, ville, codes postaux, daily_call_target, notification_email, offer_description |
| `onboarded`      | BOOLEAN     | false jusqu'à ce que les settings soient renseignés |
| `created_at`/`updated_at` | TIMESTAMPTZ | trigger `set_updated_at` |

RLS : 4 policies S/I/U/D où `auth.uid() = id`.

## prospects

Une entreprise sourcée par l'agent. Isolation tenant via `UNIQUE(user_id, siren)`.

Colonnes clés :
- Identité : `siren CHAR(9)`, `siret CHAR(14)`, `raison_sociale`, `secteur_naf`, `secteur_libelle`.
- Taille : `effectif_min`, `effectif_max` (tranche INSEE).
- Localisation : `ville`, `code_postal`, `adresse`.
- Contact : `contact_nom`, `contact_prenom`, `contact_poste`, `contact_telephone`, `contact_email`, `contact_linkedin`.
- BEGES : `beges_publie BOOL`, `beges_derniere_publication DATE`, `obligation_beges BOOL`, et (migration 004) `beges_url`, `beges_valide BOOL`.
- Scoring : `score_priorite SMALLINT 0-100` (CHECK), `score_details JSONB` (décomposition par critère).
- Signaux : `signaux JSONB` array de `{type, date, url, weight}`.
- Statut : enum `prospect_status` — `sourced` → `qualified` → `contacted` → `interested` → `rdv` → `converted`. Aussi : `rejected`, `on_hold`.
- Meta : `source` (default `sirene_api`), `enriched_at`.

Index : `(user_id, statut)`, `(user_id, score_priorite DESC)`, `(user_id, siren)`, `(user_id, secteur_naf)`, `(user_id, beges_publie, obligation_beges)`.

RLS : 4 policies `auth.uid() = user_id`.

## daily_lists

Une ligne par `(user_id, date)`. Le cron de génération est idempotent via cet unique.

| Colonne        | Type | Notes |
|----------------|------|-------|
| `id`           | UUID PK | |
| `user_id`      | UUID FK auth.users | ON DELETE CASCADE |
| `date`         | DATE | jour calendaire, pas TIMESTAMPTZ |
| `status`       | enum `daily_list_status` | `pending` → `generating` → `ready` → `completed` |
| `generated_at` | TIMESTAMPTZ | NULL tant que pending/generating |
| `notified_at`  | TIMESTAMPTZ | NULL = pas encore notifié → utilisé par cron 7h30 |
| `created_at`/`updated_at` | TIMESTAMPTZ | |

Contrainte : `UNIQUE(user_id, date)`.

## daily_list_items

Les 15 (ou +) appels du jour. `user_id` est dénormalisé pour RLS sans jointure coûteuse.

Colonnes clés :
- FK : `daily_list_id`, `user_id`, `prospect_id` (toutes CASCADE).
- Ordre : `ordre SMALLINT CHECK 1..20`, `priorite` enum `call_priority` (`haute`/`normale`/`basse`), `meilleur_creneau TEXT`.
- Contenu GPT : `accroche TEXT`, `pitch TEXT`, `signaux_detectes JSONB`, `objections_reponses JSONB` (`[{objection, reponse}]`).
- Persona : `contact_type` enum `contact_type` (`rse`/`daf`/`drh`/`dg`/`autre`).
- Résultat humain : `call_result` enum `call_result` (`interested`/`callback`/`not_interested`/`wrong_contact`/`no_answer`/`voicemail`), `callback_date DATE`, `call_notes TEXT`, `called_at TIMESTAMPTZ`.

Index : `(daily_list_id, ordre)`, `(user_id)`, `(prospect_id)`, partiel `(user_id, callback_date) WHERE call_result='callback'`.

## agent_runs

Journal d'exécution du pipeline. 1 ligne par lancement.

| Colonne | Notes |
|---------|-------|
| `status` | enum `agent_run_status` : `running` / `completed` / `failed` |
| `phase` | TEXT libre : `init` / `load_settings` / `sourcing_sirene` / `enrichissement` / `scoring` / `contact_enrichment` / `selection` / `generation_pitch` / `construction_liste` / `completed` |
| `prospects_sourced`, `prospects_qualified` | INTEGER |
| `list_generated` | BOOLEAN |
| `error_message` | TEXT (set si failed) |
| `logs` | JSONB array `[{timestamp, phase, message, level, data}]` |
| `started_at`, `completed_at` | TIMESTAMPTZ |

Index : `(user_id, started_at DESC)`, partiel `(user_id, status) WHERE status='running'` (anti-concurrence).

## Cycle de vie d'un prospect

```
1. Sourcing (orchestrator phase 3)
   → INSERT prospects (statut='sourced', score=0)

2. Scoring (phase 4)
   → UPDATE prospects (score_priorite, score_details,
                       statut='qualified' si score≥20 sinon 'sourced')

3. Sélection + génération pitch (phase 5+6)
   → INSERT daily_list_items (call_result=NULL)
   ▸ prospects.statut reste 'qualified' (pas encore appelé)

4. L'humain effectue l'appel
   → UPDATE daily_list_items (call_result, called_at, call_notes)
   ▸ Une route API (à vérifier dans le code) doit promouvoir
     prospects.statut → 'contacted', puis 'interested' / 'rdv' / 'converted'
     selon le call_result.

5. Disqualification éventuelle
   → UPDATE prospects (statut='rejected') → -50 pts au prochain scoring
```
