-- =============================================================================
-- Migration : 026_deal_value.sql
-- Projet    : ProspectionAgent (Glan) — Agent IA Prospection Bilan Carbone
-- Ticket    : GLN-041 (valeur deal en EUR + forecast pipeline pondere)
-- Date      : 2026-05-20
--
-- Contexte :
--   Sans pipeline value en EUR, le consultant n'a pas de prevision CA et
--   pas de priorisation rationnelle des prospects. Pipedrive Deal Value
--   est la base CRM standard — on s'en inspire avec deux colonnes simples :
--     - deal_value        NUMERIC(10,2)  EUR estimes pour ce prospect
--     - deal_probability  SMALLINT       0-100 (pre-rempli selon statut,
--                                        editable manuellement)
--
--   Le forecast pondere est calcule cote app (lib/pipeline/forecast.ts) :
--     forecast = deal_value * deal_probability / 100
--
--   On evite un GENERATED ALWAYS pour garder la souplesse (le user peut
--   override la probabilite independamment du statut).
--
-- Risques :
--   - Downtime : nul. ADD COLUMN IF NOT EXISTS non bloquant.
--   - FK / RLS : inchanges (prospects herite des policies existantes).
--
-- Idempotence : IF NOT EXISTS sur ADD COLUMN, CREATE INDEX, DROP CONSTRAINT
--   avant ADD CONSTRAINT (pour la CHECK probability).
--
-- TODO regen types apres push :
--   npx supabase gen types typescript --linked > lib/supabase/database.types.ts
--
-- Rollback (manuel) :
--   ALTER TABLE public.prospects
--     DROP COLUMN IF EXISTS deal_value,
--     DROP COLUMN IF EXISTS deal_probability;
--   DROP INDEX IF EXISTS idx_prospects_deal_forecast;
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Colonnes deal_value + deal_probability
-- ---------------------------------------------------------------------------

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS deal_value NUMERIC(10, 2) NULL;

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS deal_probability SMALLINT NULL;

-- CHECK separe (DROP/ADD) pour rester idempotent.
ALTER TABLE public.prospects
  DROP CONSTRAINT IF EXISTS prospects_deal_probability_check;

ALTER TABLE public.prospects
  ADD CONSTRAINT prospects_deal_probability_check
  CHECK (deal_probability IS NULL OR (deal_probability >= 0 AND deal_probability <= 100));

-- Plafond de coherence : 99 999 999.99 EUR (= 99 M). Au-dela, c'est probablement
-- une faute de frappe — on garde NUMERIC(10,2) sans plafond CHECK pour rester
-- simple (la validation UI fait le job en saisie).

COMMENT ON COLUMN public.prospects.deal_value IS
  'Valeur estimee du deal en EUR. Saisie manuelle par utilisateur. '
  'NULL = pas encore estime. Le forecast pondere est calcule cote app : '
  'forecast = deal_value * deal_probability / 100.';

COMMENT ON COLUMN public.prospects.deal_probability IS
  'Probabilite 0-100 de cloture du deal. Pre-rempli selon statut (cf. '
  'lib/pipeline/forecast.ts defaultProbabilityForStatus : sourced=10, '
  'qualified=25, contacted=25, interested=50, rdv=75, offer_sent=60, '
  'converted=100, rejected/do_not_contact=0). Editable manuellement par user.';

-- ---------------------------------------------------------------------------
-- 2. Index partiel pour les queries forecast (somme ponderee par statut).
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_prospects_deal_forecast
  ON public.prospects(user_id, deal_value, deal_probability)
  WHERE deal_value IS NOT NULL;

COMMIT;

-- =============================================================================
-- Fin de la migration 026_deal_value.sql
-- Pour appliquer  : supabase db push
-- Apres push      : npx supabase gen types typescript --linked > lib/supabase/database.types.ts
-- =============================================================================
