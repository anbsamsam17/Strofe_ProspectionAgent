-- =============================================================================
-- Diagnostic : migration 014_notification_callback_done
-- Projet     : Agent IA - Prospection Bilan Carbone
-- Date       : 2026-05-17
--
-- Usage :
--   Supabase Dashboard → onglet "SQL Editor" → coller ce fichier → Run.
--   Ou via CLI : psql $DATABASE_URL -f scripts/diagnose-migration-014.sql
--
-- Interprétation du résultat :
--   - 1 ligne retournée  → migration 014 appliquée. La colonne existe.
--   - 0 ligne retournée  → migration 014 NON appliquée.
--                          Appliquer via : npx supabase db push
--                          Ou copier-coller le contenu de
--                          supabase/migrations/014_notification_callback_done.sql
--                          dans le SQL Editor et exécuter.
-- =============================================================================

SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE
  table_schema = 'public'
  AND table_name  = 'prospect_exchanges'
  AND column_name = 'callback_done';

-- =============================================================================
-- Diagnostic complémentaire : lister TOUTES les colonnes de prospect_exchanges
-- pour comparer avec les autres environnements (local vs prod).
-- Décommenter si besoin :
-- =============================================================================
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name   = 'prospect_exchanges'
-- ORDER BY ordinal_position;

-- =============================================================================
-- Diagnostic index : vérifier que l'index partiel de la migration 014 existe.
-- 1 ligne retournée = index présent. 0 ligne = index absent (migration non appliquée
-- ou appliquée partiellement).
-- =============================================================================
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE
  schemaname = 'public'
  AND tablename  = 'prospect_exchanges'
  AND indexname  = 'prospect_exchanges_pending_callbacks_idx';
