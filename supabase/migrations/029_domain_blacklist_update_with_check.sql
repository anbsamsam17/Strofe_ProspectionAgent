-- =============================================================================
-- Migration : 029_domain_blacklist_update_with_check.sql
-- Projet    : ProspectionAgent (Glan) — Agent IA Prospection Bilan Carbone
-- Date      : 2026-06-23
-- Initiative: Durcissement RLS — ajout du WITH CHECK manquant sur la policy
--             UPDATE de domain_blacklist.
--
-- Contexte :
--   La table `domain_blacklist` (migration 021) est la seule table du projet
--   dont la policy UPDATE devie du standard 4-policies. Elle ne declare qu'une
--   clause `USING (auth.uid() = user_id)` sans `WITH CHECK`.
--
--   Consequence : la clause USING filtre bien les LIGNES qu'un utilisateur peut
--   modifier, mais l'absence de WITH CHECK n'empeche pas de reaffecter une
--   ligne a un autre `user_id` lors de l'UPDATE (la NOUVELLE valeur de la ligne
--   n'est pas validee). Sur les autres tables du projet, la policy UPDATE porte
--   toujours USING + WITH CHECK = auth.uid() = user_id
--   (cf. .claude/rules/security.md).
--
-- Correctif :
--   On recree la policy UPDATE a l'identique en lui ajoutant la clause
--   WITH CHECK (auth.uid() = user_id), pour aligner domain_blacklist sur le
--   standard. Le nom de la policy est conserve a l'identique de la 021.
--
-- Type de modification :
--   Migration ADDITIVE et idempotente : DROP POLICY IF EXISTS + CREATE POLICY.
--   N'altere ni la structure de table ni les donnees. Ne touche pas la
--   migration 021 (deja appliquee en prod).
--   Rejouable sans erreur.
--
-- Rollback :
--   Revenir au comportement 021 (USING seul, sans WITH CHECK) :
--     DROP POLICY IF EXISTS "Users can update their own blacklist"
--       ON public.domain_blacklist;
--     CREATE POLICY "Users can update their own blacklist"
--       ON public.domain_blacklist FOR UPDATE
--       USING (auth.uid() = user_id);
--
-- Cout operationnel : nul (recreation d'une policy, aucun scan de donnees).
-- =============================================================================

DROP POLICY IF EXISTS "Users can update their own blacklist" ON public.domain_blacklist;
CREATE POLICY "Users can update their own blacklist"
  ON public.domain_blacklist FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =============================================================================
-- Fin de la migration 029_domain_blacklist_update_with_check.sql
-- Pour appliquer : npx supabase db push
-- =============================================================================
