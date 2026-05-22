-- =============================================================================
-- Migration : 028_status_to_contact.sql
-- Projet    : ProspectionAgent (Glan) — Agent IA Prospection Bilan Carbone
-- Date      : 2026-05-22
-- Initiative: Ajout du statut 'to_contact' dans le pipeline CRM.
--
-- Contexte :
--   Retour client Sprint 3 V3 #10. L'utilisateur veut un statut explicite
--   "A contacter" entre 'qualified' (qualifie technique : taille / BEGES OK)
--   et 'contacted' (au moins un appel/email). Sert d'amorce pour la routine
--   quotidienne — au lever, le consultant voit la file des prospects qu'il
--   a marques "a contacter aujourd'hui".
--
--   Distinct de 'qualified' :
--     - 'qualified' = sortie automatique du scoring (l'agent dit "ce
--       prospect est interessant").
--     - 'to_contact' = decision humaine ("je le contacte aujourd'hui /
--       cette semaine").
--
--   Ordre logique pipeline :
--     sourced -> qualified -> to_contact -> contacted -> interested
--     -> rdv -> offer_sent -> converted
--
-- Type de modification :
--   La colonne `prospects.statut` est typee via l'ENUM Postgres
--   `public.prospect_status`. Pattern strictement identique aux migrations
--   010 (offer_sent) et 017 (do_not_contact) : `ALTER TYPE ... ADD VALUE`.
--
-- Note Postgres :
--   - `ADD VALUE IF NOT EXISTS` fonctionne en transaction depuis PG 12
--     (Supabase tourne PG 15+ : OK).
--   - Idempotent : rejouable sans erreur.
--   - Forward-only : Postgres ne permet pas de retirer une valeur d'un ENUM
--     deja utilise.
--
-- Comportement cote application (implement en parallele de cette migration) :
--   - Auto-promotion (Sprint 3 V3 #9) : a l'insertion d'un echange
--     type IN ('appel','email','linkedin'), si statut courant IN
--     ('sourced','qualified','to_contact') -> UPDATE statut='contacted'.
--     Garde-fou non negociable : ne JAMAIS regresser un statut >= 'contacted'.
--   - UI : status-dropdown, kanban (nouvelle colonne entre Qualifie et
--     Contacte), filtres rapides (Agent 1 / batch A).
--
-- RLS : aucune modification — `prospects` conserve ses 4 policies.
-- Cout operationnel : nul (ALTER TYPE ADD VALUE est instantane, pas de scan).
-- =============================================================================

ALTER TYPE public.prospect_status ADD VALUE IF NOT EXISTS 'to_contact';

COMMENT ON TYPE public.prospect_status IS
  'Statut du prospect dans le pipeline CRM. Valeurs : '
  'sourced (source, non qualifie), '
  'qualified (qualifie par l''agent : taille/BEGES OK), '
  'to_contact (decision humaine — a contacter, amorce daily routine), '
  'contacted (au moins un appel/email/linkedin), '
  'interested (interesse apres echange), '
  'rdv (rendez-vous decroche, legacy — fusionne avec interested dans la nouvelle UI), '
  'offer_sent (offre/devis envoye, en attente de signature), '
  'converted (converti en client), '
  'rejected (disqualifie apres tentative — refus, non interesse), '
  'on_hold (en pause), '
  'do_not_contact (opt-out manuel utilisateur — jamais re-enrichi ni inclus '
  'dans les phases d''enrichissement de contact).';

-- =============================================================================
-- Fin de la migration 028_status_to_contact.sql
-- =============================================================================
