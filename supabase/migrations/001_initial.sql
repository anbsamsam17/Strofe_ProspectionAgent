-- =============================================================================
-- Migration : 001_initial.sql
-- Projet    : Agent IA - Prospection Bilan Carbone
-- Date      : 2026-04-05
-- Description: Schéma initial complet — profiles, prospects, daily_lists,
--              daily_list_items, agent_runs. RLS activé sur toutes les tables.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

-- pgcrypto pour gen_random_uuid() (disponible par défaut sur Supabase)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Fonction utilitaire : mise à jour automatique de updated_at
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS
  'Trigger function : met à jour la colonne updated_at à chaque UPDATE.';

-- =============================================================================
-- TABLE : profiles
-- Extension de auth.users — une ligne par utilisateur inscrit.
-- =============================================================================

CREATE TABLE public.profiles (
  -- Clé primaire == auth.users.id (UUID Supabase Auth)
  id              UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Email copié depuis auth.users pour simplifier les jointures (notifications)
  -- Mis à jour automatiquement via trigger handle_new_user
  email           TEXT,

  -- Identité de l'utilisateur
  full_name       TEXT,
  company_name    TEXT,
  avatar_url      TEXT,

  -- Paramètres métier de l'agent (stockés en JSONB pour flexibilité)
  -- Structure attendue (clés identiques à l'interface TS ProfileSettings) :
  --   {
  --     "target_sectors"      : ["62", "70", "71"],  -- codes NAF 2 chiffres
  --     "target_city"         : "Paris",
  --     "target_postal_codes" : ["75001", "69001"],
  --     "daily_call_target"   : 15,
  --     "notification_email"  : "contact@cabinet.fr",
  --     "offer_description"   : "Cabinet conseil bilan carbone..."
  --   }
  settings        JSONB       NOT NULL DEFAULT '{}'::JSONB,

  -- Statut de l'onboarding (false = l'utilisateur n'a pas encore configuré son profil)
  onboarded       BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.profiles IS
  'Profil utilisateur — extension de auth.users. '
  'Contient les paramètres métier de l''agent (secteurs cibles, ville, offre, etc.).';

COMMENT ON COLUMN public.profiles.settings IS
  'JSONB de configuration de l''agent (clés TS ProfileSettings) : '
  'target_sectors, target_city, target_postal_codes, daily_call_target, '
  'notification_email, offer_description.';

COMMENT ON COLUMN public.profiles.onboarded IS
  'Passe à TRUE quand l''utilisateur a complété l''étape d''onboarding (settings renseignés).';

-- Index sur onboarded pour filtrer rapidement les comptes non configurés
CREATE INDEX idx_profiles_onboarded ON public.profiles (onboarded);

-- Trigger updated_at
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — profiles
-- Un utilisateur ne voit et ne modifie que son propre profil.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles: lecture par le propriétaire"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles: insertion par le propriétaire"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles: mise à jour par le propriétaire"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles: suppression par le propriétaire"
  ON public.profiles FOR DELETE
  USING (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- Trigger : création automatique du profil à l'inscription
-- Se déclenche sur auth.users INSERT (appel Supabase Auth).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    -- Récupère le nom dans les metadata Supabase Auth si disponible
    COALESCE(NEW.raw_user_meta_data->>'full_name', NULL),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NULL)
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Crée automatiquement une ligne dans public.profiles '
  'à chaque inscription via Supabase Auth.';

CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- TABLE : prospects
-- Entreprises sourcées par l'agent (via API Sirene INSEE + enrichissement).
-- Isolation multi-tenant : UNIQUE(user_id, siren).
-- =============================================================================

-- Type ENUM pour le statut du pipeline
CREATE TYPE public.prospect_status AS ENUM (
  'sourced',      -- sourcé par l'agent, pas encore qualifié
  'qualified',    -- qualifié (score > seuil), prêt à être appelé
  'contacted',    -- au moins un appel passé
  'interested',   -- a montré de l'intérêt
  'rdv',          -- rendez-vous décroché
  'converted',    -- converti en client
  'rejected',     -- disqualifié définitivement
  'on_hold'       -- mis en attente temporaire
);

CREATE TABLE public.prospects (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- -------------------------------------------------------------------
  -- Identité légale (source : API Sirene INSEE)
  -- -------------------------------------------------------------------
  siren                   CHAR(9)       NOT NULL,
  siret                   CHAR(14),
  raison_sociale          TEXT          NOT NULL,

  -- Code NAF sur 5 caractères (ex: "7112B") et libellé humain
  secteur_naf             VARCHAR(6),
  secteur_libelle         TEXT,

  -- -------------------------------------------------------------------
  -- Taille de l'entreprise
  -- -------------------------------------------------------------------
  -- Tranche d'effectif (ex : 50–99 → effectif_min=50, effectif_max=99)
  effectif_min            INTEGER,
  effectif_max            INTEGER,

  -- -------------------------------------------------------------------
  -- Localisation
  -- -------------------------------------------------------------------
  ville                   TEXT,
  code_postal             VARCHAR(10),
  adresse                 TEXT,

  -- -------------------------------------------------------------------
  -- Contact (enrichi par l'agent via scraping / LinkedIn / annuaires)
  -- -------------------------------------------------------------------
  contact_nom             TEXT,
  contact_prenom          TEXT,
  contact_poste           TEXT,          -- ex: "Directeur RSE"
  contact_telephone       TEXT,
  contact_email           TEXT,
  contact_linkedin        TEXT,

  -- -------------------------------------------------------------------
  -- BEGES (Bilan des Émissions de Gaz à Effet de Serre)
  -- Source : API ADEME / base BEGES
  -- -------------------------------------------------------------------
  -- TRUE si l'entreprise a déjà publié un BEGES dans la base ADEME
  beges_publie            BOOLEAN       NOT NULL DEFAULT FALSE,
  beges_derniere_publication DATE,

  -- TRUE si l'entreprise est soumise à l'obligation légale de réaliser un BEGES
  -- (> 500 salariés en métropole, > 250 DOM-TOM — art. L229-25 Code Env.)
  obligation_beges        BOOLEAN       NOT NULL DEFAULT FALSE,

  -- -------------------------------------------------------------------
  -- Score de priorité (calculé par l'agent)
  -- -------------------------------------------------------------------
  -- Score composite 0–100 : plus il est élevé, plus le prospect est prioritaire
  score_priorite          SMALLINT      NOT NULL DEFAULT 0
                            CHECK (score_priorite BETWEEN 0 AND 100),

  -- Décomposition du score par critère (pour expliquer la priorisation)
  -- Structure attendue :
  --   {
  --     "effectif"     : 20,
  --     "beges"        : 30,
  --     "secteur"      : 25,
  --     "signaux"      : 15,
  --     "localisation" : 10
  --   }
  score_details           JSONB         NOT NULL DEFAULT '{}'::JSONB,

  -- -------------------------------------------------------------------
  -- Signaux détectés (articles presse, offres d'emploi RSE, etc.)
  -- -------------------------------------------------------------------
  -- Tableau JSONB de signaux :
  --   [{ "type": "offre_emploi_rse", "date": "2026-03-01", "url": "..." }]
  signaux                 JSONB         NOT NULL DEFAULT '[]'::JSONB,

  -- -------------------------------------------------------------------
  -- Statut pipeline CRM
  -- -------------------------------------------------------------------
  statut                  public.prospect_status NOT NULL DEFAULT 'sourced',

  -- -------------------------------------------------------------------
  -- Meta
  -- -------------------------------------------------------------------
  -- Origine de la donnée (ex: "sirene_api", "manual", "import_csv")
  source                  TEXT          NOT NULL DEFAULT 'sirene_api',

  -- Horodatage du dernier enrichissement des données de contact
  enriched_at             TIMESTAMPTZ,

  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Unicité : un même SIREN ne peut apparaître qu'une fois par utilisateur
  CONSTRAINT uq_prospects_user_siren UNIQUE (user_id, siren)
);

COMMENT ON TABLE public.prospects IS
  'Entreprises sourcées par l''agent. '
  'Isolation multi-tenant via UNIQUE(user_id, siren). '
  'Enrichissement progressif : identité (Sirene) → BEGES (ADEME) → contact → score.';

COMMENT ON COLUMN public.prospects.siren IS
  'Numéro SIREN à 9 chiffres — identifiant légal de l''entreprise (INSEE).';

COMMENT ON COLUMN public.prospects.score_priorite IS
  'Score composite 0-100. Plus élevé = plus prioritaire à appeler. '
  'Calculé par l''agent en fonction de l''effectif, statut BEGES, secteur, signaux.';

COMMENT ON COLUMN public.prospects.score_details IS
  'Décomposition du score par critère : effectif, beges, secteur, signaux, localisation.';

COMMENT ON COLUMN public.prospects.signaux IS
  'Tableau JSON de signaux d''achat détectés : offres emploi RSE, articles presse, '
  'levées de fonds, expansion géographique, etc.';

COMMENT ON COLUMN public.prospects.obligation_beges IS
  'Obligation légale de réaliser un BEGES (art. L229-25 Code Environnement) : '
  'entreprises > 500 salariés en métropole.';

COMMENT ON COLUMN public.prospects.statut IS
  'Statut dans le pipeline CRM : sourced → qualified → contacted → interested '
  '→ rdv → converted. Ou : rejected / on_hold.';

-- -------------------------------------------------------------------
-- Index — prospects
-- -------------------------------------------------------------------

-- Filtre principal : tous les prospects d'un user par statut
CREATE INDEX idx_prospects_user_statut
  ON public.prospects (user_id, statut);

-- Tri par score décroissant (sélection des meilleurs à appeler)
CREATE INDEX idx_prospects_user_score
  ON public.prospects (user_id, score_priorite DESC);

-- Recherche par SIREN au sein d'un tenant
CREATE INDEX idx_prospects_user_siren
  ON public.prospects (user_id, siren);

-- Filtre sur secteur NAF (pour les requêtes de l'agent)
CREATE INDEX idx_prospects_naf
  ON public.prospects (user_id, secteur_naf);

-- Filtre BEGES (détection des entreprises sans bilan récent)
CREATE INDEX idx_prospects_beges
  ON public.prospects (user_id, beges_publie, obligation_beges);

-- Trigger updated_at
CREATE TRIGGER trg_prospects_updated_at
  BEFORE UPDATE ON public.prospects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — prospects
-- ---------------------------------------------------------------------------

ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prospects: lecture par le propriétaire"
  ON public.prospects FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "prospects: insertion par le propriétaire"
  ON public.prospects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "prospects: mise à jour par le propriétaire"
  ON public.prospects FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "prospects: suppression par le propriétaire"
  ON public.prospects FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================================================
-- TABLE : daily_lists
-- Une liste de prospection par utilisateur par jour.
-- Générée chaque soir par le cron de l'agent.
-- =============================================================================

-- Statut de génération de la liste
CREATE TYPE public.daily_list_status AS ENUM (
  'pending',     -- en attente de génération (cron pas encore lancé)
  'generating',  -- cron en cours d'exécution
  'ready',       -- liste prête, l'humain peut commencer les appels
  'completed'    -- tous les appels de la journée ont été effectués
);

CREATE TABLE public.daily_lists (
  id            UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID                     NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Date de la journée d'appel (pas horodatage — une liste = un jour calendaire)
  date          DATE                     NOT NULL,

  status        public.daily_list_status NOT NULL DEFAULT 'pending',

  -- Horodatage de fin de génération (NULL tant que pending/generating)
  generated_at  TIMESTAMPTZ,

  -- Horodatage d'envoi de la notification email (NULL = pas encore notifié)
  -- Utilisé pour éviter le double envoi par le cron 7h30
  notified_at   TIMESTAMPTZ,

  created_at    TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ              NOT NULL DEFAULT NOW(),

  -- Un seul user ne peut avoir qu'une liste par jour
  CONSTRAINT uq_daily_lists_user_date UNIQUE (user_id, date)
);

COMMENT ON TABLE public.daily_lists IS
  'Liste de prospection quotidienne générée par l''agent chaque soir. '
  'Une ligne par utilisateur par jour. Les appels sont dans daily_list_items.';

COMMENT ON COLUMN public.daily_lists.date IS
  'Date calendaire de la session d''appels (format DATE, pas TIMESTAMPTZ).';

COMMENT ON COLUMN public.daily_lists.generated_at IS
  'Horodatage de fin de génération par l''agent. NULL si status = pending/generating.';

-- Index principal : récupération de la liste du jour pour un user
CREATE INDEX idx_daily_lists_user_date
  ON public.daily_lists (user_id, date DESC);

-- Index sur le statut (pour le cron — retrouver les listes en attente)
CREATE INDEX idx_daily_lists_status
  ON public.daily_lists (status)
  WHERE status IN ('pending', 'generating');

-- Trigger updated_at
CREATE TRIGGER trg_daily_lists_updated_at
  BEFORE UPDATE ON public.daily_lists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — daily_lists
-- ---------------------------------------------------------------------------

ALTER TABLE public.daily_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_lists: lecture par le propriétaire"
  ON public.daily_lists FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "daily_lists: insertion par le propriétaire"
  ON public.daily_lists FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "daily_lists: mise à jour par le propriétaire"
  ON public.daily_lists FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "daily_lists: suppression par le propriétaire"
  ON public.daily_lists FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================================================
-- TABLE : daily_list_items
-- Les 15 appels du jour — un item = un prospect à appeler avec son pitch.
-- =============================================================================

-- Type de contact visé chez le prospect
CREATE TYPE public.contact_type AS ENUM (
  'rse',   -- Responsable RSE / Développement Durable
  'daf',   -- Directeur Administratif et Financier
  'drh',   -- Directeur des Ressources Humaines
  'dg',    -- Directeur Général / PDG / CEO
  'autre'
);

-- Résultat de l'appel renseigné par l'humain après l'appel
CREATE TYPE public.call_result AS ENUM (
  'interested',     -- intéressé, veut en savoir plus
  'callback',       -- rappeler plus tard (date dans callback_date)
  'not_interested', -- pas intéressé
  'wrong_contact',  -- mauvais interlocuteur, chercher un autre contact
  'no_answer',      -- pas de réponse
  'voicemail'       -- messagerie vocale
);

-- Priorité relative de l'appel dans la liste du jour
CREATE TYPE public.call_priority AS ENUM (
  'haute',
  'normale',
  'basse'
);

CREATE TABLE public.daily_list_items (
  id                   UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Référence vers la liste du jour
  daily_list_id        UUID                  NOT NULL REFERENCES public.daily_lists(id) ON DELETE CASCADE,

  -- Dénormalisé pour simplifier les requêtes RLS (evite une jointure sur daily_lists)
  user_id              UUID                  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Le prospect à appeler
  prospect_id          UUID                  NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,

  -- -------------------------------------------------------------------
  -- Ordonnancement et priorité
  -- -------------------------------------------------------------------
  -- Position dans la liste (1 = premier à appeler, 15 = dernier)
  ordre                SMALLINT              NOT NULL
                         CHECK (ordre BETWEEN 1 AND 20),

  priorite             public.call_priority  NOT NULL DEFAULT 'normale',

  -- Plage horaire suggérée par l'agent (ex: "9h-11h", "Après 14h")
  meilleur_creneau     TEXT,

  -- -------------------------------------------------------------------
  -- Contenu généré par GPT-4o
  -- -------------------------------------------------------------------
  -- Phrase d'accroche courte (1-2 phrases, spécifique à ce prospect)
  accroche             TEXT,

  -- Pitch téléphonique complet (structuré : contexte, valeur, CTA)
  pitch                TEXT,

  -- -------------------------------------------------------------------
  -- Données de personnalisation
  -- -------------------------------------------------------------------
  -- Signaux spécifiques utilisés pour personnaliser ce pitch
  -- Sous-ensemble de prospects.signaux
  signaux_detectes     JSONB                 NOT NULL DEFAULT '[]'::JSONB,

  -- Paires objection → réponse préparées par l'agent
  -- [{ "objection": "Pas de budget", "reponse": "..." }]
  objections_reponses  JSONB                 NOT NULL DEFAULT '[]'::JSONB,

  -- Type de contact recommandé par l'agent pour ce prospect
  contact_type         public.contact_type   NOT NULL DEFAULT 'rse',

  -- -------------------------------------------------------------------
  -- Résultat de l'appel (renseigné par l'humain après l'appel)
  -- -------------------------------------------------------------------
  -- NULL = pas encore appelé
  call_result          public.call_result,

  -- Date de rappel si call_result = 'callback'
  callback_date        DATE,

  -- Notes libres de l'humain après l'appel
  call_notes           TEXT,

  -- Horodatage de l'appel effectif
  called_at            TIMESTAMPTZ,

  created_at           TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.daily_list_items IS
  'Les appels du jour — un item = un prospect à appeler avec pitch personnalisé. '
  'Généré par l''agent GPT-4o. L''humain renseigne call_result après chaque appel.';

COMMENT ON COLUMN public.daily_list_items.ordre IS
  'Position d''appel recommandée dans la journée (1 = priorité max). Max 20.';

COMMENT ON COLUMN public.daily_list_items.accroche IS
  'Phrase d''accroche courte générée par GPT-4o, spécifique à ce prospect '
  '(mention d''un signal détecté, contexte BEGES, etc.).';

COMMENT ON COLUMN public.daily_list_items.pitch IS
  'Script téléphonique complet : contexte entreprise, valeur ajoutée de l''offre, '
  'appel à l''action. Généré par GPT-4o avec les données du prospect.';

COMMENT ON COLUMN public.daily_list_items.signaux_detectes IS
  'Sous-ensemble de prospects.signaux utilisés pour personnaliser ce pitch.';

COMMENT ON COLUMN public.daily_list_items.objections_reponses IS
  'Paires objection/réponse préparées : [{"objection":"...","reponse":"..."}].';

COMMENT ON COLUMN public.daily_list_items.call_result IS
  'Résultat de l''appel renseigné par l''humain. NULL = pas encore appelé.';

COMMENT ON COLUMN public.daily_list_items.callback_date IS
  'Date de rappel planifiée si call_result = callback.';

COMMENT ON COLUMN public.daily_list_items.called_at IS
  'Horodatage exact de l''appel. Utilisé pour les stats de performance.';

-- -------------------------------------------------------------------
-- Index — daily_list_items
-- -------------------------------------------------------------------

-- Navigation principale : items d'une liste dans l'ordre d'appel
CREATE INDEX idx_daily_list_items_list_ordre
  ON public.daily_list_items (daily_list_id, ordre);

-- Accès par user (pour RLS + queries dashboard)
CREATE INDEX idx_daily_list_items_user
  ON public.daily_list_items (user_id);

-- Retrouver tous les items pour un prospect donné (historique des appels)
CREATE INDEX idx_daily_list_items_prospect
  ON public.daily_list_items (prospect_id);

-- Filtrer les callbacks planifiés
CREATE INDEX idx_daily_list_items_callbacks
  ON public.daily_list_items (user_id, callback_date)
  WHERE call_result = 'callback' AND callback_date IS NOT NULL;

-- Trigger updated_at
CREATE TRIGGER trg_daily_list_items_updated_at
  BEFORE UPDATE ON public.daily_list_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — daily_list_items
-- L'user_id est dénormalisé → RLS sans jointure coûteuse.
-- ---------------------------------------------------------------------------

ALTER TABLE public.daily_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_list_items: lecture par le propriétaire"
  ON public.daily_list_items FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "daily_list_items: insertion par le propriétaire"
  ON public.daily_list_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "daily_list_items: mise à jour par le propriétaire"
  ON public.daily_list_items FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "daily_list_items: suppression par le propriétaire"
  ON public.daily_list_items FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================================================
-- TABLE : agent_runs
-- Journal des exécutions nocturnes du cron agent (Vercel Cron Jobs).
-- =============================================================================

-- Statut global du run
CREATE TYPE public.agent_run_status AS ENUM (
  'running',    -- en cours d'exécution
  'completed',  -- terminé avec succès
  'failed'      -- terminé en erreur
);

CREATE TABLE public.agent_runs (
  id                   UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID                    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  status               public.agent_run_status NOT NULL DEFAULT 'running',

  -- Phase courante (pour le suivi temps réel côté dashboard)
  -- Ex: "sourcing_sirene", "scoring", "enrichissement_contact",
  --     "generation_pitch", "construction_liste"
  phase                TEXT,

  -- -------------------------------------------------------------------
  -- Compteurs de résultats
  -- -------------------------------------------------------------------
  -- Nombre d'entreprises récupérées via API Sirene
  prospects_sourced    INTEGER               NOT NULL DEFAULT 0,

  -- Nombre d'entreprises qualifiées après scoring (score > seuil)
  prospects_qualified  INTEGER               NOT NULL DEFAULT 0,

  -- TRUE si la daily_list a été générée avec succès
  list_generated       BOOLEAN               NOT NULL DEFAULT FALSE,

  -- -------------------------------------------------------------------
  -- Erreur éventuelle
  -- -------------------------------------------------------------------
  -- Message d'erreur si status = 'failed'
  error_message        TEXT,

  -- -------------------------------------------------------------------
  -- Logs structurés du run (pour audit et debug)
  -- -------------------------------------------------------------------
  -- Tableau chronologique d'événements :
  --   [{ "ts": "2026-04-05T22:00:01Z", "level": "info",
  --      "msg": "Sourcing Sirene démarré", "meta": {...} }]
  logs                 JSONB                 NOT NULL DEFAULT '[]'::JSONB,

  -- -------------------------------------------------------------------
  -- Timestamps
  -- -------------------------------------------------------------------
  started_at           TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ           -- NULL tant que running
);

COMMENT ON TABLE public.agent_runs IS
  'Historique des exécutions nocturnes de l''agent IA (cron Vercel). '
  'Utilisé pour le monitoring, le debug et l''audit trail.';

COMMENT ON COLUMN public.agent_runs.phase IS
  'Phase courante affichée en temps réel : sourcing_sirene, scoring, '
  'enrichissement_contact, generation_pitch, construction_liste.';

COMMENT ON COLUMN public.agent_runs.prospects_sourced IS
  'Nombre brut d''entreprises récupérées depuis l''API Sirene INSEE.';

COMMENT ON COLUMN public.agent_runs.prospects_qualified IS
  'Nombre d''entreprises ayant passé le filtre de scoring (score_priorite > seuil).';

COMMENT ON COLUMN public.agent_runs.logs IS
  'Tableau JSON horodaté d''événements. Chaque entrée : ts, level, msg, meta. '
  'Appendé au fil du run via UPDATE ... || jsonb_build_array(...).';

-- -------------------------------------------------------------------
-- Index — agent_runs
-- -------------------------------------------------------------------

-- Historique des runs d'un utilisateur, du plus récent au plus ancien
CREATE INDEX idx_agent_runs_user_started
  ON public.agent_runs (user_id, started_at DESC);

-- Retrouver les runs en cours (pour éviter les runs concurrents)
CREATE INDEX idx_agent_runs_running
  ON public.agent_runs (user_id, status)
  WHERE status = 'running';

-- ---------------------------------------------------------------------------
-- RLS — agent_runs
-- ---------------------------------------------------------------------------

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_runs: lecture par le propriétaire"
  ON public.agent_runs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "agent_runs: insertion par le propriétaire"
  ON public.agent_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "agent_runs: mise à jour par le propriétaire"
  ON public.agent_runs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "agent_runs: suppression par le propriétaire"
  ON public.agent_runs FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================================================
-- Fin de la migration 001_initial.sql
-- Pour appliquer : supabase db push
-- Pour vérifier  : supabase db diff
-- =============================================================================
