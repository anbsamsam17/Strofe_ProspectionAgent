-- =============================================================================
-- Migration : 011_prospect_contacts.sql
-- Projet    : Agent IA - Prospection Bilan Carbone
-- Date      : 2026-05-14
-- Initiative: Refonte UI majeure — multi-contacts par prospect.
--
-- Contexte :
--   Aujourd'hui prospects.contact_* (nom, prenom, poste, telephone, email,
--   linkedin) ne stocke QU'UN seul contact. Le user veut pouvoir attacher
--   plusieurs contacts à un prospect (ex: DAF + RSE + Assistant DG).
--   Cette table normalise les contacts, avec un flag `is_primary` (un seul
--   par prospect — assuré par index UNIQUE partiel).
--
--   Les colonnes prospects.contact_* sont CONSERVÉES (rétrocompat,
--   contact_linkedin_entreprise reste sur prospects). Le contact "primary"
--   peut être synchronisé côté app.
--
-- RLS : 4 policies strictes (auth.uid() = user_id), conformes au pattern projet.
-- Trigger updated_at : réutilise public.set_updated_at() définie en 001_initial.sql.
--
-- Rollback :
--   DROP TABLE IF EXISTS public.prospect_contacts CASCADE;
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.prospect_contacts (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prospect_id  UUID         NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,

  -- Identité contact
  nom          TEXT,
  prenom       TEXT,
  poste        TEXT,
  telephone    TEXT,
  email        TEXT,
  linkedin     TEXT,

  -- Origine (ex: 'pappers', 'hunter', 'manual', 'recherche_entreprises')
  source       TEXT,

  -- Contact principal (un seul par prospect — voir index unique partiel)
  is_primary   BOOLEAN      NOT NULL DEFAULT FALSE,

  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.prospect_contacts IS
  'Contacts multiples attachés à un prospect (DAF, RSE, Assistant DG, etc.). '
  'Étend le modèle initial qui stockait UN seul contact dans prospects.contact_*. '
  'is_primary = TRUE pour le contact principal (unique par prospect).';

COMMENT ON COLUMN public.prospect_contacts.source IS
  'Origine de l''enrichissement contact : pappers, hunter, recherche_entreprises, manual, etc.';

COMMENT ON COLUMN public.prospect_contacts.is_primary IS
  'Contact principal du prospect. Un seul TRUE par prospect_id (index unique partiel).';

-- ---------------------------------------------------------------------------
-- Index
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS prospect_contacts_prospect_idx
  ON public.prospect_contacts(prospect_id);

CREATE INDEX IF NOT EXISTS prospect_contacts_user_idx
  ON public.prospect_contacts(user_id);

-- Un seul primary par prospect (NULL-friendly partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS prospect_contacts_one_primary_idx
  ON public.prospect_contacts(prospect_id)
  WHERE is_primary = TRUE;

-- ---------------------------------------------------------------------------
-- Trigger updated_at (réutilise la fonction set_updated_at de 001_initial.sql)
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_prospect_contacts_updated_at ON public.prospect_contacts;
CREATE TRIGGER trg_prospect_contacts_updated_at
  BEFORE UPDATE ON public.prospect_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — prospect_contacts
-- ---------------------------------------------------------------------------

ALTER TABLE public.prospect_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prospect_contacts_select_own" ON public.prospect_contacts;
CREATE POLICY "prospect_contacts_select_own"
  ON public.prospect_contacts FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "prospect_contacts_insert_own" ON public.prospect_contacts;
CREATE POLICY "prospect_contacts_insert_own"
  ON public.prospect_contacts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "prospect_contacts_update_own" ON public.prospect_contacts;
CREATE POLICY "prospect_contacts_update_own"
  ON public.prospect_contacts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "prospect_contacts_delete_own" ON public.prospect_contacts;
CREATE POLICY "prospect_contacts_delete_own"
  ON public.prospect_contacts FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================================================
-- Fin de la migration 011_prospect_contacts.sql
-- Pour appliquer : supabase db push
-- =============================================================================
