export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      access_logs: {
        Row: {
          action: Database["public"]["Enums"]["access_action"]
          actor_profile_id: string | null
          actor_user_id: string | null
          created_at: string
          id: string
          ip: unknown
          metadata: Json | null
          profile_id: string | null
          resource_id: string | null
          resource_type: string | null
          user_agent: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["access_action"]
          actor_profile_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          ip?: unknown
          metadata?: Json | null
          profile_id?: string | null
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["access_action"]
          actor_profile_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          ip?: unknown
          metadata?: Json | null
          profile_id?: string | null
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_logs_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_logs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_reminders: {
        Row: {
          appointment_id: string
          claimed_at: string | null
          created_at: string
          due_at: string
          entregas: number | null
          estado: string
          fallos: number | null
          id: string
          sent_at: string | null
          ventana: string
        }
        Insert: {
          appointment_id: string
          claimed_at?: string | null
          created_at?: string
          due_at: string
          entregas?: number | null
          estado?: string
          fallos?: number | null
          id?: string
          sent_at?: string | null
          ventana: string
        }
        Update: {
          appointment_id?: string
          claimed_at?: string | null
          created_at?: string
          due_at?: string
          entregas?: number | null
          estado?: string
          fallos?: number | null
          id?: string
          sent_at?: string | null
          ventana?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_reminders_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          appointment_date: string
          created_at: string
          created_by_profile_id: string | null
          doctor_id: string | null
          doctor_name: string | null
          id: string
          latitude: number | null
          location_address: string | null
          location_name: string | null
          longitude: number | null
          preparation_notes: string | null
          profile_id: string
          specialty: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          appointment_date: string
          created_at?: string
          created_by_profile_id?: string | null
          doctor_id?: string | null
          doctor_name?: string | null
          id?: string
          latitude?: number | null
          location_address?: string | null
          location_name?: string | null
          longitude?: number | null
          preparation_notes?: string | null
          profile_id: string
          specialty: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          appointment_date?: string
          created_at?: string
          created_by_profile_id?: string | null
          doctor_id?: string | null
          doctor_name?: string | null
          id?: string
          latitude?: number | null
          location_address?: string | null
          location_name?: string | null
          longitude?: number | null
          preparation_notes?: string | null
          profile_id?: string
          specialty?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consents: {
        Row: {
          accepted_at: string
          document: string
          id: string
          ip: unknown
          user_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          document: string
          id?: string
          ip?: unknown
          user_id: string
          version: string
        }
        Update: {
          accepted_at?: string
          document?: string
          id?: string
          ip?: unknown
          user_id?: string
          version?: string
        }
        Relationships: []
      }
      consultation_sheets: {
        Row: {
          content: Json
          created_at: string
          generated_by_profile_id: string
          id: string
          profile_id: string
        }
        Insert: {
          content: Json
          created_at?: string
          generated_by_profile_id: string
          id?: string
          profile_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          generated_by_profile_id?: string
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultation_sheets_generated_by_profile_id_fkey"
            columns: ["generated_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultation_sheets_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      doctors: {
        Row: {
          address: string | null
          created_at: string
          created_by_profile_id: string | null
          deactivated_at: string | null
          full_name: string
          id: string
          institution: string | null
          is_active: boolean
          latitude: number | null
          license_number: string | null
          longitude: number | null
          notes: string | null
          phone: string | null
          profile_id: string
          specialty: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          deactivated_at?: string | null
          full_name: string
          id?: string
          institution?: string | null
          is_active?: boolean
          latitude?: number | null
          license_number?: string | null
          longitude?: number | null
          notes?: string | null
          phone?: string | null
          profile_id: string
          specialty?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          deactivated_at?: string | null
          full_name?: string
          id?: string
          institution?: string | null
          is_active?: boolean
          latitude?: number | null
          license_number?: string | null
          longitude?: number | null
          notes?: string | null
          phone?: string | null
          profile_id?: string
          specialty?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctors_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctors_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          ai_confidence: number | null
          ai_summary: string | null
          category: Database["public"]["Enums"]["doc_category"]
          confirmed_at: string | null
          created_at: string
          created_by_profile_id: string | null
          doctor_id: string | null
          doctor_name: string | null
          document_date: string
          file_size_bytes: number | null
          id: string
          institution: string | null
          mime_type: string | null
          profile_id: string
          raw_ocr_text: string | null
          specialty: string | null
          storage_path: string
          title: string
          updated_at: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_summary?: string | null
          category?: Database["public"]["Enums"]["doc_category"]
          confirmed_at?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          doctor_id?: string | null
          doctor_name?: string | null
          document_date: string
          file_size_bytes?: number | null
          id?: string
          institution?: string | null
          mime_type?: string | null
          profile_id: string
          raw_ocr_text?: string | null
          specialty?: string | null
          storage_path: string
          title: string
          updated_at?: string
        }
        Update: {
          ai_confidence?: number | null
          ai_summary?: string | null
          category?: Database["public"]["Enums"]["doc_category"]
          confirmed_at?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          doctor_id?: string | null
          doctor_name?: string | null
          document_date?: string
          file_size_bytes?: number | null
          id?: string
          institution?: string | null
          mime_type?: string | null
          profile_id?: string
          raw_ocr_text?: string | null
          specialty?: string | null
          storage_path?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      family_permissions: {
        Row: {
          can_manage: boolean
          can_upload: boolean
          can_view: boolean
          created_at: string
          granted_profile_id: string
          id: string
          owner_profile_id: string
          updated_at: string
        }
        Insert: {
          can_manage?: boolean
          can_upload?: boolean
          can_view?: boolean
          created_at?: string
          granted_profile_id: string
          id?: string
          owner_profile_id: string
          updated_at?: string
        }
        Update: {
          can_manage?: boolean
          can_upload?: boolean
          can_view?: boolean
          created_at?: string
          granted_profile_id?: string
          id?: string
          owner_profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_permissions_granted_profile_id_fkey"
            columns: ["granted_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_permissions_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_cards: {
        Row: {
          back_storage_path: string | null
          created_at: string
          created_by_profile_id: string | null
          front_storage_path: string | null
          id: string
          is_primary: boolean
          member_number: string | null
          notes: string | null
          plan: string | null
          profile_id: string
          provider: string
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          back_storage_path?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          front_storage_path?: string | null
          id?: string
          is_primary?: boolean
          member_number?: string | null
          notes?: string | null
          plan?: string | null
          profile_id: string
          provider: string
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          back_storage_path?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          front_storage_path?: string | null
          id?: string
          is_primary?: boolean
          member_number?: string | null
          notes?: string | null
          plan?: string | null
          profile_id?: string
          provider?: string
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insurance_cards_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_cards_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_metrics: {
        Row: {
          created_at: string
          created_by_profile_id: string | null
          document_id: string | null
          id: string
          measurement_date: string
          metric_canonical: string | null
          metric_name: string
          profile_id: string
          reference_max: number | null
          reference_min: number | null
          reference_range: string | null
          unit: string | null
          value: number
        }
        Insert: {
          created_at?: string
          created_by_profile_id?: string | null
          document_id?: string | null
          id?: string
          measurement_date: string
          metric_canonical?: string | null
          metric_name: string
          profile_id: string
          reference_max?: number | null
          reference_min?: number | null
          reference_range?: string | null
          unit?: string | null
          value: number
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string | null
          document_id?: string | null
          id?: string
          measurement_date?: string
          metric_canonical?: string | null
          metric_name?: string
          profile_id?: string
          reference_max?: number | null
          reference_min?: number | null
          reference_range?: string | null
          unit?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "lab_metrics_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_metrics_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_metrics_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_intakes: {
        Row: {
          created_at: string
          created_by_profile_id: string | null
          dose_units: number | null
          id: string
          medication_id: string
          notes: string | null
          profile_id: string
          scheduled_at: string
          status: Database["public"]["Enums"]["medication_intake_status"]
          taken_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id?: string | null
          dose_units?: number | null
          id?: string
          medication_id: string
          notes?: string | null
          profile_id: string
          scheduled_at: string
          status?: Database["public"]["Enums"]["medication_intake_status"]
          taken_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string | null
          dose_units?: number | null
          id?: string
          medication_id?: string
          notes?: string | null
          profile_id?: string
          scheduled_at?: string
          status?: Database["public"]["Enums"]["medication_intake_status"]
          taken_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medication_intakes_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_intakes_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "medications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_intakes_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "v_medicacion_estado"
            referencedColumns: ["medication_id"]
          },
          {
            foreignKeyName: "medication_intakes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_renewal_alerts: {
        Row: {
          claimed_at: string | null
          created_at: string
          dias_restantes: number
          entregas: number | null
          estado: string
          fallos: number | null
          id: string
          medication_id: string
          profile_id: string
          sent_at: string | null
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          dias_restantes: number
          entregas?: number | null
          estado?: string
          fallos?: number | null
          id?: string
          medication_id: string
          profile_id: string
          sent_at?: string | null
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          dias_restantes?: number
          entregas?: number | null
          estado?: string
          fallos?: number | null
          id?: string
          medication_id?: string
          profile_id?: string
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medication_renewal_alerts_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "medications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_renewal_alerts_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "v_medicacion_estado"
            referencedColumns: ["medication_id"]
          },
          {
            foreignKeyName: "medication_renewal_alerts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      medications: {
        Row: {
          active_ingredient: string | null
          created_at: string
          created_by_profile_id: string | null
          dose_amount: number
          dose_unit: string
          end_date: string | null
          frequency: Database["public"]["Enums"]["medication_frequency"]
          id: string
          interval_hours: number | null
          is_active: boolean
          name: string
          notes: string | null
          prescription_document_id: string | null
          presentation: string | null
          profile_id: string
          schedule_times: string[] | null
          start_date: string
          stock_units: number | null
          suspended_at: string | null
          updated_at: string
        }
        Insert: {
          active_ingredient?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          dose_amount: number
          dose_unit?: string
          end_date?: string | null
          frequency?: Database["public"]["Enums"]["medication_frequency"]
          id?: string
          interval_hours?: number | null
          is_active?: boolean
          name: string
          notes?: string | null
          prescription_document_id?: string | null
          presentation?: string | null
          profile_id: string
          schedule_times?: string[] | null
          start_date?: string
          stock_units?: number | null
          suspended_at?: string | null
          updated_at?: string
        }
        Update: {
          active_ingredient?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          dose_amount?: number
          dose_unit?: string
          end_date?: string | null
          frequency?: Database["public"]["Enums"]["medication_frequency"]
          id?: string
          interval_hours?: number | null
          is_active?: boolean
          name?: string
          notes?: string | null
          prescription_document_id?: string | null
          presentation?: string | null
          profile_id?: string
          schedule_times?: string[] | null
          start_date?: string
          stock_units?: number | null
          suspended_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medications_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medications_prescription_document_id_fkey"
            columns: ["prescription_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          allergies: string[]
          avatar_storage_path: string | null
          blood_type: string | null
          chronic_conditions: string[]
          created_at: string
          created_by_profile_id: string | null
          critical_medication: string[]
          date_of_birth: string | null
          display_density: Database["public"]["Enums"]["display_density"]
          emergency_contact: string | null
          emergency_contact_phone: string | null
          emergency_contact_relationship: string | null
          full_name: string
          id: string
          national_id: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          sos_notes: string | null
          sos_updated_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          allergies?: string[]
          avatar_storage_path?: string | null
          blood_type?: string | null
          chronic_conditions?: string[]
          created_at?: string
          created_by_profile_id?: string | null
          critical_medication?: string[]
          date_of_birth?: string | null
          display_density?: Database["public"]["Enums"]["display_density"]
          emergency_contact?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          full_name: string
          id?: string
          national_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          sos_notes?: string | null
          sos_updated_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          allergies?: string[]
          avatar_storage_path?: string | null
          blood_type?: string | null
          chronic_conditions?: string[]
          created_at?: string
          created_by_profile_id?: string | null
          critical_medication?: string[]
          date_of_birth?: string | null
          display_density?: Database["public"]["Enums"]["display_density"]
          emergency_contact?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          full_name?: string
          id?: string
          national_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          sos_notes?: string | null
          sos_updated_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          profile_id: string | null
          revoked_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          profile_id?: string | null
          revoked_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          profile_id?: string | null
          revoked_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_uploads_temp: {
        Row: {
          created_at: string
          expires_at: string
          file_size_bytes: number
          id: string
          mime_type: string
          original_filename: string
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          file_size_bytes: number
          id?: string
          mime_type: string
          original_filename: string
          storage_path: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          file_size_bytes?: number
          id?: string
          mime_type?: string
          original_filename?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: []
      }
      storage_purge_queue: {
        Row: {
          bucket: string
          created_at: string
          id: string
          purged_at: string | null
          source_id: string
          source_table: string
          storage_path: string
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: string
          purged_at?: string | null
          source_id: string
          source_table: string
          storage_path: string
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: string
          purged_at?: string | null
          source_id?: string
          source_table?: string
          storage_path?: string
        }
        Relationships: []
      }
      vital_sign_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          id: string
          mensaje: string
          profile_id: string
          referencia: number | null
          regla: Database["public"]["Enums"]["vital_sign_alert_rule"]
          tipo: Database["public"]["Enums"]["vital_sign_type"]
          umbral: number
          valor: number
          vital_sign_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          mensaje: string
          profile_id: string
          referencia?: number | null
          regla: Database["public"]["Enums"]["vital_sign_alert_rule"]
          tipo: Database["public"]["Enums"]["vital_sign_type"]
          umbral: number
          valor: number
          vital_sign_id: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          mensaje?: string
          profile_id?: string
          referencia?: number | null
          regla?: Database["public"]["Enums"]["vital_sign_alert_rule"]
          tipo?: Database["public"]["Enums"]["vital_sign_type"]
          umbral?: number
          valor?: number
          vital_sign_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vital_sign_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_sign_alerts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_sign_alerts_vital_sign_id_fkey"
            columns: ["vital_sign_id"]
            isOneToOne: false
            referencedRelation: "vital_signs"
            referencedColumns: ["id"]
          },
        ]
      }
      vital_sign_thresholds: {
        Row: {
          created_at: string
          diastolica_max: number
          glucemia_max: number
          glucemia_min: number
          peso_variacion_kg: number
          peso_ventana_dias: number
          profile_id: string
          sistolica_max: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          diastolica_max?: number
          glucemia_max?: number
          glucemia_min?: number
          peso_variacion_kg?: number
          peso_ventana_dias?: number
          profile_id: string
          sistolica_max?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          diastolica_max?: number
          glucemia_max?: number
          glucemia_min?: number
          peso_variacion_kg?: number
          peso_ventana_dias?: number
          profile_id?: string
          sistolica_max?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vital_sign_thresholds_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vital_signs: {
        Row: {
          created_at: string
          created_by_profile_id: string | null
          diastolic: number | null
          id: string
          measured_at: string
          notes: string | null
          profile_id: string
          pulse: number | null
          systolic: number | null
          type: Database["public"]["Enums"]["vital_sign_type"]
          unit: string | null
          updated_at: string
          value: number | null
        }
        Insert: {
          created_at?: string
          created_by_profile_id?: string | null
          diastolic?: number | null
          id?: string
          measured_at?: string
          notes?: string | null
          profile_id: string
          pulse?: number | null
          systolic?: number | null
          type: Database["public"]["Enums"]["vital_sign_type"]
          unit?: string | null
          updated_at?: string
          value?: number | null
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string | null
          diastolic?: number | null
          id?: string
          measured_at?: string
          notes?: string | null
          profile_id?: string
          pulse?: number | null
          systolic?: number | null
          type?: Database["public"]["Enums"]["vital_sign_type"]
          unit?: string | null
          updated_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vital_signs_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_signs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_medicacion_estado: {
        Row: {
          active_ingredient: string | null
          created_at: string | null
          dias_restantes: number | null
          dose_amount: number | null
          dose_unit: string | null
          dosis_diaria_total: number | null
          end_date: string | null
          fecha_estimada_fin: string | null
          frequency: Database["public"]["Enums"]["medication_frequency"] | null
          interval_hours: number | null
          medication_id: string | null
          name: string | null
          necesita_renovacion: boolean | null
          notes: string | null
          prescription_document_id: string | null
          presentation: string | null
          profile_id: string | null
          schedule_times: string[] | null
          start_date: string | null
          stock_units: number | null
          tomas_por_dia: number | null
          updated_at: string | null
          vigente_hoy: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "medications_prescription_document_id_fkey"
            columns: ["prescription_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      cerrar_alerta_medicacion: {
        Args: { p_entregas: number; p_fallos: number; p_id: string }
        Returns: boolean
      }
      cerrar_recordatorio_turno: {
        Args: { p_entregas: number; p_fallos: number; p_id: string }
        Returns: boolean
      }
      configurar_cron_alertas_medicacion: {
        Args: { p_url: string }
        Returns: undefined
      }
      configurar_cron_recordatorios: {
        Args: { p_secreto: string; p_url: string }
        Returns: undefined
      }
      confirmar_documento_recien_subido: {
        Args: {
          doc_id: string
          metricas?: Json
          nueva_categoria: string
          nueva_especialidad?: string
          nueva_fecha: string
          nueva_institucion?: string
          nuevo_medico?: string
          nuevo_resumen: string
          nuevo_titulo: string
        }
        Returns: {
          ai_confidence: number | null
          ai_summary: string | null
          category: Database["public"]["Enums"]["doc_category"]
          confirmed_at: string | null
          created_at: string
          created_by_profile_id: string | null
          doctor_id: string | null
          doctor_name: string | null
          document_date: string
          file_size_bytes: number | null
          id: string
          institution: string | null
          mime_type: string | null
          profile_id: string
          raw_ocr_text: string | null
          specialty: string | null
          storage_path: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      descartar_documento_recien_subido: {
        Args: { doc_id: string }
        Returns: {
          ai_confidence: number | null
          ai_summary: string | null
          category: Database["public"]["Enums"]["doc_category"]
          confirmed_at: string | null
          created_at: string
          created_by_profile_id: string | null
          doctor_id: string | null
          doctor_name: string | null
          document_date: string
          file_size_bytes: number | null
          id: string
          institution: string | null
          mime_type: string | null
          profile_id: string
          raw_ocr_text: string | null
          specialty: string | null
          storage_path: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      destinatarios_de_avisos: {
        Args: { p_profile_id: string }
        Returns: string[]
      }
      disparar_alertas_medicacion: { Args: never; Returns: string }
      disparar_recordatorios_turnos: { Args: never; Returns: string }
      es_perfil_gestionado: { Args: { perfil: string }; Returns: boolean }
      es_sesion_de_usuario: { Args: never; Returns: boolean }
      es_titular: { Args: { perfil: string }; Returns: boolean }
      generar_alertas_medicacion: { Args: never; Returns: number }
      generar_recordatorios_pendientes: { Args: never; Returns: number }
      generar_tomas_del_dia: { Args: { fecha?: string }; Returns: number }
      nombres_de_perfiles_vinculados: {
        Args: never
        Returns: {
          full_name: string
          perfil_id: string
        }[]
      }
      perfil_actor: { Args: never; Returns: string }
      perfil_de_objeto_storage: { Args: { objeto: string }; Returns: string }
      perfil_id_por_email: { Args: { email_buscado: string }; Returns: string }
      puede_administrar_perfil: { Args: { perfil: string }; Returns: boolean }
      puede_arrancar_administracion: {
        Args: { autorizado: string; perfil: string }
        Returns: boolean
      }
      puede_cargar_en_perfil: { Args: { perfil: string }; Returns: boolean }
      puede_otorgar_permisos: { Args: { perfil: string }; Returns: boolean }
      puede_ver_perfil: { Args: { perfil: string }; Returns: boolean }
      reclamar_alertas_medicacion: {
        Args: { p_limite?: number }
        Returns: {
          alerta_id: string
          dias_restantes: number
          dose_unit: string
          medication_id: string
          nombre: string
          nombre_perfil: string
          profile_id: string
          stock_units: number
        }[]
      }
      reclamar_recordatorios_turnos: {
        Args: { p_limite?: number }
        Returns: {
          appointment_id: string
          especialidad: string
          fecha: string
          lugar: string
          medico: string
          preparacion: string
          profile_id: string
          recordatorio_id: string
          ventana: string
        }[]
      }
      registrar_suscripcion_push: {
        Args: {
          p_auth: string
          p_endpoint: string
          p_p256dh: string
          p_profile_id?: string
          p_user_agent?: string
        }
        Returns: string
      }
      registrar_toma: {
        Args: { intake_id: string }
        Returns: {
          created_at: string
          created_by_profile_id: string | null
          dose_units: number | null
          id: string
          medication_id: string
          notes: string | null
          profile_id: string
          scheduled_at: string
          status: Database["public"]["Enums"]["medication_intake_status"]
          taken_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "medication_intakes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revertir_toma: {
        Args: { intake_id: string }
        Returns: {
          created_at: string
          created_by_profile_id: string | null
          dose_units: number | null
          id: string
          medication_id: string
          notes: string | null
          profile_id: string
          scheduled_at: string
          status: Database["public"]["Enums"]["medication_intake_status"]
          taken_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "medication_intakes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      access_action:
        | "login"
        | "logout"
        | "ver_perfil"
        | "ver_documento"
        | "descargar_archivo"
        | "ver_credencial"
        | "exportar_ficha"
        | "otorgar_permiso"
        | "revocar_permiso"
      appointment_status: "pending" | "confirmed" | "completed" | "cancelled"
      display_density: "grande" | "chica"
      doc_category:
        | "laboratory"
        | "imaging"
        | "prescription"
        | "consultation"
        | "other"
      insurance_card_side: "front" | "back"
      medication_frequency: "daily" | "interval_hours" | "as_needed"
      medication_intake_status: "pending" | "taken" | "skipped" | "missed"
      user_role: "admin" | "elder" | "family_member" | "caregiver"
      vital_sign_alert_rule:
        | "sistolica_alta"
        | "diastolica_alta"
        | "glucemia_baja"
        | "glucemia_alta"
        | "peso_variacion"
      vital_sign_type: "blood_pressure" | "glucose" | "weight"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      access_action: [
        "login",
        "logout",
        "ver_perfil",
        "ver_documento",
        "descargar_archivo",
        "ver_credencial",
        "exportar_ficha",
        "otorgar_permiso",
        "revocar_permiso",
      ],
      appointment_status: ["pending", "confirmed", "completed", "cancelled"],
      display_density: ["grande", "chica"],
      doc_category: [
        "laboratory",
        "imaging",
        "prescription",
        "consultation",
        "other",
      ],
      insurance_card_side: ["front", "back"],
      medication_frequency: ["daily", "interval_hours", "as_needed"],
      medication_intake_status: ["pending", "taken", "skipped", "missed"],
      user_role: ["admin", "elder", "family_member", "caregiver"],
      vital_sign_alert_rule: [
        "sistolica_alta",
        "diastolica_alta",
        "glucemia_baja",
        "glucemia_alta",
        "peso_variacion",
      ],
      vital_sign_type: ["blood_pressure", "glucose", "weight"],
    },
  },
} as const

