// 自動生成ファイル。手で編集しない(Issue #45)。
//
// supabase/migrations/を適用した使い捨てSupabaseスタックから
// `npm run gen:types`で生成する。スキーマを変更したら再生成し、
// マイグレーションと同じコミットに含めること。ズレは`npm run gen:types:check`
// (CIでも実行)が検出する。

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
      activity_logs: {
        Row: {
          action: string
          actor_user_id: string
          household_id: string
          id: string
          idempotency_key: string | null
          next_task_occurrence_id: string | null
          occurred_at: string
          recorded_at: string
          task_occurrence_id: string
        }
        Insert: {
          action: string
          actor_user_id: string
          household_id: string
          id?: string
          idempotency_key?: string | null
          next_task_occurrence_id?: string | null
          occurred_at: string
          recorded_at?: string
          task_occurrence_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string
          household_id?: string
          id?: string
          idempotency_key?: string | null
          next_task_occurrence_id?: string | null
          occurred_at?: string
          recorded_at?: string
          task_occurrence_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_actor_household_fkey"
            columns: ["household_id", "actor_user_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
          {
            foreignKeyName: "activity_logs_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_next_task_occurrence_id_fkey"
            columns: ["next_task_occurrence_id"]
            isOneToOne: false
            referencedRelation: "task_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_occurrence_household_fkey"
            columns: ["task_occurrence_id", "household_id"]
            isOneToOne: false
            referencedRelation: "task_occurrences"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      external_links: {
        Row: {
          created_at: string
          household_id: string
          id: string
          managed_item_id: string
          url: string
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          managed_item_id: string
          url: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          managed_item_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_links_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_links_item_household_fkey"
            columns: ["managed_item_id", "household_id"]
            isOneToOne: false
            referencedRelation: "managed_items"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      household_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          expires_at: string
          household_id: string
          id: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          expires_at: string
          household_id: string
          id?: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          expires_at?: string
          household_id?: string
          id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_invitations_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      household_members: {
        Row: {
          created_at: string
          household_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      managed_items: {
        Row: {
          created_at: string
          household_id: string
          id: string
          kind: string
          name: string
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          kind: string
          name: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          kind?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "managed_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          nickname: string
          user_id: string
        }
        Insert: {
          created_at?: string
          nickname: string
          user_id?: string
        }
        Update: {
          created_at?: string
          nickname?: string
          user_id?: string
        }
        Relationships: []
      }
      task_occurrences: {
        Row: {
          created_at: string
          due_at: string
          household_id: string
          id: string
          scheduled_for: string
          status: string
          task_rule_id: string
        }
        Insert: {
          created_at?: string
          due_at: string
          household_id: string
          id?: string
          scheduled_for: string
          status?: string
          task_rule_id: string
        }
        Update: {
          created_at?: string
          due_at?: string
          household_id?: string
          id?: string
          scheduled_for?: string
          status?: string
          task_rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_occurrences_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_occurrences_rule_household_fkey"
            columns: ["task_rule_id", "household_id"]
            isOneToOne: false
            referencedRelation: "task_rules"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      task_rules: {
        Row: {
          created_at: string
          deadline_kind: string
          household_id: string
          id: string
          managed_item_id: string
          recommended_start_offset: number
          recommended_until_offset: number
          recurrence_basis: string
          title: string
          unresolved_policy: string
        }
        Insert: {
          created_at?: string
          deadline_kind?: string
          household_id: string
          id?: string
          managed_item_id: string
          recommended_start_offset: number
          recommended_until_offset: number
          recurrence_basis?: string
          title: string
          unresolved_policy?: string
        }
        Update: {
          created_at?: string
          deadline_kind?: string
          household_id?: string
          id?: string
          managed_item_id?: string
          recommended_start_offset?: number
          recommended_until_offset?: number
          recurrence_basis?: string
          title?: string
          unresolved_policy?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_rules_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_rules_item_household_fkey"
            columns: ["managed_item_id", "household_id"]
            isOneToOne: false
            referencedRelation: "managed_items"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_household_invitation: {
        Args: { invitation_token: string }
        Returns: {
          household_id: string
          membership_created: boolean
        }[]
      }
      complete_maintenance_task: {
        Args: {
          idempotency_key: string
          occurred_at?: string
          occurrence_id: string
        }
        Returns: string
      }
      create_first_household: {
        Args: { household_name: string }
        Returns: string
      }
      create_maintenance_task: {
        Args: {
          first_due_at: string
          first_scheduled_for: string
          item_id: string
          recommended_start_offset: number
          recommended_until_offset: number
          task_title: string
        }
        Returns: string
      }
      create_managed_item: {
        Args: { external_url?: string; item_kind: string; item_name: string }
        Returns: string
      }
      is_household_member: {
        Args: { target_household_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
