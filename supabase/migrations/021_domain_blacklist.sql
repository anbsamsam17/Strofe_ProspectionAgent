-- =============================================================================
-- Migration : 021_domain_blacklist.sql
-- Projet    : ProspectionAgent (Glan) — Agent IA Prospection Bilan Carbone
-- Date      : 2026-05-20
-- Ticket    : GLN-061
--
-- Contexte :
--   Un consultant blackliste systématiquement ses clients existants + ses
--   concurrents (Greenly, Sweep, Sami, Carbone 4, ECOACT, Toovalu, ...)
--   au niveau DOMAINE email, pas au niveau SIREN. Aujourd'hui il doit
--   marquer manuellement chaque prospect en `do_not_contact` (table
--   `opt_out` par SIREN), et chaque nouvelle filiale ou nouveau prospect
--   du même groupe doit être re-blacklisté manuellement.
--
-- Solution :
--   Une table `domain_blacklist(user_id, domain, reason)` qui matche par
--   domaine email. À chaque phase d'enrichissement contact, on vérifie
--   si l'un des emails associés à un prospect tombe dans un domaine
--   blacklisté → on bascule le prospect en `do_not_contact` + on ajoute
--   une note traçable.
--
-- RLS strict :
--   4 policies (SELECT/INSERT/UPDATE/DELETE), toutes filtrant par
--   auth.uid() = user_id (pattern projet — cf. .claude/rules/security.md).
--
-- Index :
--   - UNIQUE(user_id, domain) : pas de doublon par utilisateur ; le
--     même domaine peut exister sur deux comptes différents (cas
--     consultant indépendant + agence multi-users).
--   - idx_domain_blacklist_user_domain : lookup rapide par (user_id, domain)
--     lors de la phase d'enrichissement contact (peut être appelé
--     plusieurs centaines de fois par run).
--
-- Coût opérationnel : nul (CREATE TABLE + 4 policies + 1 index).
-- Idempotent : rejouable sans erreur (IF NOT EXISTS partout).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.domain_blacklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, domain)
);

ALTER TABLE public.domain_blacklist ENABLE ROW LEVEL SECURITY;

-- Policies RLS — 4 policies S/I/U/D avec auth.uid() = user_id.
-- Pattern strictement identique aux autres tables du projet.
DROP POLICY IF EXISTS "Users can view their own blacklist" ON public.domain_blacklist;
CREATE POLICY "Users can view their own blacklist"
  ON public.domain_blacklist FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert into their own blacklist" ON public.domain_blacklist;
CREATE POLICY "Users can insert into their own blacklist"
  ON public.domain_blacklist FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own blacklist" ON public.domain_blacklist;
CREATE POLICY "Users can update their own blacklist"
  ON public.domain_blacklist FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete from their own blacklist" ON public.domain_blacklist;
CREATE POLICY "Users can delete from their own blacklist"
  ON public.domain_blacklist FOR DELETE
  USING (auth.uid() = user_id);

-- Index sur (user_id, domain) — utilisé par la phase d'enrichissement
-- contact pour matcher rapidement un domaine email vs la blacklist du user.
CREATE INDEX IF NOT EXISTS idx_domain_blacklist_user_domain
  ON public.domain_blacklist(user_id, domain);

COMMENT ON TABLE public.domain_blacklist IS
  'Domaines email blacklistés par user (clients existants, concurrents). '
  'Tout prospect dont un contact a un email matchant un domaine ici est '
  'marqué statut do_not_contact lors de la phase d''enrichissement contact.';

COMMENT ON COLUMN public.domain_blacklist.domain IS
  'Domaine email normalisé en lowercase, sans @ (ex: greenly.earth). '
  'Validation côté API : regex /^[a-z0-9.-]+\.[a-z]{2,}$/i.';

COMMENT ON COLUMN public.domain_blacklist.reason IS
  'Raison libre saisie par l''utilisateur (ex: "Concurrent direct", '
  '"Client existant", "Filiale de notre groupe").';

-- =============================================================================
-- Fin de la migration 021_domain_blacklist.sql
-- Pour appliquer : npx supabase db push
-- =============================================================================
