-- =============================================================================
-- Migration : 018_sirene_cache.sql
-- Projet    : ProspectionAgent (Glan) — Agent IA Prospection Bilan Carbone
-- Date      : 2026-05-17
-- Initiative: Cache local SIRENE bulk — fallback ultime au sourcing API Sirene.
--
-- Contexte :
--   L'API Sirene INSEE (api.insee.fr/api-sirene/3.11/siret) plante de manière
--   persistante (4xx silencieux, timeouts, throttling agressif). Le sourcing
--   nocturne s'épuise et le runner finit en "Univers de recherche épuisé".
--
--   Solution : télécharger mensuellement le bulk INSEE SIRENE
--   (StockEtablissement_utf8.zip ~3 GB / ~30M lignes, source : data.gouv.fr),
--   filtrer côté ETL (entreprises actives, tranche d'effectifs ≥ 11 = 6+ salariés),
--   et stocker un sous-ensemble ciblé (~250-500k établissements) en miroir local.
--
--   À terme, `searchSireneCache()` remplacera l'appel runtime à l'API Sirene
--   dans `lib/agent/sourcing-runner.ts` (avec l'API Sirene en fallback,
--   inversion de la cascade actuelle).
--
-- Nature de la donnée :
--   Données publiques INSEE (entreprises FR). PAS DE PII (le contact dirigeant
--   reste géré via `prospect_contacts` avec RLS stricte). Justifie une lecture
--   publique : tous les users du SaaS interrogent ce cache (mutualisation).
--
-- RLS :
--   - SELECT : ouvert à tous (USING true) — pas de filtre user_id, le cache
--     est partagé entre users.
--   - INSERT/UPDATE/DELETE : aucune policy → seul service_role écrit (le
--     script ETL `scripts/import-sirene-bulk.ts`). Conforme à rules/security.md.
--
-- Idempotence :
--   - CREATE TABLE IF NOT EXISTS
--   - CREATE INDEX IF NOT EXISTS
--   - DROP POLICY IF EXISTS avant CREATE POLICY
--
-- Estimation taille DB :
--   ~500k lignes × ~250 octets moyens (avec index) = ~125 MB de stockage
--   Supabase. À multiplier par ~1.5 pour les index → ~200 MB total.
--   Acceptable sur tier Pro Supabase (8 GB inclus).
--
-- Rollback (non automatisé) :
--   DROP TABLE IF EXISTS public.sirene_cache CASCADE;
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Table sirene_cache — miroir local d'un sous-ensemble pertinent de SIRENE
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sirene_cache (
  siren                TEXT         PRIMARY KEY,
  siret                TEXT         NOT NULL,
  raison_sociale       TEXT,
  activite_principale  TEXT,        -- code NAF (format 01.21Z)
  tranche_effectifs    TEXT,        -- '11', '12', '21', '22', '31', '32', '41', '42', '51', '52', '53'
  effectif_min         INT,
  effectif_max         INT,
  code_postal          TEXT,
  commune              TEXT,
  adresse              TEXT,
  etat_administratif   TEXT,        -- 'A' = actif, 'F' = fermé (on ne devrait stocker que 'A')
  date_creation        DATE,
  date_maj_insee       DATE,
  imported_at          TIMESTAMPTZ  DEFAULT NOW(),
  source_file          TEXT         -- ex. 'StockEtablissement_utf8_202510.zip'
);

COMMENT ON TABLE public.sirene_cache IS
  'Miroir local d''un sous-ensemble filtré du fichier bulk INSEE SIRENE '
  '(StockEtablissement_utf8.zip). ~250-500k établissements actifs avec '
  'tranche d''effectifs >= 11 (6+ salariés). Sert de source primaire au '
  'sourcing nocturne en remplacement de l''API Sirene instable. '
  'Réimporté mensuellement via scripts/import-sirene-bulk.ts (service_role). '
  'Lecture publique (pas de PII), écriture réservée service_role.';

COMMENT ON COLUMN public.sirene_cache.siren IS
  'SIREN 9 chiffres de l''entreprise (clé primaire — un siège retenu par entreprise).';

COMMENT ON COLUMN public.sirene_cache.siret IS
  'SIRET 14 chiffres de l''établissement (siège retenu lors de l''ETL).';

COMMENT ON COLUMN public.sirene_cache.activite_principale IS
  'Code NAF rev. 2 de l''activité principale, format "01.21Z" (avec point).';

COMMENT ON COLUMN public.sirene_cache.tranche_effectifs IS
  'Code INSEE de la tranche d''effectifs salariés de l''établissement : '
  '''11'' (1-2), ''12'' (3-5), ''21'' (6-9), ''22'' (10-19), ''31'' (20-49), '
  '''32'' (50-99), ''41'' (100-199), ''42'' (200-249), ''51'' (250-499), '
  '''52'' (500-999), ''53'' (1000-1999), ... '
  'L''ETL ne stocke que les tranches >= ''21'' (6+ salariés) pour cibler les '
  'entreprises susceptibles d''obligation BEGES (>= 250 salariés en pratique).';

COMMENT ON COLUMN public.sirene_cache.effectif_min IS
  'Borne basse de l''intervalle correspondant à la tranche_effectifs (calculée côté ETL).';

COMMENT ON COLUMN public.sirene_cache.effectif_max IS
  'Borne haute de l''intervalle correspondant à la tranche_effectifs (calculée côté ETL).';

COMMENT ON COLUMN public.sirene_cache.etat_administratif IS
  'État administratif INSEE : ''A'' = actif, ''F'' = fermé. L''ETL ne stocke que ''A''.';

COMMENT ON COLUMN public.sirene_cache.date_maj_insee IS
  'Date de dernière mise à jour de l''établissement côté INSEE (dateDernierTraitementEtablissement).';

COMMENT ON COLUMN public.sirene_cache.imported_at IS
  'Timestamp d''insertion dans le cache local (généré par l''ETL).';

COMMENT ON COLUMN public.sirene_cache.source_file IS
  'Nom du fichier bulk INSEE source (ex. StockEtablissement_utf8_202510.zip) — '
  'permet de tracer la fraîcheur des données et déclencher une re-import.';

-- ---------------------------------------------------------------------------
-- Index ciblés (filtres typiques du sourcing : NAF, tranche d'effectifs, code postal)
-- ---------------------------------------------------------------------------

-- Index NAF : filtre principal du sourcing (secteurs cibles user).
CREATE INDEX IF NOT EXISTS sirene_cache_naf_idx
  ON public.sirene_cache(activite_principale)
  WHERE etat_administratif = 'A';

-- Index tranche : filtre secondaire pour cibler les entreprises de taille pertinente.
CREATE INDEX IF NOT EXISTS sirene_cache_tranche_idx
  ON public.sirene_cache(tranche_effectifs)
  WHERE etat_administratif = 'A';

-- Index code postal : filtre géographique (user settings.codes_postaux).
CREATE INDEX IF NOT EXISTS sirene_cache_cp_idx
  ON public.sirene_cache(code_postal)
  WHERE etat_administratif = 'A';

-- ---------------------------------------------------------------------------
-- RLS — lecture publique, écriture service_role uniquement
-- ---------------------------------------------------------------------------

ALTER TABLE public.sirene_cache ENABLE ROW LEVEL SECURITY;

-- SELECT ouvert : tous les users authentifiés (et même anon, mais l'app n'a pas
-- de routes anon qui interrogent cette table) lisent le cache.
DROP POLICY IF EXISTS "sirene_cache_select_all" ON public.sirene_cache;
CREATE POLICY "sirene_cache_select_all"
  ON public.sirene_cache FOR SELECT
  USING (true);

-- Aucune policy INSERT/UPDATE/DELETE → seul le service_role peut écrire,
-- ce qui correspond exclusivement au script ETL `scripts/import-sirene-bulk.ts`.
-- Conforme à rules/security.md (service_role isolée côté serveur).

COMMIT;

-- =============================================================================
-- Fin de la migration 018_sirene_cache.sql
-- Pour appliquer : npx supabase db push
-- Après push     : npx supabase gen types typescript --linked > lib/supabase/database.types.ts
-- =============================================================================
