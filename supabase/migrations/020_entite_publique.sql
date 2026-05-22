-- ============================================================
-- Migration 020 : ENTITE PUBLIQUE (validite BEGES 3 ans / 4 ans)
-- Ticket GLN-005
--
-- Contexte juridique :
--   Article L229-25 du Code de l'environnement + Decret 2022-982.
--   La duree de validite du BEGES depend de la nature juridique :
--     - Personne morale de droit prive : 4 ans
--     - Personne morale de droit public : 3 ans
--
--   Detection via la categorie juridique INSEE (champ
--   categorieJuridiqueUniteLegale) :
--     - Categories 71xx (administrations d'Etat)
--     - Categories 72xx (collectivites territoriales)
--     - Categories 73xx (etablissements publics administratifs)
--     - Categories 74xx (autres personnes morales de droit public)
--   sont considerees comme entites publiques.
-- ============================================================

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS entite_publique BOOLEAN DEFAULT FALSE;

-- Index partiel : on requete les entites publiques uniquement quand le flag
-- est TRUE (cas minoritaire). Conditionnal index = moins de pages a scanner.
CREATE INDEX IF NOT EXISTS idx_prospects_entite_publique
  ON public.prospects(user_id, entite_publique)
  WHERE entite_publique = TRUE;

COMMENT ON COLUMN public.prospects.entite_publique IS
  'TRUE si personne morale de droit public (categorie juridique INSEE 71xx-74xx). Determine validite BEGES (3 ans vs 4 ans prive).';
