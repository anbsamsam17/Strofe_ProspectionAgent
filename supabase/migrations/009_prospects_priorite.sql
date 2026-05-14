-- =============================================================================
-- Migration : 009_prospects_priorite.sql
-- Projet    : Agent IA - Prospection Bilan Carbone
-- Date      : 2026-05-14
-- Initiative: Refonte UI majeure — priorité éditable manuellement par l'user.
--
-- Contexte :
--   Le `score_priorite` est calculé automatiquement par l'agent (0-100).
--   On introduit une priorité QUALITATIVE distincte (`priorite`) que
--   l'utilisateur peut éditer manuellement (override métier).
--   Valeurs : 'haute', 'moyenne', 'basse'.
--   ATTENTION : la valeur "normale" (utilisée pour daily_list_items.priorite)
--   devient "moyenne" sur ce nouveau champ — alignement avec la nouvelle UI.
--
-- Backfill : déduit de score_priorite courant (≥60 = haute, ≥30 = moyenne, sinon basse).
--   Aligné sur les seuils SEUIL_PRIORITE_HAUTE = 60 et SEUIL_PRIORITE_NORMALE = 30
--   définis dans lib/agent/scoring.ts.
--
-- Idempotence : ADD COLUMN gardé par IF NOT EXISTS. Le CHECK est attaché à la
--   colonne via DEFAULT, donc rejouable. Le backfill UPDATE est idempotent
--   (rejouer ne modifie rien si la colonne contient déjà des valeurs).
-- RLS : couverture déjà assurée par les 4 policies prospects (001_initial.sql).
--       Aucune nouvelle policy nécessaire — la colonne hérite du scope user_id.
--
-- Rollback :
--   DROP INDEX IF EXISTS prospects_priorite_idx;
--   ALTER TABLE public.prospects DROP COLUMN IF EXISTS priorite;
-- =============================================================================

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS priorite TEXT NOT NULL DEFAULT 'moyenne'
    CHECK (priorite IN ('haute', 'moyenne', 'basse'));

-- Backfill : déduire de score_priorite courant.
-- Seuils alignés sur lib/agent/scoring.ts (SEUIL_PRIORITE_HAUTE/NORMALE).
UPDATE public.prospects
SET priorite = CASE
  WHEN score_priorite >= 60 THEN 'haute'
  WHEN score_priorite >= 30 THEN 'moyenne'
  ELSE 'basse'
END
WHERE priorite = 'moyenne';  -- safe re-run : ne touche que les défauts non-éditées

CREATE INDEX IF NOT EXISTS prospects_priorite_idx
  ON public.prospects(priorite);

COMMENT ON COLUMN public.prospects.priorite IS
  'Priorité qualitative éditable manuellement par l''utilisateur '
  '(distincte du score_priorite calculé). Valeurs : haute, moyenne, basse. '
  'Backfill initial : déduit du score_priorite (≥60=haute, ≥30=moyenne, sinon basse).';

-- =============================================================================
-- Fin de la migration 009_prospects_priorite.sql
-- Pour appliquer : supabase db push
-- =============================================================================
