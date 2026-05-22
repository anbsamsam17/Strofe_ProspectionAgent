-- =============================================================================
-- Migration 023 : prospects.bilan_ges_data + beges_decret_2022_compliant
-- Tickets : GLN-066 (SHOULD-1) + GLN-006 (MUST-2)
-- Date    : 2026-05-20
--
-- Objectif :
--   1. GLN-066 — Persister le record complet renvoye par l'API ADEME Data Fair
--      (https://data.ademe.fr/data-fair/api/v1/datasets/bilan-ges/lines) pour
--      exploitation downstream :
--        - emissions scope 1/2/3 (intensite carbone, Decret 2022)
--        - methodologie (Bilan Carbone, GHG Protocol, ISO 14064)
--        - perimetre organisationnel (societe mere seule vs filiales)
--        - objectifs_reduction (engagement chiffre, maturite)
--        - plan_action / plan_action_transition (Decret 2022-982)
--        - consultant_accompagnant (detection concurrence Greenly/Sami/etc.)
--      Stocke en JSONB pour souplesse (champs API en evolution).
--
--   2. GLN-006 — Detection BEGES non-conforme Decret 2022-982 (art. 1) :
--      Depuis le 1er janvier 2023, tout BEGES publie doit inclure scope 3
--      significatif ET un plan d'action de transition chiffre. Un BEGES publie
--      post-2023 sans ces elements = non conforme = renouvellement obligatoire
--      (signal commercial fort). On persiste le calcul dans une colonne dediee
--      (booleen tristate via NULL) pour exploiter en scoring + UI.
--
-- Idempotence : ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
-- Rollback (non automatise) :
--   DROP INDEX IF EXISTS idx_prospects_bilan_ges_data;
--   ALTER TABLE public.prospects
--     DROP COLUMN IF EXISTS bilan_ges_data,
--     DROP COLUMN IF EXISTS beges_decret_2022_compliant;
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. bilan_ges_data JSONB — record ADEME Data Fair complet (GLN-066)
-- ---------------------------------------------------------------------------

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS bilan_ges_data JSONB NULL;

COMMENT ON COLUMN public.prospects.bilan_ges_data IS
  'Record JSON complet renvoye par l''API ADEME Data Fair (/datasets/bilan-ges/lines) '
  'pour le bilan le plus recent du SIREN. Inclut emissions scope 1/2/3, methodologie, '
  'perimetre organisationnel, objectifs_reduction, plan_action, consultant_accompagnant, '
  'annee_de_reporting, date_de_publication. NULL = aucun bilan ADEME connu OU API indisponible '
  'au moment du sourcing. Forme libre : structure Data Fair susceptible d''evoluer.';

-- Index GIN partiel : on requete uniquement les prospects avec un BEGES connu.
-- GIN permet des recherches indexees sur les champs JSONB (ex: WHERE bilan_ges_data->>'methodologie' = 'Bilan Carbone').
CREATE INDEX IF NOT EXISTS idx_prospects_bilan_ges_data
  ON public.prospects USING GIN (bilan_ges_data)
  WHERE bilan_ges_data IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. beges_decret_2022_compliant BOOLEAN — conformite Decret 2022-982 (GLN-006)
-- ---------------------------------------------------------------------------

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS beges_decret_2022_compliant BOOLEAN NULL;

COMMENT ON COLUMN public.prospects.beges_decret_2022_compliant IS
  'Conformite au Decret 2022-982 du 1er juillet 2022 (art. 1) : depuis le 1er janvier 2023, '
  'tout BEGES publie doit inclure scope 3 significatif ET plan d''action de transition chiffre. '
  'Valeurs : '
  ' - TRUE  : BEGES publie post-2023 avec scope 3 + plan action presents. '
  ' - FALSE : BEGES publie post-2023 mais incomplet (scope 3 absent ou plan action absent) '
  '           = signal commercial fort (renouvellement quasi-obligatoire). '
  ' - NULL  : non applicable (pas de BEGES, ou BEGES pre-2023 hors champ du decret, '
  '           ou data ADEME incomplete pour determiner). '
  'Calcule par lib/agent/decret-2022.ts a partir de bilan_ges_data.';

-- Index partiel sur les non-conformes detectes — c'est la requete commerciale clef
-- (filtrer la liste "hot leads BEGES post-2022 incomplet" en O(log n)).
CREATE INDEX IF NOT EXISTS idx_prospects_decret_2022_non_compliant
  ON public.prospects(user_id, score_priorite DESC)
  WHERE beges_decret_2022_compliant = FALSE;

COMMIT;

-- =============================================================================
-- Fin de la migration 023_bilan_ges_data.sql
-- Pour appliquer : supabase db push
-- Apres push     : npx supabase gen types typescript --linked > lib/supabase/database.types.ts
-- NOTE          : database.types.ts a deja ete mis a jour manuellement (cf. commit
--                 GLN-066 + GLN-006) pour exposer bilan_ges_data + beges_decret_2022_compliant.
-- =============================================================================
