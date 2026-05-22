-- ============================================================
-- Migration 022 : prospects.first_contact_at
-- Ticket GLN-020 / GLN-003
--
-- Contexte juridique :
--   Référentiel CNIL prospection 2020 §3.2 + RGPD art. 14.
--   Quand les données du prospect sont collectées indirectement
--   (Hunter, Pappers, pattern email INPI, etc.), l'information
--   RGPD art. 14 doit être délivrée AU PLUS TARD lors de la
--   première communication. On persiste donc la date du tout
--   premier email envoyé par l'utilisateur depuis l'app : c'est
--   la preuve du déclenchement du compteur et l'évidence pour la
--   CNIL en cas de contrôle.
-- ============================================================

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ NULL;

-- Index partiel : on ne requête first_contact_at IS NOT NULL que
-- pour les audits / reporting. Reste léger en pages disque.
CREATE INDEX IF NOT EXISTS idx_prospects_first_contact
  ON public.prospects(user_id, first_contact_at)
  WHERE first_contact_at IS NOT NULL;

COMMENT ON COLUMN public.prospects.first_contact_at IS
  'Timestamp du PREMIER email envoyé au prospect — preuve délai information art. 14 RGPD (Référentiel CNIL prospection 2020).';
