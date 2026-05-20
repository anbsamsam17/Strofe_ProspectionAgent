export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_runs: {
        Row: {
          completed_at: string | null
          error_message: string | null
          id: string
          list_generated: boolean
          logs: Json
          phase: string | null
          prospects_new: number | null
          prospects_qualified: number
          prospects_sourced: number
          prospects_updated: number | null
          sirene_curseur_final: string | null
          sirene_debut_final: number | null
          sirene_pages_loaded: number | null
          sirene_total_available: number | null
          started_at: string
          status: Database["public"]["Enums"]["agent_run_status"]
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          list_generated?: boolean
          logs?: Json
          phase?: string | null
          prospects_new?: number | null
          prospects_qualified?: number
          prospects_sourced?: number
          prospects_updated?: number | null
          sirene_curseur_final?: string | null
          sirene_debut_final?: number | null
          sirene_pages_loaded?: number | null
          sirene_total_available?: number | null
          started_at?: string
          status?: Database["public"]["Enums"]["agent_run_status"]
          user_id: string
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          list_generated?: boolean
          logs?: Json
          phase?: string | null
          prospects_new?: number | null
          prospects_qualified?: number
          prospects_sourced?: number
          prospects_updated?: number | null
          sirene_curseur_final?: string | null
          sirene_debut_final?: number | null
          sirene_pages_loaded?: number | null
          sirene_total_available?: number | null
          started_at?: string
          status?: Database["public"]["Enums"]["agent_run_status"]
          user_id?: string
        }
        Relationships: []
      }
      api_quotas: {
        Row: {
          created_at: string
          id: string
          limit_count: number
          month_start: string
          provider: string
          updated_at: string
          used_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          limit_count: number
          month_start: string
          provider: string
          updated_at?: string
          used_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          limit_count?: number
          month_start?: string
          provider?: string
          updated_at?: string
          used_count?: number
          user_id?: string
        }
        Relationships: []
      }
      daily_list_items: {
        Row: {
          accroche: string | null
          call_notes: string | null
          call_result: Database["public"]["Enums"]["call_result"] | null
          callback_date: string | null
          called_at: string | null
          contact_type: Database["public"]["Enums"]["contact_type"]
          created_at: string
          daily_list_id: string
          id: string
          meilleur_creneau: string | null
          objections_reponses: Json
          ordre: number
          pitch: string | null
          priorite: Database["public"]["Enums"]["call_priority"]
          prospect_id: string
          signaux_detectes: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          accroche?: string | null
          call_notes?: string | null
          call_result?: Database["public"]["Enums"]["call_result"] | null
          callback_date?: string | null
          called_at?: string | null
          contact_type?: Database["public"]["Enums"]["contact_type"]
          created_at?: string
          daily_list_id: string
          id?: string
          meilleur_creneau?: string | null
          objections_reponses?: Json
          ordre: number
          pitch?: string | null
          priorite?: Database["public"]["Enums"]["call_priority"]
          prospect_id: string
          signaux_detectes?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          accroche?: string | null
          call_notes?: string | null
          call_result?: Database["public"]["Enums"]["call_result"] | null
          callback_date?: string | null
          called_at?: string | null
          contact_type?: Database["public"]["Enums"]["contact_type"]
          created_at?: string
          daily_list_id?: string
          id?: string
          meilleur_creneau?: string | null
          objections_reponses?: Json
          ordre?: number
          pitch?: string | null
          priorite?: Database["public"]["Enums"]["call_priority"]
          prospect_id?: string
          signaux_detectes?: Json
          updated_at?: string
          user_id?: string
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
        ]
      }
      daily_lists: {
        Row: {
          created_at: string
          date: string
          generated_at: string | null
          id: string
          notified_at: string | null
          status: Database["public"]["Enums"]["daily_list_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          generated_at?: string | null
          id?: string
          notified_at?: string | null
          status?: Database["public"]["Enums"]["daily_list_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          generated_at?: string | null
          id?: string
          notified_at?: string | null
          status?: Database["public"]["Enums"]["daily_list_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      opt_out: {
        Row: {
          created_at: string
          email: string | null
          id: string
          reason: string | null
          siren: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          reason?: string | null
          siren?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          reason?: string | null
          siren?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company_name: string | null
          created_at: string
          full_name: string | null
          id: string
          onboarded: boolean
          settings: Json
          sourcing_state: Json
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          company_name?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          onboarded?: boolean
          settings?: Json
          sourcing_state?: Json
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          company_name?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          onboarded?: boolean
          settings?: Json
          sourcing_state?: Json
          updated_at?: string
        }
        Relationships: []
      }
      prospect_contacts: {
        Row: {
          created_at: string
          email: string | null
          email_confidence: number | null
          email_is_pro: boolean
          email_status: string | null
          email_verified_at: string | null
          id: string
          is_primary: boolean
          last_enriched_at: string | null
          linkedin: string | null
          nom: string | null
          poste: string | null
          prenom: string | null
          prospect_id: string
          source: string | null
          source_chain: Json
          telephone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          email_confidence?: number | null
          email_is_pro?: boolean
          email_status?: string | null
          email_verified_at?: string | null
          id?: string
          is_primary?: boolean
          last_enriched_at?: string | null
          linkedin?: string | null
          nom?: string | null
          poste?: string | null
          prenom?: string | null
          prospect_id: string
          source?: string | null
          source_chain?: Json
          telephone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          email_confidence?: number | null
          email_is_pro?: boolean
          email_status?: string | null
          email_verified_at?: string | null
          id?: string
          is_primary?: boolean
          last_enriched_at?: string | null
          linkedin?: string | null
          nom?: string | null
          poste?: string | null
          prenom?: string | null
          prospect_id?: string
          source?: string | null
          source_chain?: Json
          telephone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_contacts_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_exchanges: {
        Row: {
          callback_date: string | null
          created_at: string
          id: string
          notes: string | null
          occurred_at: string
          prospect_id: string
          result: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          callback_date?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          occurred_at?: string
          prospect_id: string
          result?: string | null
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          callback_date?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          occurred_at?: string
          prospect_id?: string
          result?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_exchanges_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospects: {
        Row: {
          adresse: string | null
          archived_at: string | null
          beges_decret_2022_compliant: boolean | null
          beges_derniere_publication: string | null
          beges_publie: boolean
          beges_url: string | null
          beges_valide: boolean | null
          bilan_ges_data: Json | null
          chiffre_affaires: number | null
          code_postal: string | null
          contact_completeness: number | null
          contact_email: string | null
          contact_linkedin: string | null
          contact_linkedin_entreprise: string | null
          contact_nom: string | null
          contact_outdated_at: string | null
          contact_poste: string | null
          contact_prenom: string | null
          contact_source_origin: string | null
          contact_telephone: string | null
          contact_tier: string | null
          created_at: string
          croissance_ca_yoy_pct: number | null
          effectif_max: number | null
          effectif_min: number | null
          enriched_at: string | null
          entite_publique: boolean | null
          gemini_generated_at: string | null
          gemini_raisons: Json | null
          gemini_score: number | null
          id: string
          last_enrichment_run_at: string | null
          notes: string | null
          obligation_beges: boolean
          priorite: string
          raison_sociale: string
          resultat_net: number | null
          score_details: Json
          score_priorite: number
          secteur_libelle: string | null
          secteur_naf: string | null
          signaux: Json
          siren: string
          siret: string | null
          source: string
          statut: Database["public"]["Enums"]["prospect_status"]
          updated_at: string
          user_id: string
          ville: string | null
        }
        Insert: {
          adresse?: string | null
          archived_at?: string | null
          beges_decret_2022_compliant?: boolean | null
          beges_derniere_publication?: string | null
          beges_publie?: boolean
          beges_url?: string | null
          beges_valide?: boolean | null
          bilan_ges_data?: Json | null
          chiffre_affaires?: number | null
          code_postal?: string | null
          contact_completeness?: number | null
          contact_email?: string | null
          contact_linkedin?: string | null
          contact_linkedin_entreprise?: string | null
          contact_nom?: string | null
          contact_outdated_at?: string | null
          contact_poste?: string | null
          contact_prenom?: string | null
          contact_source_origin?: string | null
          contact_telephone?: string | null
          contact_tier?: string | null
          created_at?: string
          croissance_ca_yoy_pct?: number | null
          effectif_max?: number | null
          effectif_min?: number | null
          enriched_at?: string | null
          entite_publique?: boolean | null
          gemini_generated_at?: string | null
          gemini_raisons?: Json | null
          gemini_score?: number | null
          id?: string
          last_enrichment_run_at?: string | null
          notes?: string | null
          obligation_beges?: boolean
          priorite?: string
          raison_sociale: string
          resultat_net?: number | null
          score_details?: Json
          score_priorite?: number
          secteur_libelle?: string | null
          secteur_naf?: string | null
          signaux?: Json
          siren: string
          siret?: string | null
          source?: string
          statut?: Database["public"]["Enums"]["prospect_status"]
          updated_at?: string
          user_id: string
          ville?: string | null
        }
        Update: {
          adresse?: string | null
          archived_at?: string | null
          beges_decret_2022_compliant?: boolean | null
          beges_derniere_publication?: string | null
          beges_publie?: boolean
          beges_url?: string | null
          beges_valide?: boolean | null
          bilan_ges_data?: Json | null
          chiffre_affaires?: number | null
          code_postal?: string | null
          contact_completeness?: number | null
          contact_email?: string | null
          contact_linkedin?: string | null
          contact_linkedin_entreprise?: string | null
          contact_nom?: string | null
          contact_outdated_at?: string | null
          contact_poste?: string | null
          contact_prenom?: string | null
          contact_source_origin?: string | null
          contact_telephone?: string | null
          contact_tier?: string | null
          created_at?: string
          croissance_ca_yoy_pct?: number | null
          effectif_max?: number | null
          effectif_min?: number | null
          enriched_at?: string | null
          entite_publique?: boolean | null
          gemini_generated_at?: string | null
          gemini_raisons?: Json | null
          gemini_score?: number | null
          id?: string
          last_enrichment_run_at?: string | null
          notes?: string | null
          obligation_beges?: boolean
          priorite?: string
          raison_sociale?: string
          resultat_net?: number | null
          score_details?: Json
          score_priorite?: number
          secteur_libelle?: string | null
          secteur_naf?: string | null
          signaux?: Json
          siren?: string
          siret?: string | null
          source?: string
          statut?: Database["public"]["Enums"]["prospect_status"]
          updated_at?: string
          user_id?: string
          ville?: string | null
        }
        Relationships: []
      }
      sirene_cache: {
        Row: {
          activite_principale: string | null
          adresse: string | null
          code_postal: string | null
          commune: string | null
          date_creation: string | null
          date_maj_insee: string | null
          effectif_max: number | null
          effectif_min: number | null
          etat_administratif: string | null
          imported_at: string | null
          raison_sociale: string | null
          siren: string
          siret: string
          source_file: string | null
          tranche_effectifs: string | null
        }
        Insert: {
          activite_principale?: string | null
          adresse?: string | null
          code_postal?: string | null
          commune?: string | null
          date_creation?: string | null
          date_maj_insee?: string | null
          effectif_max?: number | null
          effectif_min?: number | null
          etat_administratif?: string | null
          imported_at?: string | null
          raison_sociale?: string | null
          siren: string
          siret: string
          source_file?: string | null
          tranche_effectifs?: string | null
        }
        Update: {
          activite_principale?: string | null
          adresse?: string | null
          code_postal?: string | null
          commune?: string | null
          date_creation?: string | null
          date_maj_insee?: string | null
          effectif_max?: number | null
          effectif_min?: number | null
          etat_administratif?: string | null
          imported_at?: string | null
          raison_sociale?: string | null
          siren?: string
          siret?: string
          source_file?: string | null
          tranche_effectifs?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      sirene_cache_size: {
        Row: {
          active_count: number | null
          days_since_import: number | null
          last_import_at: string | null
          total_bytes: number | null
          total_size: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      search_sirene_cache: {
        Args: {
          p_code_postal_max: string
          p_code_postal_min: string
          p_exclude_sirens: string[]
          p_limit?: number
          p_naf_codes: string[]
          p_offset?: number
          p_tranche_effectifs: string[]
        }
        Returns: {
          activite_principale: string
          adresse: string
          code_postal: string
          commune: string
          effectif_max: number
          effectif_min: number
          raison_sociale: string
          siren: string
          siret: string
          tranche_effectifs: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      agent_run_status: "running" | "completed" | "failed"
      call_priority: "haute" | "normale" | "basse"
      call_result:
        | "interested"
        | "callback"
        | "not_interested"
        | "wrong_contact"
        | "no_answer"
        | "voicemail"
        | "email_sent"
        | "no_contact_point"
      contact_type: "rse" | "daf" | "drh" | "dg" | "autre"
      daily_list_status: "pending" | "generating" | "ready" | "completed"
      prospect_status:
        | "sourced"
        | "qualified"
        | "contacted"
        | "interested"
        | "rdv"
        | "converted"
        | "rejected"
        | "on_hold"
        | "offer_sent"
        | "do_not_contact"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      agent_run_status: ["running", "completed", "failed"],
      call_priority: ["haute", "normale", "basse"],
      call_result: [
        "interested",
        "callback",
        "not_interested",
        "wrong_contact",
        "no_answer",
        "voicemail",
        "email_sent",
        "no_contact_point",
      ],
      contact_type: ["rse", "daf", "drh", "dg", "autre"],
      daily_list_status: ["pending", "generating", "ready", "completed"],
      prospect_status: [
        "sourced",
        "qualified",
        "contacted",
        "interested",
        "rdv",
        "converted",
        "rejected",
        "on_hold",
        "offer_sent",
        "do_not_contact",
      ],
    },
  },
} as const
