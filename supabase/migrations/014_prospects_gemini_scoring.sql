-- =============================================================================
-- Migration : 014_prospects_gemini_scoring.sql
-- Projet    : Agent IA - Prospection Bilan Carbone
-- Date      : 2026-05-14
-- Initiative: Scoring complémentaire Gemini — intérêt commercial qualitatif.
--
-- Contexte :
--   Le score composite "score_priorite" (lib/agent/scoring.ts) mesure
--   l'opportunité quantifiable (taille, BEGES, contact). On ajoute un score
--   QUALITATIF généré par Gemini (Agent N3) qui évalue spécifiquement
--   l'intérêt commercial du prospect (signaux web, contexte sectoriel,
--   actualité…) et produit 3-5 RAISONS COMMERCIALES exploitables au pitch.
--
--   Les 3 colonnes ajoutées sur public.prospects :
--     - gemini_score        INTEGER 0-100, NULL = non encore scoré
--     - gemini_raisons      JSONB array de 3-5 strings
--     - gemini_generated_at TIMESTAMPTZ de génération
--
-- Sécurité :
--   - RLS : prospects conserve ses 4 policies (auth.uid() = user_id) issues
--     de 001_initial.sql. Aucune policy supplémentaire nécessaire.
--   - Pas de PII : les raisons mentionnent au plus la raison sociale (publique).
--
-- Idempotence : ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Rollback   :
--     DROP INDEX IF EXISTS public.prospects_gemini_score_idx;
--     ALTER TABLE public.prospects
--       DROP COLUMN IF EXISTS gemini_generated_at,
--       DROP COLUMN IF EXISTS gemini_raisons,
--       DROP COLUMN IF EXISTS gemini_score;
-- =============================================================================

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS gemini_score        INTEGER     NULL
    CHECK (gemini_score IS NULL OR (gemini_score >= 0 AND gemini_score <= 100)),
  ADD COLUMN IF NOT EXISTS gemini_raisons      JSONB       NULL,
  ADD COLUMN IF NOT EXISTS gemini_generated_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.prospects.gemini_score IS
  'Score d''intérêt commercial Gemini (0-100). NULL si non encore scoré.';

COMMENT ON COLUMN public.prospects.gemini_raisons IS
  'JSONB array de 3-5 strings : raisons commerciales spécifiques à pitcher.';

COMMENT ON COLUMN public.prospects.gemini_generated_at IS
  'Horodatage de génération Gemini (ISO 8601 TIMESTAMPTZ).';

-- Index pour tri éventuel par gemini_score (top prospects à pitcher).
-- Partiel : les lignes non scorées (NULL) ne participent pas à l'index.
CREATE INDEX IF NOT EXISTS prospects_gemini_score_idx
  ON public.prospects (gemini_score DESC)
  WHERE gemini_score IS NOT NULL;

-- =============================================================================
-- Fin de la migration 014_prospects_gemini_scoring.sql
-- Pour appliquer : supabase db push  (ou Dashboard SQL Editor)
-- =============================================================================
