-- =============================================================================
-- Migration : 032_pipeline_metrics.sql
-- Projet    : ProspectionAgent (Glan) — Agent IA Prospection Bilan Carbone
-- Date      : 2026-06-25
-- Initiative: Métriques agrégées du pipeline nocturne (observabilité / data-eng).
--
-- Contexte :
--   La table `agent_runs` (cf. 001_initial.sql) journalise chaque exécution du
--   cron : statut (running/completed/failed), compteurs (prospects_sourced,
--   prospects_qualified), drapeau `list_generated`, et timestamps
--   `started_at` / `completed_at`. Jusqu'ici aucune lecture agrégée n'existait :
--   impossible de répondre à « combien de runs hier ? quel taux de succès ?
--   quelle durée médiane ? quel taux de qualification ? » sans requête ad-hoc.
--
--   Cette migration expose une VUE analytique `pipeline_metrics_daily` qui
--   agrège `agent_runs` PAR JOUR (date calendaire de `started_at`) ET PAR USER.
--   Elle est consommée par un reader TS typé (lib/agent/pipeline-metrics.ts).
--
-- Sécurité / RLS :
--   Une vue PostgreSQL est SECURITY INVOKER PAR DÉFAUT (sauf
--   `WITH (security_invoker = false)` ou pré-PG15 où les vues étaient toujours
--   évaluées avec les droits du propriétaire). On laisse le défaut + on force
--   explicitement `security_invoker = true` (PG15+, supporté par Supabase) :
--   => la vue est évaluée avec les droits de L'APPELANT, donc les policies RLS
--      de `agent_runs` (`auth.uid() = user_id`, cf. 001_initial.sql) s'appliquent
--      à travers la vue. Un utilisateur authentifié (PostgREST / SSR) ne voit
--      QUE l'agrégat de SES propres runs. Aucune fuite cross-tenant.
--   => Le client `service_role` (orchestrateur) bypasse RLS et voit tout —
--      comportement attendu pour le monitoring back-office.
--   Aucune policy n'est à créer SUR la vue : les vues n'ont pas de RLS propre,
--   elles héritent de celle des tables sous-jacentes via security_invoker.
--
-- Idempotence : CREATE OR REPLACE VIEW — rejouable sans erreur, sans DROP.
-- Forward-only : aucun DROP destructif. (Le bloc « Rollback » plus bas n'est
--   PAS exécuté ; il documente la marche arrière manuelle si jamais nécessaire.)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- VUE : pipeline_metrics_daily
-- Grain : 1 ligne par (user_id, jour calendaire de started_at).
--
-- Métriques exposées (toutes dérivées des colonnes réelles de agent_runs) :
--   - day                  : date calendaire (DATE) du run (started_at::date).
--   - user_id              : tenant (propagé pour le grain + RLS).
--   - runs_total           : nombre de runs ce jour-là.
--   - runs_completed       : runs status='completed'.
--   - runs_failed          : runs status='failed'.
--   - runs_running         : runs encore status='running' (non terminés).
--   - success_rate         : runs_completed / runs_total (ratio 0..1, 4 déc.).
--   - lists_generated      : runs ayant list_generated = TRUE.
--   - total_sourced        : somme de prospects_sourced sur le jour.
--   - total_qualified      : somme de prospects_qualified sur le jour.
--   - qualification_rate   : total_qualified / total_sourced (ratio 0..1, 4 déc.)
--                            — NULL si aucun prospect sourcé (division par zéro).
--   - avg_duration_seconds : durée moyenne (completed_at - started_at) en sec,
--                            sur les runs terminés uniquement.
--   - median_duration_seconds : médiane (PERCENTILE_CONT 0.5) de la même durée.
--
-- Notes de calcul :
--   - Les durées n'ont de sens que pour les runs avec `completed_at IS NOT NULL`.
--     On filtre donc l'argument de l'agrégat via FILTER (...) pour ne pas
--     polluer la moyenne/médiane avec des runs encore `running`.
--   - Les ratios utilisent NULLIF(denominateur, 0) pour renvoyer NULL plutôt
--     que de lever une division par zéro quand le dénominateur est nul.
--   - ROUND(..., n) borne la précision pour un affichage stable côté app.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.pipeline_metrics_daily
WITH (security_invoker = true) AS
SELECT
  (ar.started_at)::date                                          AS day,
  ar.user_id                                                     AS user_id,

  -- Volumétrie des runs
  COUNT(*)                                                       AS runs_total,
  COUNT(*) FILTER (WHERE ar.status = 'completed')                AS runs_completed,
  COUNT(*) FILTER (WHERE ar.status = 'failed')                   AS runs_failed,
  COUNT(*) FILTER (WHERE ar.status = 'running')                  AS runs_running,

  -- Taux de succès = runs terminés OK / total (ratio 0..1)
  ROUND(
    COUNT(*) FILTER (WHERE ar.status = 'completed')::numeric
      / NULLIF(COUNT(*), 0),
    4
  )                                                              AS success_rate,

  -- Listes effectivement générées
  COUNT(*) FILTER (WHERE ar.list_generated)                      AS lists_generated,

  -- Compteurs métier cumulés sur le jour
  COALESCE(SUM(ar.prospects_sourced), 0)                         AS total_sourced,
  COALESCE(SUM(ar.prospects_qualified), 0)                       AS total_qualified,

  -- Taux de qualification = qualifiés / sourcés (NULL si rien sourcé)
  ROUND(
    SUM(ar.prospects_qualified)::numeric
      / NULLIF(SUM(ar.prospects_sourced), 0),
    4
  )                                                              AS qualification_rate,

  -- Durées (runs terminés uniquement)
  ROUND(
    AVG(
      EXTRACT(EPOCH FROM (ar.completed_at - ar.started_at))
    ) FILTER (WHERE ar.completed_at IS NOT NULL)::numeric,
    2
  )                                                              AS avg_duration_seconds,

  ROUND(
    PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (ar.completed_at - ar.started_at))
    ) FILTER (WHERE ar.completed_at IS NOT NULL)::numeric,
    2
  )                                                              AS median_duration_seconds

FROM public.agent_runs ar
GROUP BY (ar.started_at)::date, ar.user_id;

-- ---------------------------------------------------------------------------
-- Documentation (COMMENT) — au même standard que les autres migrations.
-- ---------------------------------------------------------------------------
COMMENT ON VIEW public.pipeline_metrics_daily IS
  'Métriques agrégées du pipeline nocturne par (jour, user) à partir de agent_runs. '
  'SECURITY INVOKER (security_invoker=true) → hérite de la RLS de agent_runs : '
  'un user ne voit que ses propres agrégats. Lue par lib/agent/pipeline-metrics.ts.';

COMMIT;

-- =============================================================================
-- Rollback (NON exécuté — documentation de la marche arrière manuelle)
-- -----------------------------------------------------------------------------
-- Pour retirer entièrement la vue (la suppression est non destructive vis-à-vis
-- des données : une vue ne stocke rien, elle se recalcule à la lecture) :
--
--   BEGIN;
--   DROP VIEW IF EXISTS public.pipeline_metrics_daily;
--   COMMIT;
--
-- Pour revenir à une définition antérieure : ré-exécuter le CREATE OR REPLACE
-- VIEW de la version précédente (forward-only, pas de DOWN automatique ici).
-- =============================================================================
