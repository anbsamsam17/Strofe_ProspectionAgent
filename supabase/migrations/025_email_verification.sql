-- =============================================================================
-- Migration : 025_email_verification.sql
-- Projet    : ProspectionAgent (Glan) — Agent IA Prospection Bilan Carbone
-- Ticket    : GLN-062 (verification email + score confiance Hunter)
-- Date      : 2026-05-20
--
-- Contexte :
--   La migration 015 a posé les bases (email_status, email_confidence,
--   email_verified_at sur prospect_contacts) avec un CHECK constraint
--   restreint a ('valid', 'catchall', 'invalid', 'unknown', 'pattern_unverified').
--
--   Pour brancher Hunter Email Verifier (https://hunter.io/api/email-verifier),
--   on a besoin d'accepter en plus les statuts natifs Hunter :
--     - 'accept_all' (catchall — alias plus explicite)
--     - 'webmail'    (gmail/yahoo/etc — pas envoyable pro)
--     - 'disposable' (domaine jetable type mailinator)
--     - 'unverified' (jamais vérifié — état initial explicite vs NULL)
--
--   On garde 'catchall' pour rétrocompat avec les lignes pré-025 (l'orchestrator
--   et certaines parties du code utilisent encore ce label legacy).
--
--   `email_confidence` (smallint 0-100, déjà présent en 015) est utilisé tel
--   quel comme score Hunter (`score` dans la réponse API). Pas de nouvelle
--   colonne dédiée — la sémantique est identique.
--
-- Risques :
--   - Downtime : nul. ALTER CHECK constraint avec DROP/ADD non bloquant pour
--     les UPDATE concurrents (PostgreSQL ne re-valide pas les rows existantes
--     car le nouveau CHECK est strictement plus permissif).
--   - FK / RLS : inchangés.
--
-- Idempotence : DROP CONSTRAINT IF EXISTS avant ADD CONSTRAINT.
--
-- TODO regen types apres push :
--   npx supabase gen types typescript --linked > lib/supabase/database.types.ts
--
-- Rollback (manuel) :
--   ALTER TABLE public.prospect_contacts
--     DROP CONSTRAINT IF EXISTS prospect_contacts_email_status_check;
--   ALTER TABLE public.prospect_contacts
--     ADD CONSTRAINT prospect_contacts_email_status_check
--     CHECK (email_status IN ('valid', 'catchall', 'invalid', 'unknown', 'pattern_unverified'));
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Elargir le CHECK email_status pour accepter les statuts Hunter natifs.
-- ---------------------------------------------------------------------------

ALTER TABLE public.prospect_contacts
  DROP CONSTRAINT IF EXISTS prospect_contacts_email_status_check;

ALTER TABLE public.prospect_contacts
  ADD CONSTRAINT prospect_contacts_email_status_check
  CHECK (
    email_status IS NULL
    OR email_status IN (
      'valid',              -- SMTP OK, envoyable
      'invalid',            -- SMTP refus, ne pas envoyer
      'catchall',           -- legacy 015 — alias historique de accept_all
      'accept_all',         -- Hunter : domaine catchall (envoyable mais sans certitude)
      'webmail',            -- Hunter : gmail/yahoo/hotmail/etc — perso
      'disposable',         -- Hunter : domaine jetable (mailinator, tempmail, ...)
      'unknown',            -- legacy 015 — verification impossible
      'unverified',         -- jamais verifie (etat initial explicite)
      'pattern_unverified'  -- legacy 015 — infere par pattern Hunter sans verif SMTP
    )
  );

COMMENT ON COLUMN public.prospect_contacts.email_status IS
  'Statut de verification email :
    - valid (SMTP OK), invalid (SMTP refuse)
    - catchall / accept_all (domaine accepte tout — alias historique vs Hunter natif)
    - webmail (gmail/yahoo/etc), disposable (domaine jetable)
    - unknown (verif impossible), unverified (jamais verifie)
    - pattern_unverified (infere par pattern sans verif SMTP).';

-- ---------------------------------------------------------------------------
-- 2. Index partiel pour lister les emails a re-verifier (older than 30d).
--    Sert la regle UX : afficher le bouton "Verifier" si jamais verifie
--    OU si verification > 30 jours.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS prospect_contacts_to_reverify_idx
  ON public.prospect_contacts(prospect_id, email_verified_at)
  WHERE email IS NOT NULL;

COMMIT;

-- =============================================================================
-- Fin de la migration 025_email_verification.sql
-- Pour appliquer  : supabase db push
-- Apres push      : npx supabase gen types typescript --linked > lib/supabase/database.types.ts
-- =============================================================================
