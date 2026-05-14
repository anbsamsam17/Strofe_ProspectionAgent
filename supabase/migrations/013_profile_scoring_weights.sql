-- =============================================================================
-- Migration : 013_profile_scoring_weights.sql
-- Projet    : Agent IA - Prospection Bilan Carbone
-- Date      : 2026-05-14
-- Initiative: Refonte UI majeure — pondérations de scoring éditables par user.
--
-- Contexte :
--   Le scoring composite (lib/agent/scoring.ts) est aujourd'hui codé en dur :
--   pondérations fixes Taille/BEGES/Contact. La refonte UI introduit la
--   personnalisation : chaque user peut ajuster ses pondérations dans
--   profiles.settings.scoring_weights (JSONB).
--
--   Cette migration est PUREMENT DOCUMENTAIRE — elle ne change pas le schéma
--   physique (profiles.settings est déjà JSONB depuis 001_initial.sql). Elle
--   documente la nouvelle clé attendue dans le JSON.
--
--   Schéma attendu côté app (interface TS ProfileSettings) :
--     {
--       target_sectors, target_city, target_postal_codes,
--       daily_call_target, notification_email, offer_description,
--       scoring_weights?: { taille: number, beges: number, contact: number }
--     }
--
--   Contrainte business : taille + beges + contact === 100 (validation côté app).
--   Valeurs par défaut : { taille: 30, beges: 30, contact: 40 }
--   (cf. lib/types.ts → DEFAULT_SCORING_WEIGHTS).
--
-- RLS : aucune modification — profiles conserve ses 4 policies (001_initial.sql).
-- Idempotence : COMMENT ON COLUMN est rejouable sans effet de bord.
-- =============================================================================

COMMENT ON COLUMN public.profiles.settings IS
  'JSONB de configuration de l''agent. Schéma : '
  '{ target_sectors: string[], target_city?: string, target_postal_codes?: string[], '
  'daily_call_target: number, notification_email?: string, offer_description?: string, '
  'scoring_weights?: { taille: number, beges: number, contact: number } }. '
  'scoring_weights doit sommer à 100 ; defaults 30/30/40 (cf. lib/types.ts → '
  'DEFAULT_SCORING_WEIGHTS). Validation de la somme assurée côté app, pas en DB.';

-- =============================================================================
-- Fin de la migration 013_profile_scoring_weights.sql
-- Aucune commande SQL d'altération de schéma — doc-only.
-- =============================================================================
