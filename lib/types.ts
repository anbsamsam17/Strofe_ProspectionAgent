// ============================================================
// TYPES CENTRALISÉS — Agent IA Prospection Bilan Carbone
// ============================================================

// ------------------------------------------------------------
// ENUMS
// ------------------------------------------------------------

export type ProspectStatus =
  | 'sourced'
  | 'qualified'
  | 'contacted'
  | 'interested'
  /** Legacy — conservé pour rétrocompat, n'est plus affiché dans le nouveau Kanban. */
  | 'rdv'
  /** NEW (migration 010) : offre/devis envoyé, en attente de signature. */
  | 'offer_sent'
  | 'converted'
  | 'rejected'
  | 'on_hold'
  /**
   * NEW (migration 017) : opt-out manuel utilisateur — sémantique "ne jamais
   * contacter". DIFFÉRENT de `rejected` (tentative non aboutie). Les prospects
   * en `do_not_contact` sont exclus des phases d'enrichissement contact et de
   * la daily list. Le statut est préservé par l'upsert du sourcing (idempotence).
   * TODO(types): régénérer lib/supabase/database.types.ts après application en DB :
   *   `npx supabase gen types typescript --project-id <id> > lib/supabase/database.types.ts`
   */
  | 'do_not_contact'

export type CallResult =
  | 'interested'
  | 'callback'
  | 'not_interested'
  | 'wrong_contact'
  | 'no_answer'
  | 'voicemail'
  | 'email_sent'
  | 'no_contact_point'

/**
 * Priorité qualitative — valeurs canoniques de la refonte UI (migration 009).
 * Utilisée par `Prospect.priorite` (édition manuelle utilisateur) et par
 * `determinerPriorite()` dans `lib/agent/scoring.ts`.
 */
export type Priority = 'haute' | 'moyenne' | 'basse'

/**
 * Alias explicite de `Priority` utilisé par les composants UI d'édition manuelle
 * (`<PriorityDropdown>`).
 */
export type ManualPriority = Priority

export type AgentRunStatus = 'running' | 'completed' | 'failed'

export type ContactType = 'rse' | 'daf' | 'drh' | 'dg' | 'autre'

// ------------------------------------------------------------
// MODÈLES DB
// ------------------------------------------------------------

export interface Profile {
  id: string
  /** Copié depuis auth.users.email via trigger handle_new_user */
  email: string | null
  full_name?: string
  company_name?: string
  avatar_url?: string
  settings: ProfileSettings
  onboarded: boolean
  created_at: string
  updated_at: string
}

export interface ProfileSettings {
  target_sectors?: string[]
  target_city?: string
  target_postal_codes?: string[]
  /**
   * Cible de sourcing par run (ex. 15 → targetCandidates = max(45, 50)).
   * Renommé de `daily_call_target` post-pivot 2026-05-15 (migration 014).
   */
  sourcing_target_per_run: number
  notification_email?: string
  offer_description?: string
  /**
   * Pondération des 3 piliers de scoring (somme attendue = 100).
   * Défauts 30/30/40 (taille/BEGES/contact) — voir lib/agent/scoring.ts.
   * Normalisée systématiquement à l'usage (re-projection si user fournit 25/25/25).
   */
  scoring_weights?: ScoringWeights
}

/**
 * Pondération des piliers de scoring (taille, BEGES, contact).
 * Somme attendue = 100 après normalisation par `normalizeScoringWeights`.
 */
export interface ScoringWeights {
  taille: number
  beges: number
  contact: number
}

export interface Prospect {
  id: string
  user_id: string
  siren: string
  siret?: string
  raison_sociale: string
  secteur_naf?: string
  secteur_libelle?: string
  effectif_min?: number
  effectif_max?: number
  ville?: string
  code_postal?: string
  adresse?: string
  contact_nom?: string
  contact_prenom?: string
  contact_poste?: string
  contact_telephone?: string
  contact_email?: string
  contact_linkedin?: string
  /**
   * URL LinkedIn de la PAGE ENTREPRISE (linkedin.com/company/<slug>).
   * Distinct de `contact_linkedin` qui pointe vers un profil personnel.
   * Renseigné en dernier recours par l'étape post-cascade
   * (`lib/agent/linkedin-company.ts`) quand aucun contact direct n'a été
   * trouvé — sert au consultant pour rebondir manuellement via Sales Navigator.
   */
  contact_linkedin_entreprise?: string
  beges_publie: boolean
  beges_derniere_publication?: string
  /**
   * URL directe vers la fiche BEGES sur bilans-ges.ademe.fr.
   *
   * Format canonique : `https://bilans-ges.ademe.fr/bilans/<UUID>` où `<UUID>` est
   * l'identifiant `id` du record renvoyé par l'API ADEME Data Fair
   * (`https://data.ademe.fr/data-fair/api/v1/datasets/bilan-ges/lines`).
   *
   * Rempli par `verifierBegesAdeme()` lors de la phase d'enrichissement ADEME
   * (cf. `lib/agent/sourcing.ts` — recherche `qs=siren_principal:<siren>` pour
   * éviter les faux positifs full-text qui pointaient sur un autre BEGES).
   *
   * Si non rempli ou non exploitable, `buildBegesUrl()` (`lib/utils/beges-url.ts`)
   * tombe sur un fallback recherche `bilans-ges.ademe.fr/bilans?q=<siren>`.
   */
  beges_url?: string
  /** true si le BEGES a moins de 4 ans (obligation renouvellement quadriennal) */
  beges_valide?: boolean
  obligation_beges: boolean
  score_priorite: number
  score_details: ScoreDetails
  signaux: IntentionSignal[]
  statut: ProspectStatus
  /**
   * Priorité qualitative éditable manuellement par l'utilisateur (migration 009).
   * Distincte de `score_priorite` (calculé). Défaut DB : `'moyenne'`, backfill
   * initial dérivé de `score_priorite` (≥60 → haute, ≥30 → moyenne, sinon basse).
   *
   * Optionnel côté TS pour rester compatible avec les fixtures de tests
   * pré-migration et les select() partiels.
   */
  priorite?: Priority
  source: string
  enriched_at?: string
  /** Horodatage de mise en archive — NULL/undefined = prospect actif. */
  archived_at?: string
  /** Notes libres CRM saisies par l'utilisateur. */
  notes?: string
  // ── Scoring complémentaire Gemini (migration 014 — Agent N3) ─────────────
  /**
   * Score d'intérêt commercial qualitatif calculé par Gemini (0-100).
   * Complémentaire de `score_priorite` (composite quantifié taille/BEGES/contact).
   * `undefined` (Row=null) si le prospect n'a pas encore été scoré par Gemini.
   */
  gemini_score?: number
  /**
   * Raisons commerciales spécifiques générées par Gemini (3-5 items, texte libre).
   * Exploitables tels quels par le pitch — chaque entrée est une accroche
   * actionnable, pas un score interne.
   */
  gemini_raisons?: string[]
  /** Horodatage ISO 8601 de la dernière génération Gemini pour ce prospect. */
  gemini_generated_at?: string
  created_at: string
  updated_at: string
}

/**
 * Décomposition du score composite par pilier (0-100 avant pondération).
 *
 * Refonte 2026-05-14 — voir lib/agent/scoring.ts pour la logique de calcul.
 *
 * Les 3 piliers sont des sous-scores indépendants 0-100. Le score final
 * (0-100) résulte de leur somme pondérée par `weights` (somme=100).
 * Les pénalités déjà-contacté et rejeté sont appliquées hors piliers.
 */
export interface ScoreDetails {
  // ── Refonte 3 piliers (NEW — calculés par lib/agent/scoring.ts) ───────────
  /** Sous-score taille (effectif salarié) — 0-100 avant pondération. */
  taille: number
  /** Sous-score BEGES (infraction L. 229-25 / expiré / anticipation) — 0-100. */
  beges: number
  /** Sous-score contact (téléphone > email > LinkedIn) — 0-100. */
  contact: number
  /** Pondération effectivement appliquée (somme = 100 après normalisation). */
  weights: ScoringWeights
  /** Pénalité si prospect déjà contacté (-20 ou 0). */
  deja_contacte_penalty: number
  /** Pénalité si prospect statut=rejected (-50 ou 0). */
  rejete_penalty: number

  // ── Champs LEGACY — rétrocompat UI page détail prospect (Agent D refactorera) ─
  /** @deprecated absorbé dans `beges`. Conservé pour les lignes pré-migration. */
  obligation_beges?: number
  /** @deprecated absorbé dans `beges` / `contact`. */
  secteur_prioritaire?: number
  /** @deprecated remplacé par `beges`. */
  beges_non_publie?: number
  /** @deprecated remplacé par `beges`. */
  beges_expire?: number
  /** @deprecated retiré du nouveau scoring 3 piliers. */
  signaux_intention?: number
  /** @deprecated remplacé par `taille`. */
  taille_entreprise?: number
  /** @deprecated remplacé par `contact`. */
  contact_trouve?: number
  /** @deprecated absorbé dans `beges`. */
  secteur_beges_mature?: number
  /** @deprecated remplacé par `beges`. */
  bonus_infraction_legale?: number
  /** @deprecated remplacé par `deja_contacte_penalty`. */
  penalite_deja_contacte?: number
  /** @deprecated remplacé par `rejete_penalty`. */
  penalite_rejete?: number
}

/**
 * Ancienne forme de `ScoreDetails` (avant refonte 2026-05-14). Conservée comme
 * alias pour le code applicatif qui en dépend encore (page détail prospect).
 * Sera retirée après refonte par Agent D.
 */
export interface LegacyScoreDetails {
  obligation_beges: number
  secteur_prioritaire: number
  beges_non_publie: number
  beges_expire: number
  signaux_intention: number
  taille_entreprise: number
  contact_trouve: number
  secteur_beges_mature: number
  bonus_infraction_legale: number
  penalite_deja_contacte: number
  penalite_rejete: number
}

export interface IntentionSignal {
  type: 'job_posting' | 'sustainability_report_missing' | 'press_release' | 'certification' | 'event'
  description: string
  date?: string
  url?: string
  weight: number
}

// DailyList et DailyListItem supprimés post-pivot 2026-05-15
// (tables daily_lists et daily_list_items droppées — migration 014).

export interface ObjectionReponse {
  objection: string
  reponse: string
}

export interface AgentRun {
  id: string
  user_id: string
  status: AgentRunStatus
  phase?: string
  prospects_sourced: number
  prospects_qualified: number
  list_generated: boolean
  error_message?: string
  logs: AgentLog[]
  started_at: string
  completed_at?: string
}

export interface AgentLog {
  timestamp: string
  phase: string
  message: string
  level: 'info' | 'warn' | 'error'
  data?: Record<string, unknown>
}

// ------------------------------------------------------------
// API SIRENE (INSEE)
// ------------------------------------------------------------

export interface SireneEtablissement {
  siret: string
  siren: string
  denominationUniteLegale?: string
  denominationUsuelle1UniteLegale?: string
  nomUniteLegale?: string
  prenomUsuelUniteLegale?: string
  codePostalEtablissement?: string
  libelleCommuneEtablissement?: string
  activitePrincipaleEtablissement?: string
  nomenclatureActivitePrincipaleEtablissement?: string
  trancheEffectifsEtablissement?: string
  anneeEffectifsEtablissement?: string
  adresseEtablissement?: {
    numeroVoieEtablissement?: string
    typeVoieEtablissement?: string
    libelleVoieEtablissement?: string
    codePostalEtablissement?: string
    libelleCommuneEtablissement?: string
  }
  etatAdministratifEtablissement?: string
}

/**
 * Header retourné par l'API Sirene INSEE v3.11.
 * Depuis 2024, l'INSEE expose la pagination par CURSEUR (`curseur` / `curseurSuivant`).
 * Les champs legacy `debut` / `nombre` (offset pagination) restent renvoyés mais ne
 * doivent plus être utilisés pour piloter la pagination — voir `sourcerEntreprises`.
 */
export interface SireneHeader {
  statut: number
  message: string
  total: number
  /** Legacy offset (pagination par `debut`). Conservé pour rétrocompat. */
  debut?: number
  /** Legacy taille de page. Conservé pour rétrocompat. */
  nombre?: number
  /** Curseur courant (envoyé dans la requête). `*` pour la première page. */
  curseur?: string
  /** Curseur à passer à la requête suivante. Si égal au curseur courant → fin. */
  curseurSuivant?: string
}

export interface SireneResponse {
  header: SireneHeader
  etablissements: SireneEtablissement[]
}

// ------------------------------------------------------------
// API ADEME (BEGES)
// ------------------------------------------------------------

export interface AdemeBeges {
  siren: string
  raison_sociale: string
  annee_reporting: number
  statut_publication: string
  url_bilan?: string
  date_publication?: string
}

// ------------------------------------------------------------
// PITCH GÉNÉRÉ PAR CLAUDE
// ------------------------------------------------------------

export interface GeneratedPitch {
  accroche: string
  pitch: string
  signaux_detectes: string[]
  objections: ObjectionReponse[]
  meilleur_creneau: string
  contact_type: ContactType
  ton: string
}

// ------------------------------------------------------------
// API RESPONSES
// ------------------------------------------------------------

export interface ApiSuccess<T> {
  data: T
  message?: string
}

export interface ApiError {
  error: string
  code?: string
  details?: unknown
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

// ------------------------------------------------------------
// CONSTANTES PARTAGÉES
// ------------------------------------------------------------

/**
 * Pondération par défaut des 3 piliers de scoring (somme = 100).
 * Surchargeable via `profile.settings.scoring_weights`.
 *
 * Choix 2026-05-14 :
 *   - Contact 40 % : sans canal direct, pas de conversion.
 *   - Taille 30 % et BEGES 30 % : à parité (obligation potentielle / effective).
 */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  taille: 30,
  beges: 30,
  contact: 40,
}

// ------------------------------------------------------------
// MULTI-CONTACTS (migration 011_prospect_contacts)
// ------------------------------------------------------------

/**
 * Contact multiple attaché à un prospect (DAF, RSE, Assistant DG, etc.).
 * Étend le modèle initial qui stockait UN seul contact dans `prospects.contact_*`.
 *
 * `is_primary` : un seul TRUE par prospect (assuré par index unique partiel
 * `prospect_contacts_one_primary_idx`).
 */
export interface ProspectContact {
  id: string
  user_id: string
  prospect_id: string
  nom?: string
  prenom?: string
  poste?: string
  telephone?: string
  email?: string
  linkedin?: string
  /** Origine : 'pappers', 'hunter', 'recherche_entreprises', 'manual', etc. */
  source?: string
  is_primary: boolean
  created_at: string
  updated_at: string
}

// ------------------------------------------------------------
// HISTORIQUE D'ÉCHANGES (migration 012_prospect_exchanges)
// ------------------------------------------------------------

/**
 * Type d'échange dans le fil chronologique d'un prospect.
 * Aligné sur le CHECK constraint de `prospect_exchanges.type`.
 */
export type ExchangeType = 'appel' | 'email' | 'linkedin' | 'rdv' | 'autre'

/**
 * Journal libre des échanges manuels avec un prospect (hors `daily_list_items`).
 * Capture emails envoyés, messages LinkedIn, rdv planifiés ad hoc, etc.
 */
export interface ProspectExchange {
  id: string
  user_id: string
  prospect_id: string
  /** Horodatage effectif (≠ `created_at` qui est l'horodatage de saisie). */
  occurred_at: string
  type: ExchangeType
  /**
   * Résultat libre. Peut matcher `CallResult` (interested, callback, …) mais
   * non contraint à l'enum pour rester souple (échanges email/linkedin).
   */
  result?: string
  notes?: string
  callback_date?: string
  created_at: string
  updated_at: string
}
