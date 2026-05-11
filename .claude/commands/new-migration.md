---
description: "Scaffold une migration Supabase avec RLS et trigger updated_at."
argument-hint: "<nom-migration>"
---

# /new-migration

Tu crées une migration SQL dans `supabase/migrations/` pour `$ARGUMENTS`.

## 1. Création du fichier

1. Regarde les fichiers existants de `supabase/migrations/` (actuellement 001 à 004). Préfixe la nouvelle avec le prochain numéro sur 3 chiffres.
2. Crée `supabase/migrations/<NNN>_$ARGUMENTS.sql` (via `npx supabase migration new` ou manuellement).

## 2. Template SQL

```sql
-- =============================================================================
-- Migration : <NNN>_<nom>.sql — <YYYY-MM-DD>
-- Description: <une ligne>
-- =============================================================================

-- (a) Création / altération
CREATE TABLE public.<nom_table> (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- colonnes métier
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_<nom_table>_user_id ON public.<nom_table>(user_id);

-- Option B : ALTER TABLE public.<table> ADD COLUMN <colonne> <type>;

-- (b) RLS
ALTER TABLE public.<nom_table> ENABLE ROW LEVEL SECURITY;

-- (c) Policies — 4 obligatoires
CREATE POLICY "<nom_table>: lecture par le propriétaire"
  ON public.<nom_table> FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "<nom_table>: insertion par le propriétaire"
  ON public.<nom_table> FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "<nom_table>: mise à jour par le propriétaire"
  ON public.<nom_table> FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "<nom_table>: suppression par le propriétaire"
  ON public.<nom_table> FOR DELETE
  USING (auth.uid() = user_id);

-- (d) Trigger updated_at (uniquement si colonne updated_at présente)
CREATE TRIGGER trg_<nom_table>_updated_at
  BEFORE UPDATE ON public.<nom_table>
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

## 3. Règles non négociables

1. Toute table métier a `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`.
2. RLS activé + 4 policies sur `auth.uid() = user_id` (ou `= id` pour `profiles`).
3. Si `updated_at` présente : trigger `set_updated_at` (fonction définie dans `001_initial.sql`).
4. Pour un nouvel enum / CHECK : mets aussi à jour `lib/types.ts` ET régénère `lib/supabase/database.types.ts` via `npx supabase gen types typescript --linked`.
5. Pour les ALTER : ajoute un `COMMENT ON COLUMN` pour documenter la sémantique.
6. Une `ALTER TYPE ... ADD VALUE` doit être committée SEULE (limitation Postgres).

## 4. Validation

1. Applique la migration sur la base locale (Supabase CLI) ou via dashboard.
2. Lance `/check-rls` pour confirmer les 4 policies.
3. Régénère les types TS si applicable.
4. Test rapide dans `lib/**/__tests__/` si logique métier ajoutée (ex: CHECK constraint).
