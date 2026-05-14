// ============================================================
// TYPES GÉNÉRÉS DEPUIS LE SCHEMA SUPABASE
// Format : @supabase/postgrest-js v2 (Relationships obligatoire par table)
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

export type Database = {
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
          sourcing_state: Json
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
          sourcing_state?: Json
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
          sourcing_state?: Json
          updated_at?: string
        }
        Relationships: []
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
          contact_linkedin_entreprise: string | null
          beges_publie: boolean
          beges_derniere_publication: string | null
          obligation_beges: boolean
          score_priorite: number
          score_details: Json
          signaux: Json
          statut: string
          source: string
          enriched_at: string | null
          archived_at: string | null
          notes: string | null
          priorite: string
          /** Migration 014 — score Gemini 0-100, null si non scoré. */
          gemini_score: number | null
          /** Migration 014 — JSONB array de 3-5 raisons commerciales. */
          gemini_raisons: Json | null
          /** Migration 014 — horodatage ISO de génération Gemini. */
          gemini_generated_at: string | null
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
          contact_linkedin_entreprise?: string | null
          beges_publie?: boolean
          beges_derniere_publication?: string | null
          obligation_beges?: boolean
          score_priorite?: number
          score_details?: Json
          signaux?: Json
          statut?: string
          /** Migration 009 — defaut DB 'moyenne'. */
          priorite?: string
          source?: string
          enriched_at?: string | null
          archived_at?: string | null
          notes?: string | null
          /** Migration 014 — initialement NULL, peuplé par Agent N3. */
          gemini_score?: number | null
          gemini_raisons?: Json | null
          gemini_generated_at?: string | null
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
          contact_linkedin_entreprise?: string | null
          beges_publie?: boolean
          beges_derniere_publication?: string | null
          obligation_beges?: boolean
          score_priorite?: number
          score_details?: Json
          signaux?: Json
          statut?: string
          /** Migration 009. */
          priorite?: string
          enriched_at?: string | null
          archived_at?: string | null
          notes?: string | null
          /** Migration 014 — mise à jour par Agent N3 (re-scoring Gemini). */
          gemini_score?: number | null
          gemini_raisons?: Json | null
          gemini_generated_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospects_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
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
        Relationships: [
          {
            foreignKeyName: "daily_lists_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
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
          updated_at: string
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
          updated_at?: string
        }
        Update: {
          call_result?: string | null
          callback_date?: string | null
          call_notes?: string | null
          called_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_list_items_daily_list_id_fkey"
            columns: ["daily_list_id"]
            isOneToOne: false
            referencedRelation: "daily_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_list_items_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_list_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      prospect_contacts: {
        Row: {
          id: string
          user_id: string
          prospect_id: string
          nom: string | null
          prenom: string | null
          poste: string | null
          telephone: string | null
          email: string | null
          linkedin: string | null
          source: string | null
          is_primary: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          prospect_id: string
          nom?: string | null
          prenom?: string | null
          poste?: string | null
          telephone?: string | null
          email?: string | null
          linkedin?: string | null
          source?: string | null
          is_primary?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          nom?: string | null
          prenom?: string | null
          poste?: string | null
          telephone?: string | null
          email?: string | null
          linkedin?: string | null
          source?: string | null
          is_primary?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_contacts_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_contacts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      prospect_exchanges: {
        Row: {
          id: string
          user_id: string
          prospect_id: string
          occurred_at: string
          type: string
          result: string | null
          notes: string | null
          callback_date: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          prospect_id: string
          occurred_at?: string
          type: string
          result?: string | null
          notes?: string | null
          callback_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          occurred_at?: string
          type?: string
          result?: string | null
          notes?: string | null
          callback_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_exchanges_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_exchanges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      agent_runs: {
        Row: {
          id: string
          user_id: string
          status: string
          phase: string | null
          prospects_sourced: number
          prospects_qualified: number
          prospects_new: number | null
          prospects_updated: number | null
          sirene_total_available: number | null
          sirene_pages_loaded: number | null
          sirene_debut_final: number | null
          sirene_curseur_final: string | null
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
          prospects_new?: number | null
          prospects_updated?: number | null
          sirene_total_available?: number | null
          sirene_pages_loaded?: number | null
          sirene_debut_final?: number | null
          sirene_curseur_final?: string | null
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
          prospects_new?: number | null
          prospects_updated?: number | null
          sirene_total_available?: number | null
          sirene_pages_loaded?: number | null
          sirene_debut_final?: number | null
          sirene_curseur_final?: string | null
          list_generated?: boolean
          error_message?: string | null
          logs?: Json
          completed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
