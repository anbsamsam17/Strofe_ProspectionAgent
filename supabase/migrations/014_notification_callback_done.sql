-- COLLISION DE NUMÉROTATION 014 : trois migrations partagent le préfixe 014
--   (014_prospects_gemini_scoring / 014_drop_daily_lists_and_rename /
--    014_notification_callback_done), créées en parallèle sur des branches
--   distinctes la même semaine, d'où le même numéro libre après 013.
-- ORDRE D'APPLICATION VOULU (par date d'en-tête, chronologie d'écriture) :
--   1) 014_prospects_gemini_scoring   (2026-05-14)
--   2) 014_drop_daily_lists_and_rename (2026-05-15)
--   3) 014_notification_callback_done  (2026-05-17)  <-- CE FICHIER, à jouer EN DERNIER
-- Les trois ciblent des objets disjoints (prospects / daily_lists+profiles /
--   prospect_exchanges) : aucune dépendance croisée, l'ordre par date est sûr.
-- =============================================================================
-- Migration : 014_notification_callback_done.sql
-- Projet    : Agent IA - Prospection Bilan Carbone
-- Date      : 2026-05-17
-- Initiative: Notifications — onglet relances + échanges importants.
--
-- Contexte :
--   Ajoute `callback_done BOOLEAN DEFAULT FALSE` sur `prospect_exchanges`.
--   Permet de marquer une relance comme "traitée" sans supprimer la
--   callback_date (conservation de l'historique) ni créer un échange parasite.
--   La page /notifications filtre sur `callback_done = false` pour ne montrer
--   que les relances actives.
--
-- RLS : les policies existantes (UPDATE own) couvrent déjà ce nouveau champ.
--
-- Rollback :
--   ALTER TABLE public.prospect_exchanges DROP COLUMN IF EXISTS callback_done;
-- =============================================================================

ALTER TABLE public.prospect_exchanges
  ADD COLUMN IF NOT EXISTS callback_done BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.prospect_exchanges.callback_done IS
  'Vrai si la relance (callback_date) a été traitée par l''utilisateur. '
  'Permet de masquer la relance de la page /notifications sans effacer la date.';

-- Index partiel : accélère la query de la page notifications
-- (seulement les relances non traitées avec une callback_date).
CREATE INDEX IF NOT EXISTS prospect_exchanges_pending_callbacks_idx
  ON public.prospect_exchanges(user_id, callback_date)
  WHERE callback_date IS NOT NULL AND callback_done = FALSE;

-- =============================================================================
-- Fin de la migration 014_notification_callback_done.sql
-- Pour appliquer : npx supabase db push
-- =============================================================================
