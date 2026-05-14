-- =============================================================================
-- Migration : 012_prospect_exchanges.sql
-- Projet    : Agent IA - Prospection Bilan Carbone
-- Date      : 2026-05-14
-- Initiative: Refonte UI majeure — historique d'échanges manuels par prospect.
--
-- Contexte :
--   daily_list_items capture les appels issus de la liste du jour (générée par
--   l'agent). Mais l'user a besoin d'un journal LIBRE des échanges, hors liste :
--   emails envoyés à la main, messages LinkedIn, rdv planifiés ad hoc, etc.
--   Cette table est le fil chronologique brut.
--
--   `type` : enum logique (CHECK), valeurs prévisibles côté UI.
--   `result` : TEXT libre (peut matcher CallResult mais non contraint, pour
--   éviter de coupler à l'enum call_result évolutif).
--
-- RLS : 4 policies strictes (auth.uid() = user_id), conformes au pattern projet.
-- Trigger updated_at : réutilise public.set_updated_at() définie en 001_initial.sql.
--
-- Rollback :
--   DROP TABLE IF EXISTS public.prospect_exchanges CASCADE;
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.prospect_exchanges (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prospect_id   UUID         NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,

  -- Date effective de l'échange (≠ created_at, qui est l'horodatage de saisie)
  occurred_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Type d'échange
  type          TEXT         NOT NULL
                  CHECK (type IN ('appel', 'email', 'linkedin', 'rdv', 'autre')),

  -- Résultat libre (peut matcher CallResult mais non contraint pour souplesse)
  result        TEXT,

  -- Notes libres
  notes         TEXT,

  -- Date de rappel planifiée (optionnel)
  callback_date TIMESTAMPTZ,

  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.prospect_exchanges IS
  'Journal libre des échanges manuels avec un prospect (hors daily_list_items). '
  'Capture emails envoyés, messages LinkedIn, rdv planifiés ad hoc, etc. '
  'Fil chronologique unifié — affiché dans la fiche prospect.';

COMMENT ON COLUMN public.prospect_exchanges.occurred_at IS
  'Horodatage effectif de l''échange (≠ created_at qui est l''horodatage de saisie).';

COMMENT ON COLUMN public.prospect_exchanges.type IS
  'Type d''échange : appel, email, linkedin, rdv, autre.';

COMMENT ON COLUMN public.prospect_exchanges.result IS
  'Résultat libre. Peut matcher CallResult (interested, callback, ...) mais '
  'non contraint à l''enum pour rester souple (échanges email/linkedin).';

-- ---------------------------------------------------------------------------
-- Index
-- ---------------------------------------------------------------------------

-- Affichage chronologique par prospect (récent d'abord)
CREATE INDEX IF NOT EXISTS prospect_exchanges_prospect_occurred_idx
  ON public.prospect_exchanges(prospect_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS prospect_exchanges_user_idx
  ON public.prospect_exchanges(user_id);

-- ---------------------------------------------------------------------------
-- Trigger updated_at (réutilise la fonction set_updated_at de 001_initial.sql)
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_prospect_exchanges_updated_at ON public.prospect_exchanges;
CREATE TRIGGER trg_prospect_exchanges_updated_at
  BEFORE UPDATE ON public.prospect_exchanges
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — prospect_exchanges
-- ---------------------------------------------------------------------------

ALTER TABLE public.prospect_exchanges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prospect_exchanges_select_own" ON public.prospect_exchanges;
CREATE POLICY "prospect_exchanges_select_own"
  ON public.prospect_exchanges FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "prospect_exchanges_insert_own" ON public.prospect_exchanges;
CREATE POLICY "prospect_exchanges_insert_own"
  ON public.prospect_exchanges FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "prospect_exchanges_update_own" ON public.prospect_exchanges;
CREATE POLICY "prospect_exchanges_update_own"
  ON public.prospect_exchanges FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "prospect_exchanges_delete_own" ON public.prospect_exchanges;
CREATE POLICY "prospect_exchanges_delete_own"
  ON public.prospect_exchanges FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================================================
-- Fin de la migration 012_prospect_exchanges.sql
-- Pour appliquer : supabase db push
-- =============================================================================
