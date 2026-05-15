-- =============================================================================
-- Migration : 015_enrichment_v2.sql
-- Projet    : ProspectionAgent (Glan) — Agent IA Prospection Bilan Carbone
-- Date      : 2026-05-15
-- Initiative: Enrichissement contacts v2 — multi-sources cascade + quotas + opt-out.
--
-- Contexte :
--   La v1 (migrations 011, 008) enrichit un contact "best-effort" sans tracer
--   la qualité de l'email (catchall vs verified), sans gérer les quotas par
--   provider (Pappers/Hunter/INPI/Google CSE), sans opt-out RGPD.
--
--   La v2 introduit :
--     - Qualité email (status, confidence, verified_at, source_chain)
--     - Mesure de complétude par prospect (contact_completeness 0-100)
--     - Tiering hot/cold (BEGES obligation + non publié = hot)
--     - Détection péremption contact via BODACC (contact_outdated_at)
--     - Quotas API mensuels par user/provider (api_quotas)
--     - Opt-out RGPD par siren ou email (opt_out)
--
--   Sécurité : RLS strict auth.uid() = user_id sur api_quotas et opt_out
--   (4 policies S/I/U/D chacune). prospect_contacts et prospects héritent de
--   leurs policies existantes (001_initial.sql + 011_prospect_contacts.sql).
--
-- Invariants RLS attendus :
--   - api_quotas : un user ne voit/modifie que ses propres quotas.
--   - opt_out    : un user ne voit/modifie que ses propres opt-outs.
--   - Colonnes ajoutées sur prospects / prospect_contacts héritent du scope user_id.
--
-- Risques :
--   - Downtime : nul. Toutes les ALTER sont ADD COLUMN IF NOT EXISTS (non bloquant).
--   - FK cascading : ON DELETE CASCADE depuis auth.users (cohérent avec le reste).
--   - Pas de DROP, pas de modification destructive — migration purement additive.
--
-- Idempotence : IF NOT EXISTS partout, DROP POLICY IF EXISTS avant CREATE POLICY.
--
-- TODO regen types après push :
--   npx supabase gen types typescript --linked > lib/supabase/database.types.ts
--
-- Rollback (non automatisé) :
--   DROP TABLE IF EXISTS public.opt_out CASCADE;
--   DROP TABLE IF EXISTS public.api_quotas CASCADE;
--   ALTER TABLE public.prospects
--     DROP COLUMN IF EXISTS contact_completeness,
--     DROP COLUMN IF EXISTS contact_tier,
--     DROP COLUMN IF EXISTS last_enrichment_run_at,
--     DROP COLUMN IF EXISTS contact_source_origin,
--     DROP COLUMN IF EXISTS contact_outdated_at;
--   ALTER TABLE public.prospect_contacts
--     DROP COLUMN IF EXISTS email_status,
--     DROP COLUMN IF EXISTS email_confidence,
--     DROP COLUMN IF EXISTS email_verified_at,
--     DROP COLUMN IF EXISTS source_chain,
--     DROP COLUMN IF EXISTS last_enriched_at,
--     DROP COLUMN IF EXISTS email_is_pro;
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extension prospect_contacts — qualité email + traçabilité enrichissement
-- ---------------------------------------------------------------------------

ALTER TABLE public.prospect_contacts
  ADD COLUMN IF NOT EXISTS email_status TEXT
    CHECK (email_status IN ('valid', 'catchall', 'invalid', 'unknown', 'pattern_unverified'));

ALTER TABLE public.prospect_contacts
  ADD COLUMN IF NOT EXISTS email_confidence SMALLINT
    CHECK (email_confidence BETWEEN 0 AND 100);

ALTER TABLE public.prospect_contacts
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

ALTER TABLE public.prospect_contacts
  ADD COLUMN IF NOT EXISTS source_chain JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.prospect_contacts
  ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;

ALTER TABLE public.prospect_contacts
  ADD COLUMN IF NOT EXISTS email_is_pro BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.prospect_contacts.email_status IS
  'Statut de vérification email : valid (SMTP OK), catchall (domaine accepte tout), '
  'invalid (SMTP refusé), unknown (vérif impossible), pattern_unverified (inféré par pattern Hunter sans vérif).';

COMMENT ON COLUMN public.prospect_contacts.email_confidence IS
  'Score de confiance 0-100 sur la validité de l''email (issu de Hunter verifier ou pattern).';

COMMENT ON COLUMN public.prospect_contacts.email_verified_at IS
  'Timestamp de la dernière vérification SMTP/Hunter de l''email.';

COMMENT ON COLUMN public.prospect_contacts.source_chain IS
  'Historique JSONB des sources utilisées dans la cascade d''enrichissement : '
  '[{ source: "re|inpi|bodacc|pappers|hunter-pattern|pattern|manual", at: ISO8601, result: "hit|miss" }]. '
  'Append-only côté app, utile au debug et à l''audit du pipeline.';

COMMENT ON COLUMN public.prospect_contacts.last_enriched_at IS
  'Timestamp de la dernière passe d''enrichissement (toutes sources confondues).';

COMMENT ON COLUMN public.prospect_contacts.email_is_pro IS
  'FALSE si le domaine de l''email est grand public (gmail.com, yahoo.fr, hotmail.com, etc.). '
  'Détection côté app via blocklist de domaines free-mail.';

-- Index sur emails utilisables (valid ou catchall) — filtre fréquent côté UI/agent.
CREATE INDEX IF NOT EXISTS prospect_contacts_email_status_idx
  ON public.prospect_contacts(prospect_id, email_status)
  WHERE email_status IN ('valid', 'catchall');

-- ---------------------------------------------------------------------------
-- 2. Extension prospects — complétude, tier, péremption contact
-- ---------------------------------------------------------------------------

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS contact_completeness SMALLINT
    CHECK (contact_completeness BETWEEN 0 AND 100);

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS contact_tier TEXT
    CHECK (contact_tier IN ('hot', 'cold'));

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS last_enrichment_run_at TIMESTAMPTZ;

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS contact_source_origin TEXT
    CHECK (contact_source_origin IN ('re', 'inpi', 'bodacc', 'pappers', 'hunter-pattern', 'pattern', 'manual'));

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS contact_outdated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.prospects.contact_completeness IS
  'Pourcentage 0-100 de canaux contact remplis sur le contact primaire : '
  'email = 33, telephone = 33, linkedin = 33 + 1 bonus de symétrie. '
  'Calculé côté app à chaque mise à jour de contact.';

COMMENT ON COLUMN public.prospects.contact_tier IS
  'Tier commercial : hot = entreprise soumise à obligation BEGES ET non encore publiée '
  '(opportunité forte), cold = autres cas. Recalculé côté agent.';

COMMENT ON COLUMN public.prospects.last_enrichment_run_at IS
  'Timestamp de la dernière passe d''enrichissement orchestrée par l''agent sur ce prospect.';

COMMENT ON COLUMN public.prospects.contact_source_origin IS
  'Source primaire ayant fourni le contact : re (Recherche Entreprises), inpi, bodacc, '
  'pappers, hunter-pattern, pattern (inférence sans vérif), manual (saisi user).';

COMMENT ON COLUMN public.prospects.contact_outdated_at IS
  'Marqué par le watcher BODACC quand un changement de dirigeant est détecté. '
  'Indique que le contact en base est probablement périmé et doit être re-enrichi.';

-- Index pour tri/filtre complétude (UI : prospects par % de contact rempli).
CREATE INDEX IF NOT EXISTS prospects_completeness_idx
  ON public.prospects(user_id, contact_completeness)
  WHERE archived_at IS NULL;

-- Index pour lister rapidement les prospects à re-enrichir (péremption détectée).
CREATE INDEX IF NOT EXISTS prospects_outdated_idx
  ON public.prospects(user_id)
  WHERE contact_outdated_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Table api_quotas — suivi mensuel des appels par user/provider
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.api_quotas (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider     TEXT         NOT NULL
                 CHECK (provider IN ('pappers', 'hunter', 'inpi', 'google_cse')),
  used_count   INTEGER      NOT NULL DEFAULT 0,
  limit_count  INTEGER      NOT NULL,
  month_start  DATE         NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider, month_start)
);

COMMENT ON TABLE public.api_quotas IS
  'Suivi mensuel des appels API par user et provider externe (Pappers, Hunter, INPI, Google CSE). '
  'Une ligne par (user_id, provider, month_start). used_count incrémenté côté agent à chaque appel ; '
  'limit_count = plafond mensuel négocié (issu du plan tarifaire provider). '
  'Sert au throttling pré-call et à l''alerting de fin de quota.';

COMMENT ON COLUMN public.api_quotas.provider IS
  'Provider externe : pappers, hunter, inpi, google_cse. Whitelist alignée sur rules/security.md (SSRF).';

COMMENT ON COLUMN public.api_quotas.month_start IS
  'Premier jour du mois civil de référence (ex: 2026-05-01). Permet de séparer les compteurs mensuels.';

CREATE INDEX IF NOT EXISTS api_quotas_lookup_idx
  ON public.api_quotas(user_id, provider, month_start);

-- Trigger updated_at (réutilise public.set_updated_at de 001_initial.sql).
DROP TRIGGER IF EXISTS trg_api_quotas_updated_at ON public.api_quotas;
CREATE TRIGGER trg_api_quotas_updated_at
  BEFORE UPDATE ON public.api_quotas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS api_quotas — 4 policies strictes auth.uid() = user_id
ALTER TABLE public.api_quotas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_quotas_select_own" ON public.api_quotas;
CREATE POLICY "api_quotas_select_own"
  ON public.api_quotas FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "api_quotas_insert_own" ON public.api_quotas;
CREATE POLICY "api_quotas_insert_own"
  ON public.api_quotas FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "api_quotas_update_own" ON public.api_quotas;
CREATE POLICY "api_quotas_update_own"
  ON public.api_quotas FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "api_quotas_delete_own" ON public.api_quotas;
CREATE POLICY "api_quotas_delete_own"
  ON public.api_quotas FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. Table opt_out — opt-out RGPD par siren ou email
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.opt_out (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  siren       TEXT,
  email       TEXT,
  reason      TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CHECK (siren IS NOT NULL OR email IS NOT NULL)
);

COMMENT ON TABLE public.opt_out IS
  'Liste d''opt-out RGPD : entreprises (par SIREN) ou personnes (par email) qui ne doivent '
  'plus être contactées par cet user. Vérifié à chaque génération de liste / pitch côté agent. '
  'Au moins l''un de siren ou email doit être renseigné (CHECK constraint).';

COMMENT ON COLUMN public.opt_out.siren IS
  'SIREN 9 chiffres de l''entreprise à exclure (NULL si opt-out individuel par email).';

COMMENT ON COLUMN public.opt_out.email IS
  'Email de la personne à exclure (NULL si opt-out entreprise). Comparaison case-insensitive via index.';

COMMENT ON COLUMN public.opt_out.reason IS
  'Raison libre de l''opt-out (ex: "demande user explicite", "réponse négative ferme").';

-- Index partiels : un seul filtre est utilisé selon le canal d'opt-out.
CREATE INDEX IF NOT EXISTS opt_out_user_siren_idx
  ON public.opt_out(user_id, siren)
  WHERE siren IS NOT NULL;

CREATE INDEX IF NOT EXISTS opt_out_user_email_idx
  ON public.opt_out(user_id, lower(email))
  WHERE email IS NOT NULL;

-- RLS opt_out — 4 policies strictes auth.uid() = user_id
ALTER TABLE public.opt_out ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "opt_out_select_own" ON public.opt_out;
CREATE POLICY "opt_out_select_own"
  ON public.opt_out FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "opt_out_insert_own" ON public.opt_out;
CREATE POLICY "opt_out_insert_own"
  ON public.opt_out FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "opt_out_update_own" ON public.opt_out;
CREATE POLICY "opt_out_update_own"
  ON public.opt_out FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "opt_out_delete_own" ON public.opt_out;
CREATE POLICY "opt_out_delete_own"
  ON public.opt_out FOR DELETE
  USING (auth.uid() = user_id);

COMMIT;

-- =============================================================================
-- Fin de la migration 015_enrichment_v2.sql
-- Pour appliquer : supabase db push
-- Après push     : npx supabase gen types typescript --linked > lib/supabase/database.types.ts
-- =============================================================================
