-- =============================================================================
-- Migration : 002_daily_lists_notified_at.sql
-- Projet    : Agent IA - Prospection Bilan Carbone
-- Date      : 2026-04-05
-- Description: Ajout de la colonne notified_at sur daily_lists.
--              Permet de détecter si la notification email a déjà été envoyée
--              pour éviter les doublons d'envoi entre deux runs du cron 7h30.
-- =============================================================================

-- Ajout de la colonne (nullable — NULL = pas encore notifié)
ALTER TABLE public.daily_lists
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.daily_lists.notified_at IS
  'Horodatage d''envoi de la notification email matinale (cron 7h30). '
  'NULL = notification pas encore envoyée. '
  'Utilisé par /api/notifications/daily pour éviter les doublons.';

-- Index partiel pour les requêtes du cron (listes prêtes non notifiées)
CREATE INDEX IF NOT EXISTS idx_daily_lists_not_notified
  ON public.daily_lists (date, status)
  WHERE notified_at IS NULL AND status = 'ready';

-- =============================================================================
-- Pour appliquer : supabase db push
-- Pour vérifier  : supabase db diff
-- =============================================================================
