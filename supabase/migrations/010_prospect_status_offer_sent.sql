-- =============================================================================
-- Migration : 010_prospect_status_offer_sent.sql
-- Projet    : Agent IA - Prospection Bilan Carbone
-- Date      : 2026-05-14
-- Initiative: Refonte UI majeure — ajout du statut 'offer_sent' dans le pipeline.
--
-- Contexte :
--   Le pipeline CRM expose un nouvel état intermédiaire entre 'interested' et
--   'converted' : 'offer_sent' (offre / devis envoyé, en attente de signature).
--   La colonne `prospects.statut` est typée via l'ENUM Postgres
--   `public.prospect_status` (cf. 001_initial.sql lignes 156-165), PAS via un
--   CHECK constraint — on utilise donc `ALTER TYPE ... ADD VALUE`.
--
-- Note Postgres :
--   - ALTER TYPE ... ADD VALUE IF NOT EXISTS fonctionne dans une transaction
--     depuis PG 12 (Supabase tourne PG 15+ : OK).
--   - Forward-only : Postgres ne permet pas de retirer une valeur d'un ENUM
--     déjà utilisé. Si rollback nécessaire → migration de remplacement.
--
-- Toutes les anciennes valeurs sont conservées :
--   sourced, qualified, contacted, interested, rdv, converted, rejected, on_hold
-- Nouvelle valeur ajoutée : offer_sent
--
-- RLS : aucune modification — prospects conserve ses 4 policies (001_initial.sql).
-- =============================================================================

ALTER TYPE public.prospect_status ADD VALUE IF NOT EXISTS 'offer_sent';

COMMENT ON TYPE public.prospect_status IS
  'Statut du prospect dans le pipeline CRM. Valeurs : '
  'sourced (sourcé, non qualifié), '
  'qualified (qualifié, prêt à appeler), '
  'contacted (au moins un appel), '
  'interested (intéressé), '
  'rdv (rendez-vous décroché, legacy — n''est plus affiché dans le nouveau Kanban), '
  'offer_sent (offre/devis envoyé, en attente de signature), '
  'converted (converti en client), '
  'rejected (disqualifié), '
  'on_hold (en pause).';

-- =============================================================================
-- Fin de la migration 010_prospect_status_offer_sent.sql
-- Pour appliquer : supabase db push
-- =============================================================================
