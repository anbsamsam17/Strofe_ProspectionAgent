-- ============================================================
-- Migration 014 — Cleanup post-pivot ProspectionAgent
-- Date : 2026-05-15
--
-- Rationale :
--   L'orchestrator ne génère plus de daily_list ni de pitchs depuis le pivot
--   (commits 6c9de46 + 7366fed). Les tables daily_lists et daily_list_items
--   ne sont plus lues ni écrites par aucun code applicatif depuis le LOT 6.
--   Les types DB orphelins daily_list_status et call_priority sont également
--   supprimés. Le champ JSONB daily_call_target dans profiles.settings est
--   renommé sourcing_target_per_run pour refléter l'usage réel (pilotage de
--   la boucle Sirene, pas un objectif d'appels).
--
--   NB : public.call_result est CONSERVÉ — il est utilisé par
--   prospect_exchanges.result (historique des échanges, migration 012).
--
-- Rollback (à jouer dans l'ordre inverse si besoin) :
--   UPDATE public.profiles
--     SET settings = settings - 'sourcing_target_per_run'
--                   || jsonb_build_object('daily_call_target',
--                        COALESCE((settings->>'sourcing_target_per_run')::int, 15))
--     WHERE settings ? 'sourcing_target_per_run';
--
--   CREATE TYPE public.call_priority AS ENUM ('haute', 'normale', 'basse');
--   CREATE TYPE public.daily_list_status AS ENUM ('pending', 'generating', 'ready', 'completed');
--
--   Recréer daily_lists + daily_list_items depuis la migration 001_initial.sql.
-- ============================================================

-- 1. Supprimer daily_list_items en premier (FK vers daily_lists)
DROP TABLE IF EXISTS public.daily_list_items CASCADE;

-- 2. Supprimer daily_lists
DROP TABLE IF EXISTS public.daily_lists CASCADE;

-- 3. Supprimer les types DB orphelins
DROP TYPE IF EXISTS public.daily_list_status;
DROP TYPE IF EXISTS public.call_priority;

-- 4. Renommer daily_call_target → sourcing_target_per_run dans profiles.settings
--    Idempotent : ne touche que les lignes qui ont encore l'ancienne clé.
UPDATE public.profiles
SET settings = settings - 'daily_call_target'
              || jsonb_build_object(
                   'sourcing_target_per_run',
                   COALESCE((settings->>'daily_call_target')::int, 15)
                 )
WHERE settings ? 'daily_call_target';
