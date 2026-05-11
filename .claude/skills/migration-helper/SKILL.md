---
name: migration-helper
description: "Workflow pour ajouter ou modifier une table/colonne Supabase. À activer quand l'utilisateur dit : nouvelle table, nouvelle colonne, ajouter un champ, migration SQL, modifier le schema."
---

# Skill : Migration Helper — Supabase

Activé quand l'utilisateur veut : ajouter / modifier une table, ajouter une colonne, modifier le schema DB.

## Conventions

- Migrations versionnées dans `supabase/migrations/`, format `NNN_description_courte.sql`.
- Numérotation séquentielle (`001_`, `002_`, `003_`, `004_`...).
- Pas de modification d'une migration déjà push en prod — toujours **nouvelle migration** par-dessus.

## Étape 1 : Créer le fichier de migration

```bash
npx supabase migration new <description_courte>
```

Génère `supabase/migrations/NNN_<description>.sql` avec un timestamp ou un numéro.

## Étape 2 : Écrire le SQL

Template pour une nouvelle table :

```sql
-- ============================================================
-- Migration : <description>
-- ============================================================

CREATE TABLE public.<table_name> (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- ... colonnes métier
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Index sur la clé d'accès la plus fréquente
CREATE INDEX idx_<table>_user_id ON public.<table_name>(user_id);

-- ============================================================
-- RLS : 4 policies obligatoires, toutes via auth.uid()
-- ============================================================

ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "<table> select own"
  ON public.<table_name> FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "<table> insert own"
  ON public.<table_name> FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "<table> update own"
  ON public.<table_name> FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "<table> delete own"
  ON public.<table_name> FOR DELETE
  USING (auth.uid() = user_id);
```

Pour une nouvelle colonne sur une table existante :

```sql
ALTER TABLE public.prospects
  ADD COLUMN <col_name> <type> <constraints>;

-- Si la nouvelle colonne est interrogée fréquemment, prévoir un index
CREATE INDEX idx_prospects_<col_name> ON public.prospects(<col_name>);
```

## Étape 3 : Test en local

```bash
npx supabase db reset      # reset complet du schema local, rejoue toutes les migrations
# ou
npx supabase db push       # applique les nouvelles migrations sur la DB locale liée
```

Vérifier dans Supabase Studio local que :
- La table / colonne existe.
- Les policies RLS sont actives (`pg_policies`).
- Aucun row n'a été perdu si c'est un ALTER.

## Étape 4 : Update des types TS

```bash
npx supabase gen types typescript --linked > lib/supabase/database.types.ts
```

Et propager dans `lib/types.ts` si des types métier dérivés existent (ex. `Prospect`, `DailyList`).

## Étape 5 : Tester côté app

- Lancer `npm run type-check` — doit passer sans erreur (sinon, types pas à jour).
- Lancer `npm run test` — un test au moins doit couvrir la nouvelle colonne / table.
- Smoke test manuel : login, créer / lire un row qui utilise la nouvelle colonne.

## Étape 6 : Push en prod

Quand le PR est validé et mergé :

```bash
npx supabase db push --linked
```

(Ou le faire via le hook de build Vercel si configuré.)

**Important** : déployer la migration **avant** le code qui l'utilise. Sinon, le code prod casse pendant quelques secondes.

## Checklist finale

- [ ] Fichier `supabase/migrations/NNN_*.sql` créé.
- [ ] Table : 4 policies RLS via `auth.uid() = user_id`.
- [ ] Index sur les colonnes d'accès fréquent (`user_id`, FK, colonnes filtrées).
- [ ] `database.types.ts` regénéré.
- [ ] `lib/types.ts` à jour si type métier dérivé.
- [ ] `type-check` + `test` verts.
- [ ] Migration push en prod **avant** le deploy du code.
