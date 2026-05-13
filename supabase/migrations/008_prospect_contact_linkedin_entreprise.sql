-- ============================================================
-- Migration 008 — LinkedIn page entreprise
-- Date : 2026-05-13
-- Contexte (F3 — feedback user) :
--   Beaucoup de prospects sortent SANS contact direct (téléphone direct,
--   email, ou LinkedIn dirigeant) et sont écartés du Top 15 par le filter
--   `hasContact` côté UI. Le user veut, en dernier recours, récupérer un
--   lien LinkedIn de PAGE ENTREPRISE (différent du LinkedIn dirigeant)
--   afin de pouvoir, manuellement via Sales Navigator, identifier un
--   contact pertinent côté humain.
--
--   On distingue volontairement deux colonnes :
--     - contact_linkedin              : profil LinkedIn d'une PERSONNE
--                                       (dirigeant nommé, source Pappers
--                                       ou Hunter). Représente "le bon
--                                       contact" identifié.
--     - contact_linkedin_entreprise   : URL de la PAGE ENTREPRISE LinkedIn
--                                       (linkedin.com/company/<slug>).
--                                       Fallback quand aucune personne
--                                       n'a été identifiée.
--
-- Source : construite par vanity URL depuis raison_sociale (slug-builder)
--          puis validée par HEAD HTTP côté serveur (`findLinkedinCompanyUrl`
--          dans lib/agent/linkedin-company.ts). LinkedIn refuse les calls
--          en rate-limit avec un HTTP 999 — dans ce cas on stocke NULL.
--
-- Sécurité :
--   - RLS existante (auth.uid() = user_id) couvre déjà la colonne.
--   - Pas de PII : URL publique.
-- ============================================================

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS contact_linkedin_entreprise TEXT NULL;

COMMENT ON COLUMN public.prospects.contact_linkedin_entreprise IS
  'URL LinkedIn de la PAGE ENTREPRISE (linkedin.com/company/<slug>). '
  'À ne pas confondre avec contact_linkedin (profil personnel d''un dirigeant). '
  'Construite via vanity URL depuis raison_sociale puis validée par HEAD HTTP. '
  'NULL si la page n''existe pas ou si LinkedIn renvoie 999 (rate-limit).';

-- =============================================================================
-- Fin de la migration 008_prospect_contact_linkedin_entreprise.sql
-- Pour appliquer : supabase db push
-- =============================================================================
