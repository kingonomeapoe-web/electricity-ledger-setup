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
      apartments: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          property_id: string
          unit_name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          property_id: string
          unit_name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          property_id?: string
          unit_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "apartments_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          event_hash: string | null
          event_type: string
          id: string
          metadata: Json
          new_data: Json | null
          old_data: Json | null
          previous_hash: string | null
          property_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          event_hash?: string | null
          event_type: string
          id?: string
          metadata?: Json
          new_data?: Json | null
          old_data?: Json | null
          previous_hash?: string | null
          property_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          event_hash?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          new_data?: Json | null
          old_data?: Json | null
          previous_hash?: string | null
          property_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      central_meter_loads: {
        Row: {
          amount_paid: number
          central_balance_after_kwh: number
          central_balance_before_kwh: number
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          load_evidence_id: string | null
          loaded_at: string
          loaded_by: string
          meter_id: string
          notes: string | null
          payment_submission_id: string
          property_id: string
          reading_evidence_id: string | null
          status: string
          token_fingerprint: string | null
          token_last4: string | null
          units_loaded_kwh: number
        }
        Insert: {
          amount_paid: number
          central_balance_after_kwh: number
          central_balance_before_kwh: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          load_evidence_id?: string | null
          loaded_at?: string
          loaded_by: string
          meter_id: string
          notes?: string | null
          payment_submission_id: string
          property_id: string
          reading_evidence_id?: string | null
          status?: string
          token_fingerprint?: string | null
          token_last4?: string | null
          units_loaded_kwh: number
        }
        Update: {
          amount_paid?: number
          central_balance_after_kwh?: number
          central_balance_before_kwh?: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          load_evidence_id?: string | null
          loaded_at?: string
          loaded_by?: string
          meter_id?: string
          notes?: string | null
          payment_submission_id?: string
          property_id?: string
          reading_evidence_id?: string | null
          status?: string
          token_fingerprint?: string | null
          token_last4?: string | null
          units_loaded_kwh?: number
        }
        Relationships: [
          {
            foreignKeyName: "central_meter_loads_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "central_meter_loads_load_evidence_id_fkey"
            columns: ["load_evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "central_meter_loads_loaded_by_fkey"
            columns: ["loaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "central_meter_loads_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "central_meter_loads_payment_submission_id_fkey"
            columns: ["payment_submission_id"]
            isOneToOne: true
            referencedRelation: "payment_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "central_meter_loads_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "central_meter_loads_reading_evidence_id_fkey"
            columns: ["reading_evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence_files"
            referencedColumns: ["id"]
          },
        ]
      }
      central_meter_readings: {
        Row: {
          captured_at: string
          captured_by: string
          confirmed_at: string | null
          confirmed_by: string | null
          confirmed_value_kwh: number | null
          created_at: string
          evidence_id: string | null
          id: string
          meter_id: string
          notes: string | null
          ocr_confidence: number | null
          ocr_value_kwh: number | null
          reading_kind: string
          reading_kwh: number
          source: Database["public"]["Enums"]["reading_source"]
        }
        Insert: {
          captured_at?: string
          captured_by: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_value_kwh?: number | null
          created_at?: string
          evidence_id?: string | null
          id?: string
          meter_id: string
          notes?: string | null
          ocr_confidence?: number | null
          ocr_value_kwh?: number | null
          reading_kind?: string
          reading_kwh: number
          source?: Database["public"]["Enums"]["reading_source"]
        }
        Update: {
          captured_at?: string
          captured_by?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_value_kwh?: number | null
          created_at?: string
          evidence_id?: string | null
          id?: string
          meter_id?: string
          notes?: string | null
          ocr_confidence?: number | null
          ocr_value_kwh?: number | null
          reading_kind?: string
          reading_kwh?: number
          source?: Database["public"]["Enums"]["reading_source"]
        }
        Relationships: [
          {
            foreignKeyName: "central_meter_readings_captured_by_fkey"
            columns: ["captured_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "central_meter_readings_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "central_meter_readings_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "central_meter_readings_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_files: {
        Row: {
          captured_at: string | null
          created_at: string
          evidence_type: Database["public"]["Enums"]["evidence_type"]
          file_size_bytes: number | null
          id: string
          mime_type: string | null
          original_filename: string | null
          property_id: string
          sha256_hash: string | null
          storage_bucket: string
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          captured_at?: string | null
          created_at?: string
          evidence_type: Database["public"]["Enums"]["evidence_type"]
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          original_filename?: string | null
          property_id: string
          sha256_hash?: string | null
          storage_bucket?: string
          storage_path: string
          uploaded_by: string
        }
        Update: {
          captured_at?: string | null
          created_at?: string
          evidence_type?: Database["public"]["Enums"]["evidence_type"]
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          original_filename?: string | null
          property_id?: string
          sha256_hash?: string | null
          storage_bucket?: string
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_files_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_accounts: {
        Row: {
          created_at: string
          id: string
          resident_account_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          resident_account_id: string
        }
        Update: {
          created_at?: string
          id?: string
          resident_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_accounts_resident_account_id_fkey"
            columns: ["resident_account_id"]
            isOneToOne: true
            referencedRelation: "resident_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_transactions: {
        Row: {
          amount: number | null
          apartment_id: string
          balance_after_kwh: number
          balance_before_kwh: number
          created_at: string
          created_by: string
          description: string | null
          id: string
          ledger_account_id: string
          property_id: string
          resident_id: string
          source_id: string | null
          source_type: string
          transaction_type: Database["public"]["Enums"]["ledger_transaction_type"]
          units_kwh: number
        }
        Insert: {
          amount?: number | null
          apartment_id: string
          balance_after_kwh: number
          balance_before_kwh: number
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          ledger_account_id: string
          property_id: string
          resident_id: string
          source_id?: string | null
          source_type: string
          transaction_type: Database["public"]["Enums"]["ledger_transaction_type"]
          units_kwh: number
        }
        Update: {
          amount?: number | null
          apartment_id?: string
          balance_after_kwh?: number
          balance_before_kwh?: number
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          ledger_account_id?: string
          property_id?: string
          resident_id?: string
          source_id?: string | null
          source_type?: string
          transaction_type?: Database["public"]["Enums"]["ledger_transaction_type"]
          units_kwh?: number
        }
        Relationships: [
          {
            foreignKeyName: "ledger_transactions_apartment_id_fkey"
            columns: ["apartment_id"]
            isOneToOne: false
            referencedRelation: "apartments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_transactions_ledger_account_id_fkey"
            columns: ["ledger_account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_transactions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_transactions_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meters: {
        Row: {
          active: boolean
          created_at: string
          id: string
          identifier: string
          meter_number: string | null
          meter_type: Database["public"]["Enums"]["meter_type"]
          property_id: string
          provider: string | null
          tariff_class: string | null
          tariff_rate: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          identifier: string
          meter_number?: string | null
          meter_type: Database["public"]["Enums"]["meter_type"]
          property_id: string
          provider?: string | null
          tariff_class?: string | null
          tariff_rate?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          identifier?: string
          meter_number?: string | null
          meter_type?: Database["public"]["Enums"]["meter_type"]
          property_id?: string
          provider?: string | null
          tariff_class?: string | null
          tariff_rate?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meters_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          delivered_at: string | null
          event_type: string
          id: string
          message: string
          property_id: string | null
          provider_message_id: string | null
          provider_response: Json | null
          read_at: string | null
          recipient_id: string
          related_id: string | null
          related_type: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          title: string | null
        }
        Insert: {
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          delivered_at?: string | null
          event_type: string
          id?: string
          message: string
          property_id?: string | null
          provider_message_id?: string | null
          provider_response?: Json | null
          read_at?: string | null
          recipient_id: string
          related_id?: string | null
          related_type?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          title?: string | null
        }
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          delivered_at?: string | null
          event_type?: string
          id?: string
          message?: string
          property_id?: string | null
          provider_message_id?: string | null
          provider_response?: Json | null
          read_at?: string | null
          recipient_id?: string
          related_id?: string | null
          related_type?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ocr_extractions: {
        Row: {
          amount: number | null
          amount_paid: number | null
          beneficiary_id: string | null
          confidence: number | null
          created_at: string
          customer_name: string | null
          error_message: string | null
          evidence_id: string
          field_confidence: Json
          id: string
          meter_number: string | null
          model: string | null
          payment_submission_id: string | null
          processed_at: string | null
          provider: string | null
          raw_text: string | null
          service_address: string | null
          session_id: string | null
          status: Database["public"]["Enums"]["ocr_status"]
          structured_data: Json
          tariff_class: string | null
          tariff_rate: number | null
          token_ciphertext: string | null
          token_last4: string | null
          transaction_date: string | null
          transaction_number: string | null
          transaction_reference: string | null
          transaction_time: string | null
          units_kwh: number | null
        }
        Insert: {
          amount?: number | null
          amount_paid?: number | null
          beneficiary_id?: string | null
          confidence?: number | null
          created_at?: string
          customer_name?: string | null
          error_message?: string | null
          evidence_id: string
          field_confidence?: Json
          id?: string
          meter_number?: string | null
          model?: string | null
          payment_submission_id?: string | null
          processed_at?: string | null
          provider?: string | null
          raw_text?: string | null
          service_address?: string | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["ocr_status"]
          structured_data?: Json
          tariff_class?: string | null
          tariff_rate?: number | null
          token_ciphertext?: string | null
          token_last4?: string | null
          transaction_date?: string | null
          transaction_number?: string | null
          transaction_reference?: string | null
          transaction_time?: string | null
          units_kwh?: number | null
        }
        Update: {
          amount?: number | null
          amount_paid?: number | null
          beneficiary_id?: string | null
          confidence?: number | null
          created_at?: string
          customer_name?: string | null
          error_message?: string | null
          evidence_id?: string
          field_confidence?: Json
          id?: string
          meter_number?: string | null
          model?: string | null
          payment_submission_id?: string | null
          processed_at?: string | null
          provider?: string | null
          raw_text?: string | null
          service_address?: string | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["ocr_status"]
          structured_data?: Json
          tariff_class?: string | null
          tariff_rate?: number | null
          token_ciphertext?: string | null
          token_last4?: string | null
          transaction_date?: string | null
          transaction_number?: string | null
          transaction_reference?: string | null
          transaction_time?: string | null
          units_kwh?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ocr_extractions_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocr_extractions_payment_submission_id_fkey"
            columns: ["payment_submission_id"]
            isOneToOne: false
            referencedRelation: "payment_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_submissions: {
        Row: {
          apartment_id: string
          created_at: string
          duplicate_of: string | null
          evidence_id: string
          id: string
          property_id: string
          rejection_reason: string | null
          resident_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["payment_status"]
          submitted_at: string
          updated_at: string
        }
        Insert: {
          apartment_id: string
          created_at?: string
          duplicate_of?: string | null
          evidence_id: string
          id?: string
          property_id: string
          rejection_reason?: string | null
          resident_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          apartment_id?: string
          created_at?: string
          duplicate_of?: string | null
          evidence_id?: string
          id?: string
          property_id?: string
          rejection_reason?: string | null
          resident_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_submissions_apartment_id_fkey"
            columns: ["apartment_id"]
            isOneToOne: false
            referencedRelation: "apartments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_submissions_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "payment_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_submissions_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_submissions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_submissions_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_submissions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          full_name: string
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          full_name: string
          id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          activated_at: string | null
          active: boolean
          address: string | null
          created_at: string
          created_by: string | null
          currency_code: string
          description: string | null
          id: string
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          active?: boolean
          address?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          description?: string | null
          id?: string
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          active?: boolean
          address?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          description?: string | null
          id?: string
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      property_members: {
        Row: {
          active: boolean
          apartment_id: string | null
          created_at: string
          id: string
          property_id: string
          role: Database["public"]["Enums"]["property_member_role"]
          user_id: string
        }
        Insert: {
          active?: boolean
          apartment_id?: string | null
          created_at?: string
          id?: string
          property_id: string
          role: Database["public"]["Enums"]["property_member_role"]
          user_id: string
        }
        Update: {
          active?: boolean
          apartment_id?: string | null
          created_at?: string
          id?: string
          property_id?: string
          role?: Database["public"]["Enums"]["property_member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_members_apartment_id_fkey"
            columns: ["apartment_id"]
            isOneToOne: false
            referencedRelation: "apartments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_members_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_items: {
        Row: {
          apartment_id: string
          closing_reading_kwh: number
          consumption_kwh: number
          created_at: string
          id: string
          opening_reading_kwh: number
          reconciliation_id: string
          submeter_id: string
        }
        Insert: {
          apartment_id: string
          closing_reading_kwh: number
          consumption_kwh: number
          created_at?: string
          id?: string
          opening_reading_kwh: number
          reconciliation_id: string
          submeter_id: string
        }
        Update: {
          apartment_id?: string
          closing_reading_kwh?: number
          consumption_kwh?: number
          created_at?: string
          id?: string
          opening_reading_kwh?: number
          reconciliation_id?: string
          submeter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_items_apartment_id_fkey"
            columns: ["apartment_id"]
            isOneToOne: false
            referencedRelation: "apartments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_items_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "reconciliations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_items_submeter_id_fkey"
            columns: ["submeter_id"]
            isOneToOne: false
            referencedRelation: "submeters"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliations: {
        Row: {
          central_balance_end_kwh: number
          central_balance_start_kwh: number
          central_consumption_kwh: number
          classification:
            | Database["public"]["Enums"]["reconciliation_classification"]
            | null
          created_at: string
          created_by: string
          explanation: string | null
          id: string
          meter_id: string
          period_end: string
          period_start: string
          property_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["reconciliation_status"]
          submeter_consumption_kwh: number
          tolerance_kwh: number
          total_credits_kwh: number
          variance_kwh: number
        }
        Insert: {
          central_balance_end_kwh: number
          central_balance_start_kwh: number
          central_consumption_kwh?: number
          classification?:
            | Database["public"]["Enums"]["reconciliation_classification"]
            | null
          created_at?: string
          created_by: string
          explanation?: string | null
          id?: string
          meter_id: string
          period_end: string
          period_start: string
          property_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["reconciliation_status"]
          submeter_consumption_kwh?: number
          tolerance_kwh?: number
          total_credits_kwh?: number
          variance_kwh?: number
        }
        Update: {
          central_balance_end_kwh?: number
          central_balance_start_kwh?: number
          central_consumption_kwh?: number
          classification?:
            | Database["public"]["Enums"]["reconciliation_classification"]
            | null
          created_at?: string
          created_by?: string
          explanation?: string | null
          id?: string
          meter_id?: string
          period_end?: string
          period_start?: string
          property_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["reconciliation_status"]
          submeter_consumption_kwh?: number
          tolerance_kwh?: number
          total_credits_kwh?: number
          variance_kwh?: number
        }
        Relationships: [
          {
            foreignKeyName: "reconciliations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliations_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliations_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_accounts: {
        Row: {
          active: boolean
          apartment_id: string
          created_at: string
          id: string
          property_id: string
          resident_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          apartment_id: string
          created_at?: string
          id?: string
          property_id: string
          resident_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          apartment_id?: string
          created_at?: string
          id?: string
          property_id?: string
          resident_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resident_accounts_apartment_id_fkey"
            columns: ["apartment_id"]
            isOneToOne: false
            referencedRelation: "apartments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_accounts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_accounts_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      submeter_readings: {
        Row: {
          captured_at: string
          captured_by: string
          confirmed_at: string | null
          confirmed_by: string | null
          confirmed_value_kwh: number | null
          created_at: string
          evidence_id: string | null
          id: string
          notes: string | null
          ocr_confidence: number | null
          ocr_value_kwh: number | null
          previous_reading_kwh: number | null
          reading_kind: string
          reading_kwh: number
          source: Database["public"]["Enums"]["reading_source"]
          submeter_id: string
          units_consumed_kwh: number | null
        }
        Insert: {
          captured_at?: string
          captured_by: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_value_kwh?: number | null
          created_at?: string
          evidence_id?: string | null
          id?: string
          notes?: string | null
          ocr_confidence?: number | null
          ocr_value_kwh?: number | null
          previous_reading_kwh?: number | null
          reading_kind?: string
          reading_kwh: number
          source?: Database["public"]["Enums"]["reading_source"]
          submeter_id: string
          units_consumed_kwh?: number | null
        }
        Update: {
          captured_at?: string
          captured_by?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_value_kwh?: number | null
          created_at?: string
          evidence_id?: string | null
          id?: string
          notes?: string | null
          ocr_confidence?: number | null
          ocr_value_kwh?: number | null
          previous_reading_kwh?: number | null
          reading_kind?: string
          reading_kwh?: number
          source?: Database["public"]["Enums"]["reading_source"]
          submeter_id?: string
          units_consumed_kwh?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "submeter_readings_captured_by_fkey"
            columns: ["captured_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submeter_readings_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submeter_readings_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submeter_readings_submeter_id_fkey"
            columns: ["submeter_id"]
            isOneToOne: false
            referencedRelation: "submeters"
            referencedColumns: ["id"]
          },
        ]
      }
      submeters: {
        Row: {
          active: boolean
          apartment_id: string
          created_at: string
          id: string
          identifier: string
          meter_number: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          apartment_id: string
          created_at?: string
          id?: string
          identifier: string
          meter_number?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          apartment_id?: string
          created_at?: string
          id?: string
          identifier?: string
          meter_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submeters_apartment_id_fkey"
            columns: ["apartment_id"]
            isOneToOne: true
            referencedRelation: "apartments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      classify_reconciliation_variance: {
        Args: {
          p_classification: Database["public"]["Enums"]["reconciliation_classification"]
          p_explanation: string
          p_reconciliation_id: string
          p_status?: Database["public"]["Enums"]["reconciliation_status"]
        }
        Returns: string
      }
      confirm_central_meter_credit: {
        Args: {
          p_central_balance_after_kwh: number
          p_central_balance_before_kwh: number
          p_load_evidence_id?: string
          p_notes?: string
          p_payment_submission_id: string
          p_reading_evidence_id: string
          p_units_loaded_kwh: number
        }
        Returns: string
      }
      create_ledger_adjustment: {
        Args: {
          p_explanation: string
          p_original_transaction_id?: string
          p_property_id: string
          p_reason: string
          p_resident_id: string
          p_transaction_type?: Database["public"]["Enums"]["ledger_transaction_type"]
          p_units_kwh: number
        }
        Returns: string
      }
      is_admin: { Args: never; Returns: boolean }
      is_property_admin: { Args: { p_property_id: string }; Returns: boolean }
      is_property_resident: {
        Args: { p_property_id: string }
        Returns: boolean
      }
      log_admin_audit: {
        Args: {
          p_entity_id?: string
          p_entity_type: string
          p_event_type: string
          p_metadata?: Json
          p_new_data?: Json
          p_old_data?: Json
          p_property_id: string
        }
        Returns: string
      }
      post_confirmed_submeter_consumption: {
        Args: { p_submeter_reading_id: string }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "resident"
      evidence_type:
        | "payment_receipt"
        | "central_meter_reading"
        | "central_meter_load"
        | "submeter_reading"
      ledger_transaction_type:
        | "opening_balance"
        | "credit"
        | "consumption"
        | "adjustment"
        | "reversal"
        | "correction"
      meter_type: "prepaid_main" | "submeter"
      notification_channel: "sms" | "whatsapp" | "in_app"
      notification_status: "queued" | "sent" | "delivered" | "failed" | "read"
      ocr_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
        | "needs_review"
      payment_status:
        | "uploaded"
        | "ocr_processed"
        | "pending_approval"
        | "approved_for_loading"
        | "loaded"
        | "credited"
        | "rejected"
        | "duplicate"
        | "disputed"
        | "correction_required"
      property_member_role: "owner_admin" | "admin" | "resident"
      reading_source: "manual" | "ocr_confirmed"
      reconciliation_classification:
        | "common_area"
        | "meter_loss"
        | "timing_difference"
        | "meter_issue"
        | "data_entry_error"
        | "unmetered_load"
        | "suspected_tampering"
        | "other"
      reconciliation_status:
        | "pending"
        | "balanced"
        | "variance"
        | "reviewed"
        | "closed"
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
      app_role: ["admin", "resident"],
      evidence_type: [
        "payment_receipt",
        "central_meter_reading",
        "central_meter_load",
        "submeter_reading",
      ],
      ledger_transaction_type: [
        "opening_balance",
        "credit",
        "consumption",
        "adjustment",
        "reversal",
        "correction",
      ],
      meter_type: ["prepaid_main", "submeter"],
      notification_channel: ["sms", "whatsapp", "in_app"],
      notification_status: ["queued", "sent", "delivered", "failed", "read"],
      ocr_status: [
        "pending",
        "processing",
        "completed",
        "failed",
        "needs_review",
      ],
      payment_status: [
        "uploaded",
        "ocr_processed",
        "pending_approval",
        "approved_for_loading",
        "loaded",
        "credited",
        "rejected",
        "duplicate",
        "disputed",
        "correction_required",
      ],
      property_member_role: ["owner_admin", "admin", "resident"],
      reading_source: ["manual", "ocr_confirmed"],
      reconciliation_classification: [
        "common_area",
        "meter_loss",
        "timing_difference",
        "meter_issue",
        "data_entry_error",
        "unmetered_load",
        "suspected_tampering",
        "other",
      ],
      reconciliation_status: [
        "pending",
        "balanced",
        "variance",
        "reviewed",
        "closed",
      ],
    },
  },
} as const
