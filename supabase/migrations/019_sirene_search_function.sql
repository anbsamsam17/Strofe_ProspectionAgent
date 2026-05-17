-- =============================================================================
-- Migration : 019_sirene_search_function.sql
-- Projet    : ProspectionAgent (Glan) — Agent IA Prospection Bilan Carbone
-- Date      : 2026-05-17
-- Initiative: Optimisation des requêtes sur sirene_cache (post 018_sirene_cache).
--
-- Contexte :
--   La migration 018 a créé `sirene_cache` avec 3 index partiels simples
--   (activite_principale, tranche_effectifs, code_postal — tous WHERE etat='A').
--
--   Cette migration ajoute :
--     1. Des index composites/full-text pour les patterns réels du sourcing
--        (tranche + range CP, recherche par nom, lookup SIRET ponctuel).
--     2. Une fonction PL/pgSQL `search_sirene_cache(...)` qui encapsule la
--        requête de sourcing en un appel SQL unique (au lieu d'un PostgREST
--        avec ~5 .filter() chainés côté Supabase JS, plus lent et plus fragile).
--     3. Une vue `sirene_cache_size` pour le monitoring storage + fraîcheur
--        (utilisée par les health-checks et l'admin dashboard).
--
-- Performance attendue :
--   - Requête typique du sourcing (NAF dans [...], tranche dans [...],
--     CP entre min et max, exclusion SIRENs déjà vus, LIMIT 100) :
--     * Avec ces index : ~5-20 ms sur 500k rows (Bitmap Heap Scan).
--     * La SECURITY DEFINER permet de bypass la RLS (ouverte de toute façon
--       en SELECT, mais évite la double évaluation de policy par row).
--
-- Sécurité :
--   - SECURITY DEFINER : OK car (a) sirene_cache n'a aucune PII (données
--     publiques INSEE), (b) la fonction ne reçoit que des filtres scalaires
--     typés (TEXT[], INT) — pas d'injection possible via paramètres.
--   - Fonction marquée STABLE (lecture seule, dépend de l'état DB, pas IMMUTABLE).
--
-- Idempotence :
--   - CREATE INDEX IF NOT EXISTS
--   - CREATE OR REPLACE FUNCTION / VIEW
--   - Rejouable sans erreur.
--
-- Rollback (non automatisé) :
--   DROP VIEW IF EXISTS public.sirene_cache_size;
--   DROP FUNCTION IF EXISTS public.search_sirene_cache(TEXT[], TEXT[], TEXT, TEXT, TEXT[], INT, INT);
--   DROP INDEX IF EXISTS public.sirene_cache_raison_sociale_fts_idx;
--   DROP INDEX IF EXISTS public.sirene_cache_siret_idx;
--   DROP INDEX IF EXISTS public.sirene_cache_tranche_cp_idx;
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Index composites et full-text additionnels
-- ---------------------------------------------------------------------------

-- Index composite (tranche_effectifs, code_postal) : pattern le plus fréquent
-- du sourcing (cibler une taille d'entreprise dans une zone géographique).
-- Le code_postal est en 2e position car la sélectivité de la tranche est
-- généralement plus haute (~10 tranches utiles vs. ~6000 codes postaux).
CREATE INDEX IF NOT EXISTS sirene_cache_tranche_cp_idx
  ON public.sirene_cache(tranche_effectifs, code_postal)
  WHERE etat_administratif = 'A';

COMMENT ON INDEX public.sirene_cache_tranche_cp_idx IS
  'Index composite pour les requêtes typiques du sourcing : '
  '(tranche d''effectifs ∈ [...]) AND (code_postal entre min et max). '
  'Couvre le pattern principal de search_sirene_cache().';

-- Index sur SIRET : lookup ponctuel par établissement (rare, mais utile
-- pour le debug et les vérifications croisées avec d'autres sources).
CREATE INDEX IF NOT EXISTS sirene_cache_siret_idx
  ON public.sirene_cache(siret)
  WHERE etat_administratif = 'A';

COMMENT ON INDEX public.sirene_cache_siret_idx IS
  'Lookup par SIRET (14 chiffres). Cas d''usage rare (debug, '
  'recoupement avec sources tierces). Le SIREN reste la PK.';

-- Index full-text français sur raison_sociale : permet une recherche par
-- nom d'entreprise (ex. "carrefour", "leclerc"). Configuration 'french'
-- pour gérer accents, pluriels, mots vides FR.
-- COALESCE pour ne pas indexer les NULL (qui ne devraient pas exister mais
-- protège contre une régression ETL).
CREATE INDEX IF NOT EXISTS sirene_cache_raison_sociale_fts_idx
  ON public.sirene_cache
  USING gin(to_tsvector('french', coalesce(raison_sociale, '')))
  WHERE etat_administratif = 'A';

COMMENT ON INDEX public.sirene_cache_raison_sociale_fts_idx IS
  'Index GIN full-text français sur raison_sociale. Permet une recherche '
  'par nom d''entreprise via to_tsquery(''french'', ''carrefour''). '
  'Non utilisé par search_sirene_cache() actuellement, prévu pour une '
  'future fonction de recherche par nom (admin / dedup manuel).';

-- ---------------------------------------------------------------------------
-- 2. Fonction search_sirene_cache — point d'entrée unique du sourcing
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.search_sirene_cache(
  p_naf_codes         TEXT[],
  p_tranche_effectifs TEXT[],
  p_code_postal_min   TEXT,
  p_code_postal_max   TEXT,
  p_exclude_sirens    TEXT[],
  p_limit             INT DEFAULT 100,
  p_offset            INT DEFAULT 0
)
RETURNS TABLE (
  siren                TEXT,
  siret                TEXT,
  raison_sociale       TEXT,
  activite_principale  TEXT,
  tranche_effectifs    TEXT,
  effectif_min         INT,
  effectif_max         INT,
  code_postal          TEXT,
  commune              TEXT,
  adresse              TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sc.siren,
    sc.siret,
    sc.raison_sociale,
    sc.activite_principale,
    sc.tranche_effectifs,
    sc.effectif_min,
    sc.effectif_max,
    sc.code_postal,
    sc.commune,
    sc.adresse
  FROM public.sirene_cache sc
  WHERE sc.etat_administratif = 'A'
    AND (
      p_naf_codes IS NULL
      OR cardinality(p_naf_codes) = 0
      OR sc.activite_principale = ANY(p_naf_codes)
    )
    AND (
      p_tranche_effectifs IS NULL
      OR cardinality(p_tranche_effectifs) = 0
      OR sc.tranche_effectifs = ANY(p_tranche_effectifs)
    )
    AND (
      p_code_postal_min IS NULL
      OR sc.code_postal >= p_code_postal_min
    )
    AND (
      p_code_postal_max IS NULL
      OR sc.code_postal <= p_code_postal_max
    )
    AND (
      p_exclude_sirens IS NULL
      OR cardinality(p_exclude_sirens) = 0
      OR sc.siren <> ALL(p_exclude_sirens)
    )
  ORDER BY sc.siren
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.search_sirene_cache(
  TEXT[], TEXT[], TEXT, TEXT, TEXT[], INT, INT
) IS
  'Recherche multi-critères dans sirene_cache avec exclusion des SIREN '
  'déjà présents en base prospects (dedup). Encapsule la logique de '
  'sourcing dans une fonction unique pour éviter la composition fragile '
  'côté Supabase JS (chained .filter()). '
  'Paramètres : '
  ' p_naf_codes (TEXT[]) — liste de codes NAF format "XX.XXY" ; NULL/[] = tous. '
  ' p_tranche_effectifs (TEXT[]) — codes INSEE tranche ; NULL/[] = tous. '
  ' p_code_postal_min (TEXT) — borne basse CP (ex. "33000") ; NULL = aucune. '
  ' p_code_postal_max (TEXT) — borne haute CP (ex. "33999") ; NULL = aucune. '
  ' p_exclude_sirens (TEXT[]) — SIREN à exclure (dedup) ; NULL/[] = aucun. '
  ' p_limit (INT) — max rows retournées (défaut 100). '
  ' p_offset (INT) — pagination (défaut 0). '
  'STABLE + SECURITY DEFINER : bypass RLS (lecture publique de toute façon), '
  'évite la ré-évaluation de policy par row, gain perf significatif.';

-- Permissions explicites : tous les rôles applicatifs peuvent appeler.
-- (Le service_role bypass déjà tout, mais on l'inclut pour exhaustivité.)
GRANT EXECUTE ON FUNCTION public.search_sirene_cache(
  TEXT[], TEXT[], TEXT, TEXT, TEXT[], INT, INT
) TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- 3. Vue sirene_cache_size — monitoring storage et fraîcheur
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.sirene_cache_size AS
SELECT
  pg_size_pretty(pg_total_relation_size('public.sirene_cache'))      AS total_size,
  pg_total_relation_size('public.sirene_cache')                      AS total_bytes,
  (SELECT count(*)
     FROM public.sirene_cache
     WHERE etat_administratif = 'A')                                 AS active_count,
  (SELECT max(imported_at) FROM public.sirene_cache)                 AS last_import_at,
  EXTRACT(
    EPOCH FROM (
      NOW() - (SELECT max(imported_at) FROM public.sirene_cache)
    )
  ) / 86400                                                          AS days_since_import;

COMMENT ON VIEW public.sirene_cache_size IS
  'Vue de monitoring du cache SIRENE. Expose : taille totale (octets + '
  'pretty), nombre d''établissements actifs, date du dernier import et '
  'âge en jours. Utilisée par les health-checks et l''admin dashboard '
  'pour déclencher un re-import quand days_since_import > 35.';

-- Lecture publique : pas de données sensibles, juste des métriques agrégées.
GRANT SELECT ON public.sirene_cache_size TO authenticated, anon;

COMMIT;

-- =============================================================================
-- Fin de la migration 019_sirene_search_function.sql
-- Pour appliquer : npx supabase db push
-- Après push     : npx supabase gen types typescript --linked > lib/supabase/database.types.ts
-- =============================================================================
