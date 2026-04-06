-- ============================================================
-- Migration 004 — Ajout colonnes BEGES enrichies sur prospects
-- Date : 2026-04-06
-- Contexte : l'enrichissement ADEME retourne désormais l'URL
-- du bilan et la validité (< 4 ans). Ces colonnes sont
-- nécessaires pour l'affichage frontend et le scoring.
-- ============================================================

-- URL directe vers le BEGES sur bilans-ges.ademe.fr
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS beges_url TEXT;

-- true si le BEGES a moins de 4 ans (obligation renouvellement quadriennal)
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS beges_valide BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.prospects.beges_url IS 'URL directe vers le BEGES publié sur bilans-ges.ademe.fr';
COMMENT ON COLUMN public.prospects.beges_valide IS 'true si le BEGES a moins de 4 ans (obligation renouvellement quadriennal L229-25)';
