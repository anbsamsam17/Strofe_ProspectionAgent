-- =============================================================================
-- Migration : 031_rate_limits.sql
-- Projet    : ProspectionAgent (Glan) — Agent IA Prospection Bilan Carbone
-- Date      : 2026-06-23
-- Initiative: Rate-limiting par utilisateur sur les routes coûteuses (sécurité).
--
-- Contexte :
--   Aucun rate-limit n'existait jusqu'ici. Les routes qui consomment des quotas
--   externes payants (LLM/OpenAI, Hunter, Pappers) ou qui envoient des emails
--   (Resend) sont exposées à l'abus / spam. On introduit un compteur par
--   (user, bucket, fenêtre) self-contained dans Postgres — pas de dépendance
--   externe type Upstash/Redis, compatible serverless (Vercel).
--
-- Modèle (fenêtre glissante simple, "tumbling window") :
--   Chaque hit incrémente le compteur de la fenêtre tronquée à `window_start`.
--   La clé primaire composite (user_id, bucket, window_start) permet un UPSERT
--   atomique : `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1`.
--   Le helper applicatif (lib/rate-limit.ts) calcule `window_start` côté serveur
--   en tronquant `now()` à la taille de fenêtre du bucket.
--
-- Sécurité / RLS :
--   La table est écrite EXCLUSIVEMENT côté serveur via le client admin
--   (service_role), qui bypasse RLS. On active malgré tout RLS SANS policy
--   permissive : aucun rôle "anon"/"authenticated" ne peut lire ni écrire la
--   table depuis le client (PostgREST). C'est le pattern "deny-all + service_role
--   only" — défense en profondeur : même si un token user fuite, il ne peut pas
--   sonder/forger les compteurs de limitation.
--
-- TTL / housekeeping :
--   Les lignes des fenêtres passées deviennent inutiles. On ne met PAS en place
--   de pg_cron (pas garanti sur tous les plans Supabase). À la place :
--     - un index sur `window_start` rend un purge périodique trivial et rapide,
--     - une fonction `public.purge_rate_limit_hits()` (SECURITY DEFINER) que l'on
--       peut appeler manuellement ou brancher sur un cron applicatif si besoin.
--
-- Idempotence : CREATE TABLE/INDEX/FUNCTION IF NOT EXISTS — rejouable sans erreur.
-- Forward-only : pas de DROP destructif.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Table des hits de rate-limit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  user_id      UUID        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Identifiant logique du seau de limitation (ex. 'agent_run', 'email_send').
  bucket       TEXT        NOT NULL,
  -- Début de la fenêtre, tronqué côté serveur à la taille du bucket.
  window_start TIMESTAMPTZ NOT NULL,
  -- Nombre de hits dans cette fenêtre pour ce (user, bucket).
  count        INTEGER     NOT NULL DEFAULT 0,
  CONSTRAINT rate_limit_hits_pkey PRIMARY KEY (user_id, bucket, window_start)
);

-- Purge / housekeeping : balayage par ancienneté de fenêtre.
CREATE INDEX IF NOT EXISTS rate_limit_hits_window_start_idx
  ON public.rate_limit_hits (window_start);

COMMENT ON TABLE public.rate_limit_hits IS
  'Compteurs de rate-limiting par (user_id, bucket, window_start). Écrit côté serveur (service_role) uniquement. Voir lib/rate-limit.ts.';

-- ---------------------------------------------------------------------------
-- RLS : deny-all (aucune policy) — seul service_role accède à la table.
-- ---------------------------------------------------------------------------
ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
-- NB volontaire : aucune policy CREATE POLICY ... → tout accès via les rôles
-- anon/authenticated est refusé. service_role bypasse RLS par conception.

-- ---------------------------------------------------------------------------
-- Fonction de purge (TTL applicatif) — supprime les fenêtres plus vieilles
-- que `p_older_than` (défaut : 1 jour, large devant la plus grande fenêtre).
-- SECURITY DEFINER pour pouvoir être appelée par un cron applicatif si besoin.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_rate_limit_hits(
  p_older_than INTERVAL DEFAULT INTERVAL '1 day'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.rate_limit_hits
  WHERE window_start < (now() - p_older_than);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.purge_rate_limit_hits(INTERVAL) IS
  'Supprime les compteurs de rate-limit dont la fenêtre est plus ancienne que p_older_than. À brancher sur un cron si volumétrie.';

-- ---------------------------------------------------------------------------
-- Incrément atomique d'un compteur de fenêtre.
-- Un seul aller-retour, atomique via UPSERT (ON CONFLICT DO UPDATE), évite la
-- condition de course read-then-write d'un SELECT + UPDATE séparés sous charge
-- concurrente (plusieurs invocations serverless simultanées du même user).
-- Retourne la valeur du compteur APRÈS incrément.
-- SECURITY DEFINER : appelée via service_role, mais on fige le contexte.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_user_id      UUID,
  p_bucket       TEXT,
  p_window_start TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO public.rate_limit_hits AS r (user_id, bucket, window_start, count)
  VALUES (p_user_id, p_bucket, p_window_start, 1)
  ON CONFLICT (user_id, bucket, window_start)
  DO UPDATE SET count = r.count + 1
  RETURNING r.count INTO v_count;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.increment_rate_limit(UUID, TEXT, TIMESTAMPTZ) IS
  'Incrémente atomiquement le compteur (user, bucket, window_start) et renvoie la valeur post-incrément. Voir lib/rate-limit.ts → checkRateLimit().';

COMMIT;
