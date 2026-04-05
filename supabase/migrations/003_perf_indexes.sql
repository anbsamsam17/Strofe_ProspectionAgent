-- =============================================================================
-- Migration : 003_perf_indexes.sql
-- Projet    : Agent IA - Prospection Bilan Carbone
-- Date      : 2026-04-05
-- Description: Index de performance — GIN trigram sur secteur_libelle pour
--              les filtres ilike '%...%' de la page Prospects, et index composite
--              sur (user_id, score_priorite, statut) pour phaseSelection.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extension pg_trgm (trigram) — nécessaire pour les index GIN sur ILIKE
-- Déjà disponible sur Supabase (PostgreSQL 15+), cette ligne est idempotente.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Index GIN trigram sur prospects.secteur_libelle
-- ---------------------------------------------------------------------------
-- Utilisé par :
--   - app/(dashboard)/prospects/page.tsx  : .ilike('secteur_libelle', '%...')
--   - app/api/prospects/route.ts          : .ilike('secteur_naf', '...')
-- Sans cet index, chaque filtre secteur est un seq scan sur toutes les lignes
-- du tenant. Avec pg_trgm + GIN, le coût passe de O(n) à O(log n).
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_prospects_secteur_libelle_trgm
  ON public.prospects
  USING GIN (secteur_libelle gin_trgm_ops);

COMMENT ON INDEX idx_prospects_secteur_libelle_trgm IS
  'Index GIN trigram pour les recherches ILIKE sur secteur_libelle (page Prospects).';

-- ---------------------------------------------------------------------------
-- Index composite (user_id, score_priorite DESC, statut)
-- ---------------------------------------------------------------------------
-- Utilisé par phaseSelection dans l'orchestrateur :
--   SELECT * FROM prospects
--   WHERE user_id = $1 AND statut IN ('sourced', 'qualified')
--   ORDER BY score_priorite DESC LIMIT 15
--
-- L'index existant idx_prospects_user_score (user_id, score_priorite DESC)
-- couvre déjà bien ce cas. On ajoute statut en troisième colonne pour que
-- PostgreSQL puisse filtrer IN ('sourced', 'qualified') directement dans
-- l'index sans heap fetch supplémentaire (index-only scan potentiel).
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_prospects_user_score_statut
  ON public.prospects (user_id, score_priorite DESC, statut);

COMMENT ON INDEX idx_prospects_user_score_statut IS
  'Index composite pour phaseSelection : filtre sur statut + tri score DESC par tenant.';

-- =============================================================================
-- Pour appliquer : supabase db push
-- Pour vérifier  : supabase db diff
--                  EXPLAIN ANALYZE SELECT ... WHERE user_id=... AND statut IN (...)
--                    ORDER BY score_priorite DESC LIMIT 15;
-- =============================================================================
