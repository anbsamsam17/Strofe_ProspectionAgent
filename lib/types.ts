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
  | 'rdv'
  | 'converted'
  | 'rejected'
  | 'on_hold'

export type CallResult =
  | 'interested'
  | 'callback'
  | 'not_interested'
  | 'wrong_contact'
  | 'no_answer'
  | 'voicemail'
  | 'email_sent'
  | 'no_contact_point'

export type Priority = 'haute' | 'normale' | 'basse'

export type DailyListStatus = 'pending' | 'generating' | 'ready' | 'completed'

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
  daily_call_target: number
  notification_email?: string
  offer_description?: string
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
  beges_publie: boolean
  beges_derniere_publication?: string
  /** URL directe vers le BEGES sur bilans-ges.ademe.fr */
  beges_url?: string
  /** true si le BEGES a moins de 4 ans (obligation renouvellement quadriennal) */
  beges_valide?: boolean
  obligation_beges: boolean
  score_priorite: number
  score_details: ScoreDetails
  signaux: IntentionSignal[]
  statut: ProspectStatus
  source: string
  enriched_at?: string
  /** Horodatage de mise en archive — NULL/undefined = prospect actif. */
  archived_at?: string
  /** Notes libres CRM saisies par l'utilisateur. */
  notes?: string
  created_at: string
  updated_at: string
}

export interface ScoreDetails {
  obligation_beges: number
  secteur_prioritaire: number
  /** Points pour BEGES jamais publié (beges_publie = false). Mutuellement exclusif avec beges_expire. */
  beges_non_publie: number
  /** Points pour BEGES publié mais expiré (>4 ans). Cible la plus chaude commercialement. */
  beges_expire: number
  signaux_intention: number
  taille_entreprise: number
  contact_trouve: number
  /** Bonus si le secteur NAF est déjà acculturé au BEGES (santé / transport routier / agro-alimentaire). */
  secteur_beges_mature: number
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

export interface DailyList {
  id: string
  user_id: string
  date: string
  status: DailyListStatus
  generated_at?: string
  /** Horodatage d'envoi de la notification email — NULL si pas encore notifié */
  notified_at?: string
  created_at: string
  updated_at: string
  items?: DailyListItem[]
}

export interface DailyListItem {
  id: string
  daily_list_id: string
  user_id: string
  prospect_id: string
  prospect?: Prospect
  ordre: number
  priorite: Priority
  meilleur_creneau?: string
  accroche?: string
  pitch?: string
  signaux_detectes: IntentionSignal[]
  objections_reponses: ObjectionReponse[]
  contact_type?: ContactType
  call_result?: CallResult
  callback_date?: string
  call_notes?: string
  called_at?: string
  created_at: string
}

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
