-- ============================================================
-- Migration 006 — Archivage + notes libres sur prospects
-- Date : 2026-05-12
-- Contexte : refonte /prospects en axe principal de l'app.
--   - archived_at : timestamp de mise en archive (NULL = actif).
--   - notes       : notes libres CRM (édition inline).
-- Les policies RLS existantes (auth.uid() = user_id) couvrent
-- déjà ces colonnes — pas besoin d'en rajouter.
-- ============================================================

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS notes TEXT NULL;

-- Index partiel : la vue par défaut filtre archived_at IS NULL.
-- On indexe (user_id, archived_at) pour accélérer le scan top-N.
CREATE INDEX IF NOT EXISTS idx_prospects_archived
  ON public.prospects(user_id, archived_at)
  WHERE archived_at IS NULL;

COMMENT ON COLUMN public.prospects.archived_at IS
  'Horodatage de mise en archive. NULL = prospect actif (visible dans le pipeline). '
  'Non destructif : permet le filtrage UI sans perte de données.';

COMMENT ON COLUMN public.prospects.notes IS
  'Notes libres CRM saisies par l''utilisateur (édition inline sur la fiche prospect).';
