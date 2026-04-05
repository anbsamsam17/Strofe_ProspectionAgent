// ============================================================
// TYPES GÉNÉRÉS DEPUIS LE SCHEMA SUPABASE
// Regénérer après chaque migration avec :
//   npx supabase gen types typescript --project-id <id> > lib/supabase/database.types.ts
// ============================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string | null
          full_name: string | null
          company_name: string | null
          avatar_url: string | null
          settings: Json
          onboarded: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email?: string | null
          full_name?: string | null
          company_name?: string | null
          avatar_url?: string | null
          settings?: Json
          onboarded?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string | null
          full_name?: string | null
          company_name?: string | null
          avatar_url?: string | null
          settings?: Json
          onboarded?: boolean
          updated_at?: string
        }
      }
      prospects: {
        Row: {
          id: string
          user_id: string
          siren: string
          siret: string | null
          raison_sociale: string
          secteur_naf: string | null
          secteur_libelle: string | null
          effectif_min: number | null
          effectif_max: number | null
          ville: string | null
          code_postal: string | null
          adresse: string | null
          contact_nom: string | null
          contact_prenom: string | null
          contact_poste: string | null
          contact_telephone: string | null
          contact_email: string | null
          contact_linkedin: string | null
          beges_publie: boolean
          beges_derniere_publication: string | null
          obligation_beges: boolean
          score_priorite: number
          score_details: Json
          signaux: Json
          statut: string
          source: string
          enriched_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          siren: string
          siret?: string | null
          raison_sociale: string
          secteur_naf?: string | null
          secteur_libelle?: string | null
          effectif_min?: number | null
          effectif_max?: number | null
          ville?: string | null
          code_postal?: string | null
          adresse?: string | null
          contact_nom?: string | null
          contact_prenom?: string | null
          contact_poste?: string | null
          contact_telephone?: string | null
          contact_email?: string | null
          contact_linkedin?: string | null
          beges_publie?: boolean
          beges_derniere_publication?: string | null
          obligation_beges?: boolean
          score_priorite?: number
          score_details?: Json
          signaux?: Json
          statut?: string
          source?: string
          enriched_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          siren?: string
          siret?: string | null
          raison_sociale?: string
          secteur_naf?: string | null
          secteur_libelle?: string | null
          effectif_min?: number | null
          effectif_max?: number | null
          ville?: string | null
          code_postal?: string | null
          adresse?: string | null
          contact_nom?: string | null
          contact_prenom?: string | null
          contact_poste?: string | null
          contact_telephone?: string | null
          contact_email?: string | null
          contact_linkedin?: string | null
          beges_publie?: boolean
          beges_derniere_publication?: string | null
          obligation_beges?: boolean
          score_priorite?: number
          score_details?: Json
          signaux?: Json
          statut?: string
          enriched_at?: string | null
          updated_at?: string
        }
      }
      daily_lists: {
        Row: {
          id: string
          user_id: string
          date: string
          status: string
          generated_at: string | null
          notified_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          date: string
          status?: string
          generated_at?: string | null
          notified_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          status?: string
          generated_at?: string | null
          notified_at?: string | null
          updated_at?: string
        }
      }
      daily_list_items: {
        Row: {
          id: string
          daily_list_id: string
          user_id: string
          prospect_id: string
          ordre: number
          priorite: string
          meilleur_creneau: string | null
          accroche: string | null
          pitch: string | null
          signaux_detectes: Json
          objections_reponses: Json
          contact_type: string | null
          call_result: string | null
          callback_date: string | null
          call_notes: string | null
          called_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          daily_list_id: string
          user_id: string
          prospect_id: string
          ordre: number
          priorite?: string
          meilleur_creneau?: string | null
          accroche?: string | null
          pitch?: string | null
          signaux_detectes?: Json
          objections_reponses?: Json
          contact_type?: string | null
          call_result?: string | null
          callback_date?: string | null
          call_notes?: string | null
          called_at?: string | null
          created_at?: string
        }
        Update: {
          call_result?: string | null
          callback_date?: string | null
          call_notes?: string | null
          called_at?: string | null
        }
      }
      agent_runs: {
        Row: {
          id: string
          user_id: string
          status: string
          phase: string | null
          prospects_sourced: number
          prospects_qualified: number
          list_generated: boolean
          error_message: string | null
          logs: Json
          started_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          status?: string
          phase?: string | null
          prospects_sourced?: number
          prospects_qualified?: number
          list_generated?: boolean
          error_message?: string | null
          logs?: Json
          started_at?: string
          completed_at?: string | null
        }
        Update: {
          status?: string
          phase?: string | null
          prospects_sourced?: number
          prospects_qualified?: number
          list_generated?: boolean
          error_message?: string | null
          logs?: Json
          completed_at?: string | null
        }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
