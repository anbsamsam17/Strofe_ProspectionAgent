-- =============================================================================
-- Migration : 017_do_not_contact_status.sql
-- Projet    : ProspectionAgent (Glan) — Agent IA Prospection Bilan Carbone
-- Date      : 2026-05-15
-- Initiative: Ajout du statut 'do_not_contact' dans le pipeline CRM.
--
-- Contexte :
--   L'utilisateur exprime explicitement, pour certains prospects, le souhait
--   de NE JAMAIS les contacter (RGPD opt-out manuel côté CRM, ciblage hors
--   scope commercial, sociétés en liquidation déjà identifiées, etc.).
--
--   Le statut existant 'rejected' couvre déjà le cas "tentative non aboutie /
--   pas intéressé après échange" — donc sémantiquement DIFFÉRENT de "ne
--   jamais contacter". On préfère un nouveau statut distinct pour :
--     1. Garder l'analytics fiable (taux de rejet ≠ opt-out manuel).
--     2. Filtrer ces prospects sur les phases enrichissement / pitch / sourcing
--        sans masquer les vrais 'rejected'.
--     3. Ne pas dégrader leur score_priorite (pas de pénalité supplémentaire).
--
-- Type de modification :
--   La colonne `prospects.statut` est typée via l'ENUM Postgres
--   `public.prospect_status` (cf. 001_initial.sql lignes 156-165 et migration
--   010_prospect_status_offer_sent.sql) — PAS via un CHECK constraint. On
--   utilise donc `ALTER TYPE ... ADD VALUE`, pattern strictement identique
--   à la migration 010.
--
-- Note Postgres :
--   - `ADD VALUE IF NOT EXISTS` fonctionne en transaction depuis PG 12 (Supabase
--     tourne PG 15+ : OK).
--   - Idempotent : rejouable sans erreur.
--   - Forward-only : Postgres ne permet pas de retirer une valeur d'un ENUM
--     déjà utilisé. Si rollback nécessaire → migration de remplacement
--     (CREATE TYPE new + ALTER COLUMN + DROP TYPE old).
--
-- Comportement côté application (à implémenter en parallèle de cette migration) :
--   - `lib/agent/orchestrator.ts` :: phaseContactEnrichment → SELECT
--     `.neq('statut', 'do_not_contact').neq('statut', 'rejected')` afin de
--     n'allouer aucun crédit Pappers/Hunter sur ces prospects.
--   - `lib/agent/sourcing-runner.ts` :: l'upsert `onConflict: 'user_id,siren'`
--     doit préserver le statut existant si la ligne est déjà en
--     `do_not_contact` (idempotence + respect du choix utilisateur).
--   - UI : nouvelle colonne Kanban "Ne pas contacter" couleur slate (distincte
--     du red 'rejected'), option dans status-dropdown et prospects-filters.
--
-- RLS : aucune modification — `prospects` conserve ses 4 policies (cf.
-- 001_initial.sql, scope `auth.uid() = user_id`).
--
-- Coût opérationnel : nul (ALTER TYPE ADD VALUE est instantané, pas de scan).
-- =============================================================================

ALTER TYPE public.prospect_status ADD VALUE IF NOT EXISTS 'do_not_contact';

COMMENT ON TYPE public.prospect_status IS
  'Statut du prospect dans le pipeline CRM. Valeurs : '
  'sourced (sourcé, non qualifié), '
  'qualified (qualifié, prêt à appeler), '
  'contacted (au moins un appel), '
  'interested (intéressé), '
  'rdv (rendez-vous décroché, legacy — n''est plus affiché dans le nouveau Kanban), '
  'offer_sent (offre/devis envoyé, en attente de signature), '
  'converted (converti en client), '
  'rejected (disqualifié après tentative — refus, non intéressé), '
  'on_hold (en pause), '
  'do_not_contact (opt-out manuel utilisateur — jamais ré-enrichi ni inclus '
  'dans la daily list ni dans les phases d''enrichissement de contact).';

-- =============================================================================
-- Fin de la migration 017_do_not_contact_status.sql
-- Pour appliquer : npx supabase db push
-- =============================================================================
