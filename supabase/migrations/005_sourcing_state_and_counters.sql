-- =============================================================================
-- Migration : 005_sourcing_state_and_counters.sql
-- Projet    : Agent IA - Prospection Bilan Carbone
-- Date      : 2026-05-11
-- Initiative: fix/sourcing-pagination — persistance curseur Sirene
--             + observabilité agent_runs (breakdown new/updated, metrics Sirene).
--
-- Contexte (voir .claude/TODO-sourcing-fix.md) :
--   - Plateau à ~540 prospects : pagination Sirene figée, curseur non
--     persisté entre runs, trous d'observabilité dans agent_runs.
--   - Cette migration prépare la Wave 2 (boucle adaptative + persistance
--     curseur + logging breakdown).
--
-- Idempotence : tous les ADD COLUMN sont guardés par IF NOT EXISTS.
-- RLS : profiles et agent_runs ont déjà des policies S/I/U/D scopées par
--       auth.uid() = user_id (cf. 001_initial.sql lignes 100-115 et 697-712).
--       Les policies couvrent automatiquement les nouvelles colonnes,
--       aucune modification de policy n'est nécessaire.
-- Forward-only : pas de DROP / RENAME. Rollback éventuel = migration 006.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles.sourcing_state — persistance du curseur Sirene par user
-- ---------------------------------------------------------------------------
-- Structure JSONB attendue côté app :
--   {
--     "curseur"            : "*" | "<token-base64>",   -- curseur courant Sirene
--     "curseurSuivant"     : "<token-base64>" | null,   -- prochain curseur à envoyer
--     "filters_signature"  : "<hash-stable-des-filtres>", -- invalidation si change
--     "last_total"         : 12345,                     -- header.total dernier run
--     "exhausted_at"       : "2026-05-11T22:03:00Z" | null, -- univers épuisé
--     "last_run_at"        : "2026-05-11T22:03:00Z"     -- dernier run ayant écrit
--   }
-- Réinitialisé (curseur = '*') si filters_signature change vs valeur stockée.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sourcing_state JSONB NOT NULL DEFAULT '{}'::JSONB;

COMMENT ON COLUMN public.profiles.sourcing_state IS
  'État de pagination Sirene par user. Structure : '
  '{ curseur, curseurSuivant, filters_signature, last_total, exhausted_at, last_run_at }. '
  'Réinitialisé (curseur = ''*'') si filters_signature change. Permet la reprise '
  'de pagination entre runs cron successifs.';

-- ---------------------------------------------------------------------------
-- 2. agent_runs — colonnes counters new/updated + metrics Sirene
-- ---------------------------------------------------------------------------
-- Toutes nullables : runs antérieurs à la migration restent valides,
-- l'app pourra commencer à remplir progressivement.
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS prospects_new INTEGER;

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS prospects_updated INTEGER;

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS sirene_total_available INTEGER;

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS sirene_pages_loaded INTEGER;

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS sirene_debut_final INTEGER;

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS sirene_curseur_final TEXT;

COMMENT ON COLUMN public.agent_runs.prospects_new IS
  'Lignes effectivement insérées dans prospects pendant ce run '
  '(heuristique : created_at = updated_at après upsert).';

COMMENT ON COLUMN public.agent_runs.prospects_updated IS
  'Lignes upserted qui ont écrasé une ligne existante de prospects '
  '(heuristique : created_at < updated_at après upsert).';

COMMENT ON COLUMN public.agent_runs.sirene_total_available IS
  'header.total retourné par Sirene à la première page du run : '
  'univers total déclaré disponible avec les filtres courants.';

COMMENT ON COLUMN public.agent_runs.sirene_pages_loaded IS
  'Nombre de pages Sirene effectivement fetchées (boucle de pagination).';

COMMENT ON COLUMN public.agent_runs.sirene_debut_final IS
  'Dernier offset `debut` atteint en mode pagination offset legacy '
  '(optionnel — peut être NULL quand le mode curseur est utilisé).';

COMMENT ON COLUMN public.agent_runs.sirene_curseur_final IS
  'Dernier `curseurSuivant` Sirene à la fin du run. '
  'À persister également dans profiles.sourcing_state.curseurSuivant pour '
  'la reprise de pagination au run suivant.';

-- =============================================================================
-- Fin de la migration 005_sourcing_state_and_counters.sql
-- Application : Supabase Dashboard SQL editor ou `supabase db push`.
-- Régénération types : `npx supabase gen types typescript --project-id <id>
--                       > lib/supabase/database.types.ts`
--                      (ou édition manuelle de lib/supabase/database.types.ts
--                       — déjà appliquée dans le PR de cette migration).
-- =============================================================================
