-- =============================================================================
-- Migration : 006_call_result_extended.sql
-- Projet    : Agent IA - Prospection Bilan Carbone
-- Date      : 2026-05-12
-- Initiative: feedback "Liste du jour" — élargir l'enum call_result.
--
-- Contexte (Commentaires outil prospection) :
--   - L'utilisateur a besoin de deux résultats supplémentaires dans le formulaire
--     de feedback d'appel :
--       * "email_sent"        — l'humain a finalement envoyé un email au lieu d'appeler
--       * "no_contact_point"  — aucun canal de contact disponible (téléphone/email/linkedin)
--   - Ces deux valeurs s'ajoutent à l'enum public.call_result déjà défini en
--     migration 001_initial.sql (lignes 442-449).
--
-- Type concerné : ENUM Postgres `public.call_result` (PAS un CHECK constraint).
-- Idempotence  : ALTER TYPE ... ADD VALUE IF NOT EXISTS — rejouable sans erreur.
-- RLS          : aucune modification — daily_list_items conserve ses 4 policies.
-- Forward-only : Postgres ne permet pas de retirer une valeur d'un ENUM utilisé.
--                Si rollback nécessaire → migration 007.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Ajout des deux nouvelles valeurs dans l'enum call_result
-- ---------------------------------------------------------------------------
-- Note Postgres : ADD VALUE doit s'exécuter HORS transaction implicite.
-- supabase db push wrappe chaque fichier dans une transaction par défaut, mais
-- ADD VALUE IF NOT EXISTS fonctionne dans une transaction depuis PG 12.

ALTER TYPE public.call_result ADD VALUE IF NOT EXISTS 'email_sent';
ALTER TYPE public.call_result ADD VALUE IF NOT EXISTS 'no_contact_point';

COMMENT ON TYPE public.call_result IS
  'Résultat d''un appel de prospection. '
  'Valeurs : interested, callback, not_interested, wrong_contact, no_answer, '
  'voicemail, email_sent (email envoyé au lieu d''appeler), '
  'no_contact_point (aucun canal de contact disponible).';

-- =============================================================================
-- Fin de la migration 006_call_result_extended.sql
-- Pour appliquer : supabase db push
-- =============================================================================
