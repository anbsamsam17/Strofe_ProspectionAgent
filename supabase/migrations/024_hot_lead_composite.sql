-- =============================================================================
-- Migration 024 : prospects.is_hot_lead — flag composite (GLN-081)
-- Date    : 2026-05-20
--
-- Objectif :
--   Permettre un filtre rapide "Top opportunités" sur la liste prospects.
--   Composite calcule cote DB (GENERATED ALWAYS) pour rester coherent avec
--   l'UI client + index partiel pour la requete `WHERE is_hot_lead = TRUE`.
--
-- Formule :
--   is_hot_lead = (
--     obligation_beges = TRUE
--     AND (
--          beges_publie = FALSE
--       OR beges_valide = FALSE
--       OR beges_decret_2022_compliant = FALSE
--     )
--     AND contact_email IS NOT NULL
--     AND effectif_min >= 250
--   )
--
-- Notes :
--   - `beges_decret_2022_compliant` est tristate (NULL/TRUE/FALSE). On ne
--     considere comme "non conforme" que FALSE explicite (cf. GLN-006). Un
--     prospect sans data Decret 2022 ne devient pas Hot pour cette raison
--     seule — il faudra qu'il soit aussi non publie ou expire.
--   - `effectif_min >= 250` : seuil DOM-TOM (Art. L229-25 + GLN-004). Les
--     entreprises >= 250 sal. sont au minimum CSRD vague 2 / cible Glan.
--   - `contact_email IS NOT NULL` : sans email, pas d'outreach immediat
--     (le filtre Hot doit servir une action commerciale).
--
-- Idempotence : ADD COLUMN IF NOT EXISTS (la colonne GENERATED ne peut pas
-- etre alteree apres coup, mais ADD IF NOT EXISTS evite l'erreur en re-run).
-- =============================================================================

BEGIN;

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS is_hot_lead BOOLEAN
    GENERATED ALWAYS AS (
      obligation_beges = TRUE
      AND (
        beges_publie = FALSE
        OR beges_valide = FALSE
        OR beges_decret_2022_compliant = FALSE
      )
      AND contact_email IS NOT NULL
      AND effectif_min >= 250
    ) STORED;

COMMENT ON COLUMN public.prospects.is_hot_lead IS
  'Flag composite (GENERATED ALWAYS) marquant les prospects "hot" : entreprise '
  'soumise à l''obligation BEGES (Art. L229-25), BEGES manquant / expiré / non '
  'conforme Décret 2022-982, email de contact disponible, effectif >= 250 sal. '
  'Exploitable côté UI pour le filtre rapide "Top opportunités" et côté agent '
  'pour la priorisation des séquences outreach. Recalculé automatiquement à '
  'chaque UPDATE des colonnes sources.';

-- Index partiel : on requete uniquement les hot leads (sous-ensemble).
-- Ordonne par score_priorite DESC pour servir directement la liste
-- "Top opportunités" sans tri en mémoire.
CREATE INDEX IF NOT EXISTS idx_prospects_hot_leads
  ON public.prospects(user_id, score_priorite DESC)
  WHERE is_hot_lead = TRUE;

COMMIT;

-- =============================================================================
-- Fin de la migration 024_hot_lead_composite.sql
-- Pour appliquer : supabase db push
-- Apres push     : npx supabase gen types typescript --linked > lib/supabase/database.types.ts
--                  (la colonne is_hot_lead apparaitra en Row + Update mais PAS en
--                   Insert — GENERATED ALWAYS interdit l'ecriture explicite).
-- =============================================================================
