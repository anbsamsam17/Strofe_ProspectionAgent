-- =============================================================================
-- Migration : 030_security_hardening.sql
-- Projet    : ProspectionAgent (Glan) — Agent IA Prospection Bilan Carbone
-- Date      : 2026-06-23
-- Initiative: Durcissement securite transverse — revocation acces anon, integrite
--             deal_value, unicite des opt-out RGPD.
--
-- Contexte :
--   Trois durcissements cibles et independants, suite a la revue securite :
--
--   1) Acces `anon` expose sur le cache SIRENE (migration 019, l.185-214) :
--      La 019 a accorde `GRANT EXECUTE` sur search_sirene_cache(...) et
--      `GRANT SELECT` sur la vue sirene_cache_size au role `anon` (visiteur
--      non authentifie). Or l'application n'expose aucune surface publique :
--      tout passe par des sessions authentifiees. Laisser `anon` appeler une
--      fonction SECURITY DEFINER (qui bypass la RLS) et lire des metriques de
--      stockage est une surface d'attaque inutile. On revoque `anon` en
--      conservant `authenticated` et `service_role`.
--
--   2) Integrite deal_value (migration 026) :
--      La 026 a ajoute prospects.deal_value NUMERIC(10,2) avec un CHECK sur
--      deal_probability uniquement. deal_value n'a aucune borne basse : une
--      valeur negative (saisie erronee ou bug client) corromprait le forecast
--      pondere (deal_value * deal_probability / 100). On ajoute un CHECK
--      garantissant deal_value >= 0 (NULL reste autorise = non estime).
--
--   3) Unicite des opt-out RGPD (migration 015, l.253-259) :
--      Les index opt_out_user_siren_idx et opt_out_user_email_idx sont des
--      index de RECHERCHE non uniques. Rien n'empeche donc d'inserer plusieurs
--      fois le meme couple (user_id, siren) ou (user_id, lower(email)),
--      creant des doublons d'opt-out. C'est un risque RGPD (l'etat d'opt-out
--      doit etre univoque et fiable) et de coherence. On ajoute deux index
--      UNIQUE partiels (case-insensitive sur l'email, aligne sur l'index de
--      recherche existant qui indexe deja lower(email)).
--
-- Type de modification :
--   Migration ADDITIVE et idempotente :
--     - REVOKE (no-op si deja revoque).
--     - ADD CONSTRAINT via DO block garde par information_schema (idempotent).
--     - CREATE UNIQUE INDEX IF NOT EXISTS.
--   N'altere ni la structure des tables existantes ni les donnees. Ne touche
--   aucune migration deja appliquee en prod (019 / 026 / 015 restent intactes).
--   Rejouable sans erreur.
--
-- Pre-requis donnees (point 2 et 3) :
--   - deal_value < 0 : la VALIDATE echouerait s'il existe des lignes negatives.
--     On ajoute la contrainte en NOT VALID (valide les ecritures FUTURES sans
--     scanner l'existant), puis on tente VALIDATE dans un bloc tolerant aux
--     erreurs. Si des lignes negatives existent, la contrainte reste NOT VALID
--     (a corriger manuellement, cf. note plus bas).
--   - Doublons d'opt-out existants : la creation d'un index UNIQUE echouerait
--     en cas de doublons preexistants. En prod (2 clients, faible volume), on
--     part du principe qu'il n'y en a pas ; si la migration echoue sur l'un de
--     ces index, dedupliquer d'abord (cf. requete de dedup en commentaire).
--
-- Rollback (non automatise) :
--   -- 1) Re-accorder anon (revenir au comportement 019) :
--   GRANT EXECUTE ON FUNCTION public.search_sirene_cache(
--     TEXT[], TEXT[], TEXT, TEXT, TEXT[], INT, INT) TO anon;
--   GRANT SELECT ON public.sirene_cache_size TO anon;
--   -- 2) Supprimer le CHECK deal_value :
--   ALTER TABLE public.prospects DROP CONSTRAINT IF EXISTS prospects_deal_value_nonneg;
--   -- 3) Supprimer les index UNIQUE opt_out :
--   DROP INDEX IF EXISTS public.opt_out_user_siren_uidx;
--   DROP INDEX IF EXISTS public.opt_out_user_email_uidx;
--
-- Cout operationnel :
--   - REVOKE : nul.
--   - ADD CONSTRAINT NOT VALID : nul (pas de scan). VALIDATE : scan leger
--     (faible volume actuel).
--   - CREATE UNIQUE INDEX : build d'index sur opt_out (faible volume).
--
-- Backlog (NON traite ici — risque) :
--   prospects.is_hot_lead (migration 024) est une colonne GENERATED ALWAYS qui
--   peut valoir NULL (composante NULL => resultat NULL), ce qui complique le
--   filtre `WHERE is_hot_lead = TRUE`. NE PAS l'alterer dans cette migration :
--   modifier une colonne GENERATED impose un DROP/ADD COLUMN (perte/recalcul,
--   risque sur l'index partiel idx). A traiter dans une migration dediee apres
--   analyse (COALESCE dans l'expression generee ou normalisation cote app).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Revocation de l'acces anon sur le cache SIRENE (cf. 019 l.185-214)
--    Conserve authenticated + service_role.
-- ---------------------------------------------------------------------------

-- Signature recopiee a l'identique de la 019.
REVOKE EXECUTE ON FUNCTION public.search_sirene_cache(
  TEXT[], TEXT[], TEXT, TEXT, TEXT[], INT, INT
) FROM anon;

REVOKE SELECT ON public.sirene_cache_size FROM anon;

-- ---------------------------------------------------------------------------
-- 2. Integrite : deal_value >= 0 (cf. 026, prospects.deal_value NUMERIC(10,2))
--    Ajout idempotent via garde information_schema, en NOT VALID puis VALIDATE.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name        = 'prospects'
      AND constraint_name   = 'prospects_deal_value_nonneg'
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_deal_value_nonneg
      CHECK (deal_value IS NULL OR deal_value >= 0) NOT VALID;
  END IF;
END
$$;

-- Tentative de validation de l'existant. Si des lignes deal_value < 0 existent,
-- on garde la contrainte NOT VALID (les ecritures futures restent protegees)
-- et on emet un WARNING : corriger les lignes fautives puis relancer
--   ALTER TABLE public.prospects VALIDATE CONSTRAINT prospects_deal_value_nonneg;
DO $$
BEGIN
  ALTER TABLE public.prospects VALIDATE CONSTRAINT prospects_deal_value_nonneg;
EXCEPTION WHEN check_violation THEN
  RAISE WARNING 'prospects_deal_value_nonneg laissee NOT VALID : des lignes deal_value < 0 existent. Corriger puis VALIDATE manuellement.';
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Unicite des opt-out RGPD (cf. 015 l.253-259 : index non uniques)
--    Index UNIQUE partiels alignes sur les index de recherche existants.
-- ---------------------------------------------------------------------------

-- En cas d'echec sur doublons preexistants, dedupliquer d'abord, ex. :
--   DELETE FROM public.opt_out o USING public.opt_out d
--   WHERE o.user_id = d.user_id AND o.siren = d.siren
--     AND o.siren IS NOT NULL AND o.id > d.id;

CREATE UNIQUE INDEX IF NOT EXISTS opt_out_user_siren_uidx
  ON public.opt_out(user_id, siren)
  WHERE siren IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS opt_out_user_email_uidx
  ON public.opt_out(user_id, lower(email))
  WHERE email IS NOT NULL;

COMMENT ON INDEX public.opt_out_user_siren_uidx IS
  'Unicite de l''opt-out entreprise : un seul opt-out (user_id, siren) possible. '
  'Complete l''index de recherche non unique opt_out_user_siren_idx (015).';

COMMENT ON INDEX public.opt_out_user_email_uidx IS
  'Unicite de l''opt-out individuel : un seul opt-out (user_id, lower(email)) possible. '
  'Case-insensitive, aligne sur l''index de recherche non unique opt_out_user_email_idx (015).';

COMMIT;

-- =============================================================================
-- Fin de la migration 030_security_hardening.sql
-- Pour appliquer : npx supabase db push
-- =============================================================================
