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
      users: {
        Row: {
          id: string
          username: string
          display_name: string | null
          avatar_url: string | null
          banner_color: string | null
          banner_url: string | null
          bio: string | null
          custom_tag: string | null
          status: 'online' | 'idle' | 'dnd' | 'invisible' | 'offline'
          status_message: string | null
          status_emoji: string | null
          status_expires_at: string | null
          last_heartbeat_at: string | null
          last_online_at: string | null
          discoverable: boolean
          appearance_settings: Json
          interests: string[]
          activity_visibility: 'public' | 'friends' | 'private'
          game_activity: Json | null
          onboarding_completed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          username: string
          display_name?: string | null
          avatar_url?: string | null
          banner_color?: string | null
          banner_url?: string | null
          bio?: string | null
          custom_tag?: string | null
          status?: 'online' | 'idle' | 'dnd' | 'invisible' | 'offline'
          status_message?: string | null
          status_emoji?: string | null
          status_expires_at?: string | null
          last_heartbeat_at?: string | null
          last_online_at?: string | null
          discoverable?: boolean
          appearance_settings?: Json | null
          interests?: string[]
          activity_visibility?: 'public' | 'friends' | 'private'
          game_activity?: Json | null
          onboarding_completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          username?: string
          display_name?: string | null
          avatar_url?: string | null
          banner_color?: string | null
          banner_url?: string | null
          bio?: string | null
          custom_tag?: string | null
          status?: 'online' | 'idle' | 'dnd' | 'invisible' | 'offline'
          status_message?: string | null
          status_emoji?: string | null
          status_expires_at?: string | null
          last_heartbeat_at?: string | null
          last_online_at?: string | null
          discoverable?: boolean
          appearance_settings?: Json | null
          interests?: string[]
          activity_visibility?: 'public' | 'friends' | 'private'
          game_activity?: Json | null
          onboarding_completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_pinned_items: {
        Row: {
          id: string
          user_id: string
          pin_type: 'message' | 'channel' | 'file' | 'link'
          label: string
          sublabel: string | null
          ref_id: string | null
          url: string | null
          position: number
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          pin_type: 'message' | 'channel' | 'file' | 'link'
          label: string
          sublabel?: string | null
          ref_id?: string | null
          url?: string | null
          position?: number
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          pin_type?: 'message' | 'channel' | 'file' | 'link'
          label?: string
          sublabel?: string | null
          ref_id?: string | null
          url?: string | null
          position?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_pinned_items_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      user_activity_log: {
        Row: {
          id: string
          user_id: string
          event_type: 'message_posted' | 'file_uploaded' | 'server_joined' | 'reaction_added' | 'channel_created'
          summary: string
          ref_id: string | null
          ref_type: 'channel' | 'server' | 'message' | 'file' | null
          ref_label: string | null
          ref_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          event_type: 'message_posted' | 'file_uploaded' | 'server_joined' | 'reaction_added' | 'channel_created'
          summary: string
          ref_id?: string | null
          ref_type?: 'channel' | 'server' | 'message' | 'file' | null
          ref_label?: string | null
          ref_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          event_type?: 'message_posted' | 'file_uploaded' | 'server_joined' | 'reaction_added' | 'channel_created'
          summary?: string
          ref_id?: string | null
          ref_type?: 'channel' | 'server' | 'message' | 'file' | null
          ref_label?: string | null
          ref_url?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_activity_log_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      user_connections: {
        Row: {
          id: string
          user_id: string
          provider: 'steam' | 'github' | 'x' | 'twitch' | 'youtube' | 'reddit' | 'website'
          provider_user_id: string
          username: string | null
          display_name: string | null
          profile_url: string | null
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          provider: 'steam' | 'github' | 'x' | 'twitch' | 'youtube' | 'reddit' | 'website'
          provider_user_id: string
          username?: string | null
          display_name?: string | null
          profile_url?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          provider?: 'steam' | 'github' | 'x' | 'twitch' | 'youtube' | 'reddit' | 'website'
          provider_user_id?: string
          username?: string | null
          display_name?: string | null
          profile_url?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_connections_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      user_notification_preferences: {
        Row: {
          user_id: string
          mention_notifications: boolean
          reply_notifications: boolean
          friend_request_notifications: boolean
          server_invite_notifications: boolean
          system_notifications: boolean
          sound_enabled: boolean
          notification_volume: number
          suppress_everyone: boolean
          suppress_role_mentions: boolean
          quiet_hours_enabled: boolean
          quiet_hours_start: string
          quiet_hours_end: string
          quiet_hours_timezone: string
          push_notifications: boolean
          show_message_preview: boolean
          show_unread_badge: boolean
          updated_at: string
        }
        Insert: {
          user_id: string
          mention_notifications?: boolean
          reply_notifications?: boolean
          friend_request_notifications?: boolean
          server_invite_notifications?: boolean
          system_notifications?: boolean
          sound_enabled?: boolean
          notification_volume?: number
          suppress_everyone?: boolean
          suppress_role_mentions?: boolean
          quiet_hours_enabled?: boolean
          quiet_hours_start?: string
          quiet_hours_end?: string
          quiet_hours_timezone?: string
          push_notifications?: boolean
          show_message_preview?: boolean
          show_unread_badge?: boolean
          updated_at?: string
        }
        Update: {
          user_id?: string
          mention_notifications?: boolean
          reply_notifications?: boolean
          friend_request_notifications?: boolean
          server_invite_notifications?: boolean
          system_notifications?: boolean
          sound_enabled?: boolean
          notification_volume?: number
          suppress_everyone?: boolean
          suppress_role_mentions?: boolean
          quiet_hours_enabled?: boolean
          quiet_hours_start?: string
          quiet_hours_end?: string
          quiet_hours_timezone?: string
          push_notifications?: boolean
          show_message_preview?: boolean
          show_unread_badge?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_notification_preferences_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      app_curated_sections: {
        Row: {
          id: string
          slug: string
          title: string
          description: string | null
          sort_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          slug: string
          title: string
          description?: string | null
          sort_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          slug?: string
          title?: string
          description?: string | null
          sort_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_curated_entries: {
        Row: {
          id: string
          section_id: string
          app_id: string
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          section_id: string
          app_id: string
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          section_id?: string
          app_id?: string
          sort_order?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'app_curated_entries_section_id_fkey'
            columns: ['section_id']
            isOneToOne: false
            referencedRelation: 'app_curated_sections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'app_curated_entries_app_id_fkey'
            columns: ['app_id']
            isOneToOne: false
            referencedRelation: 'app_catalog'
            referencedColumns: ['id']
          },
        ]
      }
      servers: {
        Row: {
          id: string
          name: string
          icon_url: string | null
          owner_id: string
          invite_code: string
          vanity_url: string | null
          description: string | null
          is_public: boolean
          member_count: number
          verification_level: number
          explicit_content_filter: number
          default_message_notifications: number
          screening_enabled: boolean
          automod_dry_run: boolean
          automod_emergency_disable: boolean
          join_role_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          icon_url?: string | null
          owner_id: string
          invite_code?: string
          vanity_url?: string | null
          description?: string | null
          is_public?: boolean
          member_count?: number
          verification_level?: number
          explicit_content_filter?: number
          default_message_notifications?: number
          screening_enabled?: boolean
          automod_dry_run?: boolean
          automod_emergency_disable?: boolean
          join_role_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          icon_url?: string | null
          owner_id?: string
          invite_code?: string
          vanity_url?: string | null
          description?: string | null
          is_public?: boolean
          member_count?: number
          verification_level?: number
          explicit_content_filter?: number
          default_message_notifications?: number
          screening_enabled?: boolean
          automod_dry_run?: boolean
          automod_emergency_disable?: boolean
          join_role_id?: string | null
          created_at?: string
        }
        Relationships: []
      }
      ai_provider_configs: {
        Row: {
          id: string
          server_id: string
          provider: string
          label: string | null
          api_key: string | null
          base_url: string | null
          model: string | null
          is_default: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          server_id: string
          provider: string
          label?: string | null
          api_key?: string | null
          base_url?: string | null
          model?: string | null
          is_default?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          provider?: string
          label?: string | null
          api_key?: string | null
          base_url?: string | null
          model?: string | null
          is_default?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_function_routing: {
        Row: {
          server_id: string
          ai_function: string
          provider_config_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          server_id: string
          ai_function: string
          provider_config_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          server_id?: string
          ai_function?: string
          provider_config_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_personas: {
        Row: {
          id: string
          server_id: string
          name: string
          avatar_url: string | null
          system_prompt: string
          description: string | null
          provider_config_id: string | null
          allowed_channel_ids: string[]
          is_active: boolean
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          server_id: string
          name: string
          avatar_url?: string | null
          system_prompt: string
          description?: string | null
          provider_config_id?: string | null
          allowed_channel_ids?: string[]
          is_active?: boolean
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          name?: string
          avatar_url?: string | null
          system_prompt?: string
          description?: string | null
          provider_config_id?: string | null
          allowed_channel_ids?: string[]
          is_active?: boolean
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      server_secrets: {
        Row: {
          server_id: string
          gemini_api_key: string | null
          updated_at: string
        }
        Insert: {
          server_id: string
          gemini_api_key?: string | null
          updated_at?: string
        }
        Update: {
          server_id?: string
          gemini_api_key?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      screening_configs: {
        Row: {
          server_id: string
          title: string
          description: string | null
          rules_text: string
          require_acceptance: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          server_id: string
          title?: string
          description?: string | null
          rules_text?: string
          require_acceptance?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          server_id?: string
          title?: string
          description?: string | null
          rules_text?: string
          require_acceptance?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      member_screening: {
        Row: {
          server_id: string
          user_id: string
          accepted_at: string
        }
        Insert: {
          server_id: string
          user_id: string
          accepted_at?: string
        }
        Update: {
          server_id?: string
          user_id?: string
          accepted_at?: string
        }
        Relationships: []
      }
      member_timeouts: {
        Row: {
          server_id: string
          user_id: string
          timed_out_until: string
          moderator_id: string | null
          reason: string | null
          created_at: string
        }
        Insert: {
          server_id: string
          user_id: string
          timed_out_until: string
          moderator_id?: string | null
          reason?: string | null
          created_at?: string
        }
        Update: {
          server_id?: string
          user_id?: string
          timed_out_until?: string
          moderator_id?: string | null
          reason?: string | null
          created_at?: string
        }
        Relationships: []
      }
      automod_rules: {
        Row: {
          id: string
          server_id: string
          name: string
          trigger_type: 'keyword_filter' | 'regex_filter' | 'mention_spam' | 'link_spam' | 'rapid_message'
          config: Json
          conditions: Json
          actions: Json
          priority: number
          enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          server_id: string
          name: string
          trigger_type: 'keyword_filter' | 'regex_filter' | 'mention_spam' | 'link_spam' | 'rapid_message'
          config?: Json
          conditions?: Json
          actions?: Json
          priority?: number
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          name?: string
          trigger_type?: 'keyword_filter' | 'regex_filter' | 'mention_spam' | 'link_spam' | 'rapid_message'
          config?: Json
          conditions?: Json
          actions?: Json
          priority?: number
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      server_members: {
        Row: {
          server_id: string
          user_id: string
          nickname: string | null
          joined_at: string
          timeout_until: string | null
        }
        Insert: {
          server_id: string
          user_id: string
          nickname?: string | null
          joined_at?: string
          timeout_until?: string | null
        }
        Update: {
          server_id?: string
          user_id?: string
          nickname?: string | null
          joined_at?: string
          timeout_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "server_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "server_members_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          }
        ]
      }
      roles: {
        Row: {
          id: string
          server_id: string
          name: string
          color: string
          position: number
          permissions: number
          is_hoisted: boolean
          mentionable: boolean
          is_default: boolean
          created_at: string
        }
        Insert: {
          id?: string
          server_id: string
          name: string
          color?: string
          position?: number
          permissions?: number
          is_hoisted?: boolean
          mentionable?: boolean
          is_default?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          name?: string
          color?: string
          position?: number
          permissions?: number
          is_hoisted?: boolean
          mentionable?: boolean
          is_default?: boolean
          created_at?: string
        }
        Relationships: []
      }
      member_roles: {
        Row: {
          server_id: string
          user_id: string
          role_id: string
        }
        Insert: {
          server_id: string
          user_id: string
          role_id: string
        }
        Update: {
          server_id?: string
          user_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_roles_server_id_user_id_fkey"
            columns: ["server_id", "user_id"]
            isOneToOne: false
            referencedRelation: "server_members"
            referencedColumns: ["server_id", "user_id"]
          }
        ]
      }
      channels: {
        Row: {
          id: string
          server_id: string
          name: string
          type: 'text' | 'voice' | 'category' | 'forum' | 'stage' | 'announcement' | 'media'
          position: number
          topic: string | null
          parent_id: string | null
          slowmode_delay: number
          nsfw: boolean
          forum_guidelines: string | null
          stream_url: string | null
          last_post_at: string | null
          expires_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          server_id: string
          name: string
          type?: 'text' | 'voice' | 'category' | 'forum' | 'stage' | 'announcement' | 'media'
          position?: number
          topic?: string | null
          parent_id?: string | null
          slowmode_delay?: number
          nsfw?: boolean
          forum_guidelines?: string | null
          stream_url?: string | null
          last_post_at?: string | null
          expires_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          name?: string
          type?: 'text' | 'voice' | 'category' | 'forum' | 'stage' | 'announcement' | 'media'
          position?: number
          topic?: string | null
          parent_id?: string | null
          slowmode_delay?: number
          nsfw?: boolean
          forum_guidelines?: string | null
          stream_url?: string | null
          last_post_at?: string | null
          expires_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          id: string
          channel_id: string
          author_id: string
          content: string | null
          client_nonce: string | null
          edited_at: string | null
          deleted_at: string | null
          reply_to_id: string | null
          thread_id: string | null
          mentions: string[]
          mention_everyone: boolean
          pinned: boolean
          pinned_at: string | null
          pinned_by: string | null
          webhook_id: string | null
          webhook_display_name: string | null
          webhook_avatar_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          channel_id: string
          author_id: string
          content?: string | null
          client_nonce?: string | null
          edited_at?: string | null
          deleted_at?: string | null
          reply_to_id?: string | null
          thread_id?: string | null
          mentions?: string[]
          mention_everyone?: boolean
          pinned?: boolean
          pinned_at?: string | null
          pinned_by?: string | null
          webhook_id?: string | null
          webhook_display_name?: string | null
          webhook_avatar_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          channel_id?: string
          author_id?: string
          content?: string | null
          client_nonce?: string | null
          edited_at?: string | null
          deleted_at?: string | null
          reply_to_id?: string | null
          thread_id?: string | null
          mentions?: string[]
          mention_everyone?: boolean
          pinned?: boolean
          pinned_at?: string | null
          pinned_by?: string | null
          webhook_id?: string | null
          webhook_display_name?: string | null
          webhook_avatar_url?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          }
        ]
      }
      attachments: {
        Row: {
          id: string
          message_id: string
          url: string
          filename: string
          size: number
          content_type: string
          width: number | null
          height: number | null
          storage_path: string | null
          scan_state: "pending_scan" | "clean" | "quarantined" | "failed_scan"
          scan_result: Json | null
          scan_started_at: string | null
          scanned_at: string | null
          quarantined_at: string | null
          quarantined_reason: string | null
          scan_failure_reason: string | null
          released_by: string | null
          released_at: string | null
          created_at: string
          expires_at: string | null
          last_accessed_at: string | null
          purged_at: string | null
          lifetime_days: number | null
          decay_cost: number | null
          blur_hash: string | null
          variants: Json | null
          processing_state: "pending" | "processing" | "completed" | "failed" | null
        }
        Insert: {
          id?: string
          message_id: string
          url: string
          filename: string
          size: number
          content_type: string
          width?: number | null
          height?: number | null
          storage_path?: string | null
          scan_state?: "pending_scan" | "clean" | "quarantined" | "failed_scan"
          scan_result?: Json | null
          scan_started_at?: string | null
          scanned_at?: string | null
          quarantined_at?: string | null
          quarantined_reason?: string | null
          scan_failure_reason?: string | null
          released_by?: string | null
          released_at?: string | null
          created_at?: string
          expires_at?: string | null
          last_accessed_at?: string | null
          purged_at?: string | null
          lifetime_days?: number | null
          decay_cost?: number | null
          blur_hash?: string | null
          variants?: Json | null
          processing_state?: "pending" | "processing" | "completed" | "failed" | null
        }
        Update: {
          id?: string
          message_id?: string
          url?: string
          filename?: string
          size?: number
          content_type?: string
          width?: number | null
          height?: number | null
          storage_path?: string | null
          scan_state?: "pending_scan" | "clean" | "quarantined" | "failed_scan"
          scan_result?: Json | null
          scan_started_at?: string | null
          scanned_at?: string | null
          quarantined_at?: string | null
          quarantined_reason?: string | null
          scan_failure_reason?: string | null
          released_by?: string | null
          released_at?: string | null
          created_at?: string
          expires_at?: string | null
          last_accessed_at?: string | null
          purged_at?: string | null
          lifetime_days?: number | null
          decay_cost?: number | null
          blur_hash?: string | null
          variants?: Json | null
          processing_state?: "pending" | "processing" | "completed" | "failed" | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          }
        ]
      }
      attachment_scan_metrics: {
        Row: {
          id: string
          attachment_id: string
          server_id: string | null
          metric_key: string
          metric_value: number
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          attachment_id: string
          server_id?: string | null
          metric_key: string
          metric_value: number
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          attachment_id?: string
          server_id?: string | null
          metric_key?: string
          metric_value?: number
          metadata?: Json | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachment_scan_metrics_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachment_scan_metrics_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          }
        ]
      }
      reactions: {
        Row: {
          message_id: string
          user_id: string
          emoji: string
          created_at: string
        }
        Insert: {
          message_id: string
          user_id: string
          emoji: string
          created_at?: string
        }
        Update: {
          message_id?: string
          user_id?: string
          emoji?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          }
        ]
      }
      direct_messages: {
        Row: {
          id: string
          sender_id: string
          receiver_id: string | null
          dm_channel_id: string | null
          content: string | null
          created_at: string
          read_at: string | null
          edited_at: string | null
          deleted_at: string | null
        }
        Insert: {
          id?: string
          sender_id: string
          receiver_id?: string | null
          dm_channel_id?: string | null
          content?: string | null
          created_at?: string
          read_at?: string | null
          edited_at?: string | null
          deleted_at?: string | null
        }
        Update: {
          id?: string
          sender_id?: string
          receiver_id?: string | null
          dm_channel_id?: string | null
          content?: string | null
          created_at?: string
          read_at?: string | null
          edited_at?: string | null
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "direct_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      server_bans: {
        Row: {
          server_id: string
          user_id: string
          banned_by: string | null
          reason: string | null
          banned_at: string
        }
        Insert: {
          server_id: string
          user_id: string
          banned_by?: string | null
          reason?: string | null
          banned_at?: string
        }
        Update: {
          server_id?: string
          user_id?: string
          banned_by?: string | null
          reason?: string | null
          banned_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "server_bans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "server_bans_banned_by_fkey"
            columns: ["banned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      invites: {
        Row: {
          code: string
          server_id: string
          channel_id: string | null
          created_by: string | null
          max_uses: number | null
          uses: number
          expires_at: string | null
          temporary: boolean
          created_at: string
        }
        Insert: {
          code: string
          server_id: string
          channel_id?: string | null
          created_by?: string | null
          max_uses?: number | null
          uses?: number
          expires_at?: string | null
          temporary?: boolean
          created_at?: string
        }
        Update: {
          code?: string
          server_id?: string
          channel_id?: string | null
          created_by?: string | null
          max_uses?: number | null
          uses?: number
          expires_at?: string | null
          temporary?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      friendships: {
        Row: {
          id: string
          requester_id: string
          addressee_id: string
          status: 'pending' | 'accepted' | 'blocked'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          requester_id: string
          addressee_id: string
          status?: 'pending' | 'accepted' | 'blocked'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          requester_id?: string
          addressee_id?: string
          status?: 'pending' | 'accepted' | 'blocked'
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      voice_states: {
        Row: {
          user_id: string
          channel_id: string
          server_id: string
          muted: boolean
          deafened: boolean
          speaking: boolean
          self_stream: boolean
          joined_at: string
        }
        Insert: {
          user_id: string
          channel_id: string
          server_id: string
          muted?: boolean
          deafened?: boolean
          speaking?: boolean
          self_stream?: boolean
          joined_at?: string
        }
        Update: {
          user_id?: string
          channel_id?: string
          server_id?: string
          muted?: boolean
          deafened?: boolean
          speaking?: boolean
          self_stream?: boolean
          joined_at?: string
        }
        Relationships: []
      }
      read_states: {
        Row: {
          user_id: string
          channel_id: string
          last_read_at: string
          mention_count: number
        }
        Insert: {
          user_id: string
          channel_id: string
          last_read_at?: string
          mention_count?: number
        }
        Update: {
          user_id?: string
          channel_id?: string
          last_read_at?: string
          mention_count?: number
        }
        Relationships: []
      }
      channel_permissions: {
        Row: {
          channel_id: string
          role_id: string
          allow_permissions: number
          deny_permissions: number
        }
        Insert: {
          channel_id: string
          role_id: string
          allow_permissions?: number
          deny_permissions?: number
        }
        Update: {
          channel_id?: string
          role_id?: string
          allow_permissions?: number
          deny_permissions?: number
        }
        Relationships: [
          {
            foreignKeyName: "channel_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          }
        ]
      }
      dm_channels: {
        Row: {
          id: string
          name: string | null
          icon_url: string | null
          owner_id: string | null
          is_group: boolean
          is_encrypted: boolean
          encryption_key_version: number
          encryption_membership_epoch: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name?: string | null
          icon_url?: string | null
          owner_id?: string | null
          is_group?: boolean
          is_encrypted?: boolean
          encryption_key_version?: number
          encryption_membership_epoch?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string | null
          icon_url?: string | null
          owner_id?: string | null
          is_group?: boolean
          is_encrypted?: boolean
          encryption_key_version?: number
          encryption_membership_epoch?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_device_keys: {
        Row: {
          user_id: string
          device_id: string
          public_key: string
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          device_id: string
          public_key: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          device_id?: string
          public_key?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      dm_channel_keys: {
        Row: {
          dm_channel_id: string
          key_version: number
          target_user_id: string
          target_device_id: string
          wrapped_key: string
          wrapped_by_user_id: string
          wrapped_by_device_id: string
          sender_public_key: string
          created_at: string
        }
        Insert: {
          dm_channel_id: string
          key_version: number
          target_user_id: string
          target_device_id: string
          wrapped_key: string
          wrapped_by_user_id: string
          wrapped_by_device_id: string
          sender_public_key: string
          created_at?: string
        }
        Update: {
          dm_channel_id?: string
          key_version?: number
          target_user_id?: string
          target_device_id?: string
          wrapped_key?: string
          wrapped_by_user_id?: string
          wrapped_by_device_id?: string
          sender_public_key?: string
          created_at?: string
        }
        Relationships: []
      }
      dm_channel_members: {
        Row: {
          dm_channel_id: string
          user_id: string
          added_by: string | null
          added_at: string
        }
        Insert: {
          dm_channel_id: string
          user_id: string
          added_by?: string | null
          added_at?: string
        }
        Update: {
          dm_channel_id?: string
          user_id?: string
          added_by?: string | null
          added_at?: string
        }
        Relationships: []
      }
      dm_read_states: {
        Row: {
          user_id: string
          dm_channel_id: string
          last_read_at: string
        }
        Insert: {
          user_id: string
          dm_channel_id: string
          last_read_at?: string
        }
        Update: {
          user_id?: string
          dm_channel_id?: string
          last_read_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          id: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          endpoint?: string
          p256dh?: string
          auth?: string
          user_agent?: string | null
          created_at?: string
        }
        Relationships: []
      }
      notification_settings: {
        Row: {
          id: string
          user_id: string
          server_id: string | null
          channel_id: string | null
          thread_id: string | null
          mode: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          server_id?: string | null
          channel_id?: string | null
          thread_id?: string | null
          mode?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          server_id?: string | null
          channel_id?: string | null
          thread_id?: string | null
          mode?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          id: string
          server_id: string
          actor_id: string | null
          action: string
          target_id: string | null
          target_type: string | null
          changes: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          server_id: string
          actor_id?: string | null
          action: string
          target_id?: string | null
          target_type?: string | null
          changes?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          actor_id?: string | null
          action?: string
          target_id?: string | null
          target_type?: string | null
          changes?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: 'mention' | 'reply' | 'friend_request' | 'server_invite' | 'system'
          title: string
          body: string | null
          icon_url: string | null
          server_id: string | null
          channel_id: string | null
          message_id: string | null
          read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: 'mention' | 'reply' | 'friend_request' | 'server_invite' | 'system'
          title: string
          body?: string | null
          icon_url?: string | null
          server_id?: string | null
          channel_id?: string | null
          message_id?: string | null
          read?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          type?: 'mention' | 'reply' | 'friend_request' | 'server_invite' | 'system'
          title?: string
          body?: string | null
          icon_url?: string | null
          server_id?: string | null
          channel_id?: string | null
          message_id?: string | null
          read?: boolean
          created_at?: string
        }
        Relationships: []
      }
      server_emojis: {
        Row: {
          id: string
          server_id: string
          name: string
          image_url: string
          uploader_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          server_id: string
          name: string
          image_url: string
          uploader_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          name?: string
          image_url?: string
          uploader_id?: string | null
          created_at?: string
        }
        Relationships: []
      }
      webhooks: {
        Row: {
          id: string
          server_id: string
          channel_id: string
          name: string
          avatar_url: string | null
          token: string
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          server_id: string
          channel_id: string
          name?: string
          avatar_url?: string | null
          token?: string
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          channel_id?: string
          name?: string
          avatar_url?: string | null
          token?: string
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      threads: {
        Row: {
          id: string
          parent_channel_id: string
          starter_message_id: string | null
          owner_id: string
          name: string
          archived: boolean
          locked: boolean
          auto_archive_duration: number
          archived_at: string | null
          message_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          parent_channel_id: string
          starter_message_id?: string | null
          owner_id: string
          name: string
          archived?: boolean
          locked?: boolean
          auto_archive_duration?: number
          archived_at?: string | null
          message_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          parent_channel_id?: string
          starter_message_id?: string | null
          owner_id?: string
          name?: string
          archived?: boolean
          locked?: boolean
          auto_archive_duration?: number
          archived_at?: string | null
          message_count?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "threads_parent_channel_id_fkey"
            columns: ["parent_channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "threads_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      thread_members: {
        Row: {
          thread_id: string
          user_id: string
          joined_at: string
        }
        Insert: {
          thread_id: string
          user_id: string
          joined_at?: string
        }
        Update: {
          thread_id?: string
          user_id?: string
          joined_at?: string
        }
        Relationships: []
      }
      thread_read_states: {
        Row: {
          user_id: string
          thread_id: string
          last_read_at: string
          mention_count: number
        }
        Insert: {
          user_id: string
          thread_id: string
          last_read_at?: string
          mention_count?: number
        }
        Update: {
          user_id?: string
          thread_id?: string
          last_read_at?: string
          mention_count?: number
        }
        Relationships: []
      }
      app_catalog: {
        Row: {
          id: string
          slug: string
          name: string
          description: string | null
          category: string
          icon_url: string | null
          homepage_url: string | null
          identity: Json
          install_scopes: string[]
          permissions: string[]
          trust_badge: Database['public']['Enums']['app_trust_badge'] | null
          average_rating: number
          review_count: number
          is_published: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
          description?: string | null
          category?: string
          icon_url?: string | null
          homepage_url?: string | null
          identity?: Json
          install_scopes?: string[]
          permissions?: string[]
          trust_badge?: Database['public']['Enums']['app_trust_badge'] | null
          average_rating?: number
          review_count?: number
          is_published?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          description?: string | null
          category?: string
          icon_url?: string | null
          homepage_url?: string | null
          identity?: Json
          install_scopes?: string[]
          permissions?: string[]
          trust_badge?: Database['public']['Enums']['app_trust_badge'] | null
          average_rating?: number
          review_count?: number
          is_published?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_catalog_credentials: {
        Row: {
          app_id: string
          credentials: Json
          updated_at: string
        }
        Insert: {
          app_id: string
          credentials?: Json
          updated_at?: string
        }
        Update: {
          app_id?: string
          credentials?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_catalog_credentials_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: true
            referencedRelation: "app_catalog"
            referencedColumns: ["id"]
          }
        ]
      }
      app_reviews: {
        Row: {
          id: string
          app_id: string
          user_id: string
          rating: number
          body: string | null
          created_at: string
        }
        Insert: {
          id?: string
          app_id: string
          user_id: string
          rating: number
          body?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          app_id?: string
          user_id?: string
          rating?: number
          body?: string | null
          created_at?: string
        }
        Relationships: []
      }
      server_app_installs: {
        Row: {
          id: string
          app_id: string
          server_id: string
          installed_by: string
          install_scopes: string[]
          granted_permissions: string[]
          installed_at: string
        }
        Insert: {
          id?: string
          app_id: string
          server_id: string
          installed_by: string
          install_scopes?: string[]
          granted_permissions?: string[]
          installed_at?: string
        }
        Update: {
          id?: string
          app_id?: string
          server_id?: string
          installed_by?: string
          install_scopes?: string[]
          granted_permissions?: string[]
          installed_at?: string
        }
        Relationships: []
      }
      server_app_install_credentials: {
        Row: {
          app_install_id: string
          credentials: Json
          updated_at: string
        }
        Insert: {
          app_install_id: string
          credentials?: Json
          updated_at?: string
        }
        Update: {
          app_install_id?: string
          credentials?: Json
          updated_at?: string
        }
        Relationships: []
      }
      app_commands: {
        Row: {
          id: string
          app_id: string
          command_name: string
          description: string | null
          schema: Json
          enabled: boolean
          created_at: string
        }
        Insert: {
          id?: string
          app_id: string
          command_name: string
          description?: string | null
          schema?: Json
          enabled?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          app_id?: string
          command_name?: string
          description?: string | null
          schema?: Json
          enabled?: boolean
          created_at?: string
        }
        Relationships: []
      }
      app_event_subscriptions: {
        Row: {
          id: string
          app_install_id: string
          event_key: string
          enabled: boolean
          created_at: string
        }
        Insert: {
          id?: string
          app_install_id: string
          event_key: string
          enabled?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          app_install_id?: string
          event_key?: string
          enabled?: boolean
          created_at?: string
        }
        Relationships: []
      }
      app_rate_limits: {
        Row: {
          app_id: string
          requests_per_minute: number
          burst: number
          updated_at: string
        }
        Insert: {
          app_id: string
          requests_per_minute?: number
          burst?: number
          updated_at?: string
        }
        Update: {
          app_id?: string
          requests_per_minute?: number
          burst?: number
          updated_at?: string
        }
        Relationships: []
      }
      channel_tasks: {
        Row: {
          id: string
          server_id: string
          channel_id: string
          title: string
          description: string | null
          status: 'todo' | 'in_progress' | 'done' | 'blocked'
          due_date: string | null
          assignee_id: string | null
          source_message_id: string | null
          created_by: string
          updated_by: string
          created_at: string
          updated_at: string
          search_vector: unknown | null
        }
        Insert: {
          id?: string
          server_id: string
          channel_id: string
          title: string
          description?: string | null
          status?: 'todo' | 'in_progress' | 'done' | 'blocked'
          due_date?: string | null
          assignee_id?: string | null
          source_message_id?: string | null
          created_by: string
          updated_by: string
          created_at?: string
          updated_at?: string
          search_vector?: unknown | null
        }
        Update: {
          id?: string
          server_id?: string
          channel_id?: string
          title?: string
          description?: string | null
          status?: 'todo' | 'in_progress' | 'done' | 'blocked'
          due_date?: string | null
          assignee_id?: string | null
          source_message_id?: string | null
          created_by?: string
          updated_by?: string
          created_at?: string
          updated_at?: string
          search_vector?: unknown | null
        }
        Relationships: []
      }
      channel_docs: {
        Row: {
          id: string
          server_id: string
          channel_id: string
          title: string
          content: string
          created_by: string
          updated_by: string
          created_at: string
          updated_at: string
          search_vector: unknown | null
        }
        Insert: {
          id?: string
          server_id: string
          channel_id: string
          title: string
          content?: string
          created_by: string
          updated_by: string
          created_at?: string
          updated_at?: string
          search_vector?: unknown | null
        }
        Update: {
          id?: string
          server_id?: string
          channel_id?: string
          title?: string
          content?: string
          created_by?: string
          updated_by?: string
          created_at?: string
          updated_at?: string
          search_vector?: unknown | null
        }
        Relationships: []
      }
      workspace_updates: {
        Row: {
          id: string
          server_id: string
          channel_id: string
          actor_id: string
          entity_type: 'task' | 'doc'
          entity_id: string
          action: string
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          server_id: string
          channel_id: string
          actor_id: string
          entity_type: 'task' | 'doc'
          entity_id: string
          action: string
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          channel_id?: string
          actor_id?: string
          entity_type?: 'task' | 'doc'
          entity_id?: string
          action?: string
          metadata?: Json
          created_at?: string
        }
        Relationships: []
      }
      app_usage_metrics: {
        Row: {
          id: number
          app_id: string
          server_id: string | null
          metric_key: string
          metric_value: number
          occurred_at: string
        }
        Insert: {
          id?: number
          app_id: string
          server_id?: string | null
          metric_key: string
          metric_value?: number
          occurred_at?: string
        }
        Update: {
          id?: number
          app_id?: string
          server_id?: string | null
          metric_key?: string
          metric_value?: number
          occurred_at?: string
        }
        Relationships: []
      }
      voice_call_sessions: {
        Row: {
          id: string
          scope_type: 'server_channel' | 'dm_call'
          scope_id: string
          started_at: string
          ended_at: string | null
          started_by: string
          transcription_mode: 'off' | 'manual_opt_in' | 'server_policy_required'
          summary_status: 'pending' | 'ready' | 'failed' | 'skipped'
          created_at: string
        }
        Insert: {
          id?: string
          scope_type: 'server_channel' | 'dm_call'
          scope_id: string
          started_at?: string
          ended_at?: string | null
          started_by: string
          transcription_mode?: 'off' | 'manual_opt_in' | 'server_policy_required'
          summary_status?: 'pending' | 'ready' | 'failed' | 'skipped'
          created_at?: string
        }
        Update: {
          id?: string
          scope_type?: 'server_channel' | 'dm_call'
          scope_id?: string
          started_at?: string
          ended_at?: string | null
          started_by?: string
          transcription_mode?: 'off' | 'manual_opt_in' | 'server_policy_required'
          summary_status?: 'pending' | 'ready' | 'failed' | 'skipped'
          created_at?: string
        }
        Relationships: []
      }
      voice_call_participants: {
        Row: {
          id: string
          session_id: string
          user_id: string
          joined_at: string
          left_at: string | null
          consent_transcription: boolean
          consent_translation: boolean
          preferred_subtitle_language: string | null
        }
        Insert: {
          id?: string
          session_id: string
          user_id: string
          joined_at?: string
          left_at?: string | null
          consent_transcription?: boolean
          consent_translation?: boolean
          preferred_subtitle_language?: string | null
        }
        Update: {
          id?: string
          session_id?: string
          user_id?: string
          joined_at?: string
          left_at?: string | null
          consent_transcription?: boolean
          consent_translation?: boolean
          preferred_subtitle_language?: string | null
        }
        Relationships: []
      }
      voice_transcript_segments: {
        Row: {
          id: string
          session_id: string
          speaker_user_id: string | null
          source_language: string
          text: string
          started_at: string
          ended_at: string
          confidence: number | null
          provider: string | null
          is_redacted: boolean
          expires_at: string | null
          deleted_at: string | null
          purged_at: string | null
          legal_hold: boolean
          legal_hold_reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          session_id: string
          speaker_user_id?: string | null
          source_language?: string
          text: string
          started_at: string
          ended_at: string
          confidence?: number | null
          provider?: string | null
          is_redacted?: boolean
          expires_at?: string | null
          deleted_at?: string | null
          purged_at?: string | null
          legal_hold?: boolean
          legal_hold_reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          session_id?: string
          speaker_user_id?: string | null
          source_language?: string
          text?: string
          started_at?: string
          ended_at?: string
          confidence?: number | null
          provider?: string | null
          is_redacted?: boolean
          expires_at?: string | null
          deleted_at?: string | null
          purged_at?: string | null
          legal_hold?: boolean
          legal_hold_reason?: string | null
          created_at?: string
        }
        Relationships: []
      }
      voice_transcript_translations: {
        Row: {
          id: string
          segment_id: string
          target_user_id: string | null
          target_language: string
          translated_text: string
          provider: string | null
          created_at: string
        }
        Insert: {
          id?: string
          segment_id: string
          target_user_id?: string | null
          target_language: string
          translated_text: string
          provider?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          segment_id?: string
          target_user_id?: string | null
          target_language?: string
          translated_text?: string
          provider?: string | null
          created_at?: string
        }
        Relationships: []
      }
      voice_call_summaries: {
        Row: {
          session_id: string
          model: string
          highlights_md: string
          decisions_md: string
          action_items_md: string
          generated_at: string
          quality_score: number | null
          expires_at: string | null
          deleted_at: string | null
          purged_at: string | null
          legal_hold: boolean
          legal_hold_reason: string | null
        }
        Insert: {
          session_id: string
          model: string
          highlights_md?: string
          decisions_md?: string
          action_items_md?: string
          generated_at?: string
          quality_score?: number | null
          expires_at?: string | null
          deleted_at?: string | null
          purged_at?: string | null
          legal_hold?: boolean
          legal_hold_reason?: string | null
        }
        Update: {
          session_id?: string
          model?: string
          highlights_md?: string
          decisions_md?: string
          action_items_md?: string
          generated_at?: string
          quality_score?: number | null
          expires_at?: string | null
          deleted_at?: string | null
          purged_at?: string | null
          legal_hold?: boolean
          legal_hold_reason?: string | null
        }
        Relationships: []
      }
      voice_intelligence_policies: {
        Row: {
          id: string
          scope_type: 'workspace' | 'server'
          scope_id: string
          transcription_enabled: boolean
          require_explicit_consent: boolean
          translation_enabled: boolean
          summary_enabled: boolean
          retention_days: number
          allowed_locales: string[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          scope_type: 'workspace' | 'server'
          scope_id: string
          transcription_enabled?: boolean
          require_explicit_consent?: boolean
          translation_enabled?: boolean
          summary_enabled?: boolean
          retention_days?: number
          allowed_locales?: string[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          scope_type?: 'workspace' | 'server'
          scope_id?: string
          transcription_enabled?: boolean
          require_explicit_consent?: boolean
          translation_enabled?: boolean
          summary_enabled?: boolean
          retention_days?: number
          allowed_locales?: string[]
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      voice_intelligence_audit_log: {
        Row: {
          id: string
          session_id: string | null
          actor_user_id: string | null
          event_type: string
          payload_json: Json
          created_at: string
        }
        Insert: {
          id?: string
          session_id?: string | null
          actor_user_id?: string | null
          event_type: string
          payload_json?: Json
          created_at?: string
        }
        Update: {
          id?: string
          session_id?: string | null
          actor_user_id?: string | null
          event_type?: string
          payload_json?: Json
          created_at?: string
        }
        Relationships: []
      }
      automod_rule_analytics: {
        Row: {
          rule_id: string
          server_id: string
          hit_count: number
          false_positive_count: number
          last_triggered_at: string | null
          updated_at: string
        }
        Insert: {
          rule_id: string
          server_id: string
          hit_count?: number
          false_positive_count?: number
          last_triggered_at?: string | null
          updated_at?: string
        }
        Update: {
          rule_id?: string
          server_id?: string
          hit_count?: number
          false_positive_count?: number
          last_triggered_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automod_rule_analytics_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: true
            referencedRelation: "automod_rules"
            referencedColumns: ["id"]
          }
        ]
      }
      events: {
        Row: {
          id: string
          server_id: string
          title: string
          description: string | null
          location: string | null
          linked_channel_id: string | null
          start_at: string
          end_at: string
          timezone: string
          recurrence: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'
          recurrence_until: string | null
          capacity: number | null
          create_voice_channel: boolean
          voice_channel_id: string | null
          post_event_thread: boolean
          thread_id: string | null
          created_by: string
          cancelled_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          server_id: string
          title: string
          description?: string | null
          location?: string | null
          linked_channel_id?: string | null
          start_at: string
          end_at: string
          timezone?: string
          recurrence?: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'
          recurrence_until?: string | null
          capacity?: number | null
          create_voice_channel?: boolean
          voice_channel_id?: string | null
          post_event_thread?: boolean
          thread_id?: string | null
          created_by: string
          cancelled_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          title?: string
          description?: string | null
          location?: string | null
          linked_channel_id?: string | null
          start_at?: string
          end_at?: string
          timezone?: string
          recurrence?: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'
          recurrence_until?: string | null
          capacity?: number | null
          create_voice_channel?: boolean
          voice_channel_id?: string | null
          post_event_thread?: boolean
          thread_id?: string | null
          created_by?: string
          cancelled_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      event_hosts: {
        Row: {
          event_id: string
          user_id: string
          created_at: string
        }
        Insert: {
          event_id: string
          user_id: string
          created_at?: string
        }
        Update: {
          event_id?: string
          user_id?: string
          created_at?: string
        }
        Relationships: []
      }
      event_rsvps: {
        Row: {
          event_id: string
          user_id: string
          status: 'interested' | 'going' | 'maybe' | 'not_going' | 'waitlist'
          waitlist_position: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          event_id: string
          user_id: string
          status: 'interested' | 'going' | 'maybe' | 'not_going' | 'waitlist'
          waitlist_position?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          event_id?: string
          user_id?: string
          status?: 'interested' | 'going' | 'maybe' | 'not_going' | 'waitlist'
          waitlist_position?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      event_reminders: {
        Row: {
          event_id: string
          user_id: string
          minutes_before: 10 | 60 | 1440
          sent_at: string | null
          created_at: string
        }
        Insert: {
          event_id: string
          user_id: string
          minutes_before: 10 | 60 | 1440
          sent_at?: string | null
          created_at?: string
        }
        Update: {
          event_id?: string
          user_id?: string
          minutes_before?: 10 | 60 | 1440
          sent_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          id: string
          reporter_id: string
          reported_user_id: string
          reported_message_id: string | null
          server_id: string | null
          reason: Database['public']['Enums']['report_reason']
          description: string | null
          status: Database['public']['Enums']['report_status']
          reviewed_by: string | null
          reviewed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          reporter_id: string
          reported_user_id: string
          reported_message_id?: string | null
          server_id?: string | null
          reason: Database['public']['Enums']['report_reason']
          description?: string | null
          status?: Database['public']['Enums']['report_status']
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          reporter_id?: string
          reported_user_id?: string
          reported_message_id?: string | null
          server_id?: string | null
          reason?: Database['public']['Enums']['report_reason']
          description?: string | null
          status?: Database['public']['Enums']['report_status']
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      moderation_appeals: {
        Row: {
          id: string
          server_id: string
          user_id: string
          linked_action: string
          appellant_statement: string
          evidence_attachments: Json
          status: 'submitted' | 'reviewing' | 'approved' | 'denied' | 'closed'
          assigned_reviewer_id: string | null
          decision_template_id: string | null
          decision_reason: string | null
          anti_abuse_score: number
          submitted_at: string
          updated_at: string
          closed_at: string | null
        }
        Insert: {
          id?: string
          server_id: string
          user_id: string
          linked_action?: string
          appellant_statement: string
          evidence_attachments?: Json
          status?: 'submitted' | 'reviewing' | 'approved' | 'denied' | 'closed'
          assigned_reviewer_id?: string | null
          decision_template_id?: string | null
          decision_reason?: string | null
          anti_abuse_score?: number
          submitted_at?: string
          updated_at?: string
          closed_at?: string | null
        }
        Update: {
          id?: string
          server_id?: string
          user_id?: string
          linked_action?: string
          appellant_statement?: string
          evidence_attachments?: Json
          status?: 'submitted' | 'reviewing' | 'approved' | 'denied' | 'closed'
          assigned_reviewer_id?: string | null
          decision_template_id?: string | null
          decision_reason?: string | null
          anti_abuse_score?: number
          submitted_at?: string
          updated_at?: string
          closed_at?: string | null
        }
        Relationships: []
      }
      moderation_decision_templates: {
        Row: {
          id: string
          server_id: string
          title: string
          body: string
          decision: 'approved' | 'denied' | 'closed'
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          server_id: string
          title: string
          body: string
          decision: 'approved' | 'denied' | 'closed'
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          title?: string
          body?: string
          decision?: 'approved' | 'denied' | 'closed'
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      moderation_appeal_internal_notes: {
        Row: {
          id: string
          appeal_id: string
          server_id: string
          author_id: string
          note: string
          created_at: string
        }
        Insert: {
          id?: string
          appeal_id: string
          server_id: string
          author_id: string
          note: string
          created_at?: string
        }
        Update: {
          id?: string
          appeal_id?: string
          server_id?: string
          author_id?: string
          note?: string
          created_at?: string
        }
        Relationships: []
      }
      moderation_appeal_status_events: {
        Row: {
          id: string
          appeal_id: string
          server_id: string
          actor_id: string | null
          previous_status: 'submitted' | 'reviewing' | 'approved' | 'denied' | 'closed' | null
          new_status: 'submitted' | 'reviewing' | 'approved' | 'denied' | 'closed'
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          appeal_id: string
          server_id: string
          actor_id?: string | null
          previous_status?: 'submitted' | 'reviewing' | 'approved' | 'denied' | 'closed' | null
          new_status: 'submitted' | 'reviewing' | 'approved' | 'denied' | 'closed'
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          appeal_id?: string
          server_id?: string
          actor_id?: string | null
          previous_status?: 'submitted' | 'reviewing' | 'approved' | 'denied' | 'closed' | null
          new_status?: 'submitted' | 'reviewing' | 'approved' | 'denied' | 'closed'
          metadata?: Json
          created_at?: string
        }
        Relationships: []
      }
      welcome_app_configs: {
        Row: {
          id: string
          server_id: string
          channel_id: string | null
          welcome_message: string
          rules: Json
          embed_color: string
          dm_on_join: boolean
          dm_message: string | null
          auto_role_ids: string[]
          enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          server_id: string
          channel_id?: string | null
          welcome_message?: string
          rules?: Json
          embed_color?: string
          dm_on_join?: boolean
          dm_message?: string | null
          auto_role_ids?: string[]
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          channel_id?: string | null
          welcome_message?: string
          rules?: Json
          embed_color?: string
          dm_on_join?: boolean
          dm_message?: string | null
          auto_role_ids?: string[]
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      giveaway_app_configs: {
        Row: {
          id: string
          server_id: string
          channel_id: string | null
          enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          server_id: string
          channel_id?: string | null
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          channel_id?: string | null
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      giveaways: {
        Row: {
          id: string
          server_id: string
          channel_id: string
          title: string
          description: string | null
          prize: string
          winners_count: number
          ends_at: string
          created_by: string
          status: string
          winner_ids: string[]
          message_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          server_id: string
          channel_id: string
          title: string
          description?: string | null
          prize: string
          winners_count?: number
          ends_at: string
          created_by: string
          status?: string
          winner_ids?: string[]
          message_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          channel_id?: string
          title?: string
          description?: string | null
          prize?: string
          winners_count?: number
          ends_at?: string
          created_by?: string
          status?: string
          winner_ids?: string[]
          message_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      giveaway_entries: {
        Row: {
          id: string
          giveaway_id: string
          user_id: string
          entered_at: string
        }
        Insert: {
          id?: string
          giveaway_id: string
          user_id: string
          entered_at?: string
        }
        Update: {
          id?: string
          giveaway_id?: string
          user_id?: string
          entered_at?: string
        }
        Relationships: []
      }
      standup_app_configs: {
        Row: {
          id: string
          server_id: string
          channel_id: string | null
          reminder_time: string
          timezone: string
          questions: Json
          days_active: number[]
          enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          server_id: string
          channel_id?: string | null
          reminder_time?: string
          timezone?: string
          questions?: Json
          days_active?: number[]
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          channel_id?: string | null
          reminder_time?: string
          timezone?: string
          questions?: Json
          days_active?: number[]
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      standup_entries: {
        Row: {
          id: string
          server_id: string
          user_id: string
          answers: Json
          standup_date: string
          submitted_at: string
        }
        Insert: {
          id?: string
          server_id: string
          user_id: string
          answers?: Json
          standup_date?: string
          submitted_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          user_id?: string
          answers?: Json
          standup_date?: string
          submitted_at?: string
        }
        Relationships: []
      }
      incident_app_configs: {
        Row: {
          id: string
          server_id: string
          channel_id: string | null
          enabled: boolean
          severity_labels: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          server_id: string
          channel_id?: string | null
          enabled?: boolean
          severity_labels?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          channel_id?: string | null
          enabled?: boolean
          severity_labels?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      incidents: {
        Row: {
          id: string
          server_id: string
          channel_id: string
          title: string
          description: string | null
          severity: string
          status: string
          commander_id: string | null
          created_by: string
          resolved_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          server_id: string
          channel_id: string
          title: string
          description?: string | null
          severity?: string
          status?: string
          commander_id?: string | null
          created_by: string
          resolved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          channel_id?: string
          title?: string
          description?: string | null
          severity?: string
          status?: string
          commander_id?: string | null
          created_by?: string
          resolved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      incident_updates: {
        Row: {
          id: string
          incident_id: string
          author_id: string
          status: string
          message: string
          created_at: string
        }
        Insert: {
          id?: string
          incident_id: string
          author_id: string
          status: string
          message: string
          created_at?: string
        }
        Update: {
          id?: string
          incident_id?: string
          author_id?: string
          status?: string
          message?: string
          created_at?: string
        }
        Relationships: []
      }
      reminder_app_configs: {
        Row: {
          id: string
          server_id: string
          channel_id: string | null
          max_reminders_per_user: number
          enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          server_id: string
          channel_id?: string | null
          max_reminders_per_user?: number
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          channel_id?: string | null
          max_reminders_per_user?: number
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          id: string
          server_id: string
          channel_id: string
          user_id: string
          message: string
          remind_at: string
          delivered: boolean
          created_at: string
        }
        Insert: {
          id?: string
          server_id: string
          channel_id: string
          user_id: string
          message: string
          remind_at: string
          delivered?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          server_id?: string
          channel_id?: string
          user_id?: string
          message?: string
          remind_at?: string
          delivered?: boolean
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      app_catalog_public: {
        Row: {
          id: string
          slug: string
          name: string
          description: string | null
          category: string
          icon_url: string | null
          homepage_url: string | null
          identity: Json
          install_scopes: string[]
          permissions: string[]
          trust_badge: Database['public']['Enums']['app_trust_badge'] | null
          average_rating: number
          review_count: number
          is_published: boolean
          created_at: string
          updated_at: string
        }
        Relationships: []
      }
      badge_definitions: {
        Row: {
          id: string
          name: string
          description: string
          icon: string
          color: string
          category: 'general' | 'activity' | 'moderation' | 'special' | 'server'
          rarity: 'common' | 'uncommon' | 'rare' | 'legendary'
          sort_order: number
          created_at: string
        }
        Insert: {
          id: string
          name: string
          description?: string
          icon?: string
          color?: string
          category?: 'general' | 'activity' | 'moderation' | 'special' | 'server'
          rarity?: 'common' | 'uncommon' | 'rare' | 'legendary'
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string
          icon?: string
          color?: string
          category?: 'general' | 'activity' | 'moderation' | 'special' | 'server'
          rarity?: 'common' | 'uncommon' | 'rare' | 'legendary'
          sort_order?: number
          created_at?: string
        }
        Relationships: []
      }
      user_badges: {
        Row: {
          id: string
          user_id: string
          badge_id: string
          awarded_at: string
          awarded_by: string | null
          metadata: Record<string, unknown> | null
        }
        Insert: {
          id?: string
          user_id: string
          badge_id: string
          awarded_at?: string
          awarded_by?: string | null
          metadata?: Record<string, unknown> | null
        }
        Update: {
          id?: string
          user_id?: string
          badge_id?: string
          awarded_at?: string
          awarded_by?: string | null
          metadata?: Record<string, unknown> | null
        }
        Relationships: []
      }
    }
    Functions: {
      auto_archive_inactive_threads: {
        Args: Record<string, never>
        Returns: number
      }
      is_server_member: {
        Args: { p_server_id: string; p_user_id?: string }
        Returns: boolean
      }
      is_server_owner: {
        Args: { p_server_id: string; p_user_id?: string }
        Returns: boolean
      }
      get_member_permissions: {
        Args: { p_server_id: string; p_user_id?: string }
        Returns: number
      }
      has_permission: {
        Args: { p_server_id: string; p_permission: number; p_user_id?: string }
        Returns: boolean
      }
      mark_channel_read: {
        Args: { p_channel_id: string }
        Returns: void
      }
      mark_dm_read: {
        Args: { p_dm_channel_id: string }
        Returns: void
      }
      mark_thread_read: {
        Args: { p_thread_id: string }
        Returns: void
      }
      join_server_by_invite: {
        Args: { p_invite_code: string }
        Returns: Database['public']['Tables']['servers']['Row']
      }
      is_member_timed_out: {
        Args: { p_server_id: string; p_user_id?: string }
        Returns: boolean
      }
      has_passed_screening: {
        Args: { p_server_id: string; p_user_id?: string }
        Returns: boolean
      }
      create_thread_from_message: {
        Args: { p_message_id: string; p_name: string; p_auto_archive_duration?: number }
        Returns: Database['public']['Tables']['threads']['Row']
      }
      get_thread_counts_by_channel: {
        Args: { p_server_id: string }
        Returns: {
          parent_channel_id: string
          count: number
        }[]
      }
      set_member_timeout: {
        Args: {
          p_server_id: string
          p_member_id: string
          p_timeout_until: string | null
          p_moderator_id?: string | null
          p_reason?: string | null
        }
        Returns: void
      }
      delete_expired_channels: {
        Args: Record<string, never>
        Returns: number
      }
      apply_server_template: {
        Args: { p_server_id: string; p_template: Json }
        Returns: Json
      }
      export_server_template: {
        Args: { p_server_id: string }
        Returns: Json
      }
      create_server_from_template: {
        Args: { p_name: string; p_description: string; p_icon_url: string; p_template: Json }
        Returns: Database['public']['Tables']['servers']['Row']
      }
      recompute_app_rating: {
        Args: { p_app_id: string }
        Returns: void
      }
      bump_app_usage: {
        Args: { p_app_id: string; p_server_id: string; p_metric_key: string; p_metric_value?: number }
        Returns: void
      }
      increment_automod_rule_hit: {
        Args: { p_rule_id: string }
        Returns: void
      }
      mark_automod_false_positive: {
        Args: { p_rule_id: string }
        Returns: void
      }
      reorder_channels: {
        Args: { p_server_id: string; p_updates: Json }
        Returns: undefined
      }
      promote_from_waitlist: {
        Args: { p_event_id: string; p_event_capacity?: number }
        Returns: string | null
      }
      set_event_capacity_and_promote: {
        Args: { p_event_id: string; p_server_id: string; p_new_capacity: number }
        Returns: number
      }
      delete_server_cascade: {
        Args: { p_server_id: string }
        Returns: undefined
      }
      assign_member_role: {
        Args: {
          p_server_id: string
          p_user_id: string
          p_role_id: string
          p_actor_id: string
          p_role_name: string | null
        }
        Returns: boolean
      }
      remove_member_role: {
        Args: {
          p_server_id: string
          p_user_id: string
          p_role_id: string
          p_actor_id: string
          p_role_name: string | null
        }
        Returns: undefined
      }
    }
    Enums: {
      app_trust_badge: 'verified' | 'partner' | 'internal'
      report_reason: 'spam' | 'harassment' | 'inappropriate_content' | 'other'
      report_status: 'pending' | 'reviewed' | 'resolved' | 'dismissed'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Derived types for convenience
export type UserRow = Database['public']['Tables']['users']['Row']
export type UserPinnedItemRow = Database['public']['Tables']['user_pinned_items']['Row']
export type UserActivityLogRow = Database['public']['Tables']['user_activity_log']['Row']
export type ServerRow = Database['public']['Tables']['servers']['Row']
export type ServerMemberRow = Database['public']['Tables']['server_members']['Row']
export type RoleRow = Database['public']['Tables']['roles']['Row']
export type ChannelRow = Database['public']['Tables']['channels']['Row']
export type MessageRow = Database['public']['Tables']['messages']['Row']
export type AttachmentRow = Database['public']['Tables']['attachments']['Row']
export type ReactionRow = Database['public']['Tables']['reactions']['Row']
export type DirectMessageRow = Database['public']['Tables']['direct_messages']['Row']
export type VoiceStateRow = Database['public']['Tables']['voice_states']['Row']
export type FriendshipRow = Database['public']['Tables']['friendships']['Row']
export type ServerBanRow = Database['public']['Tables']['server_bans']['Row']
export type InviteRow = Database['public']['Tables']['invites']['Row']
export type NotificationRow = Database['public']['Tables']['notifications']['Row']
export type ServerEmojiRow = Database['public']['Tables']['server_emojis']['Row']
export type WebhookRow = Database['public']['Tables']['webhooks']['Row']
export type ScreeningConfigRow = Database['public']['Tables']['screening_configs']['Row']
export type MemberScreeningRow = Database['public']['Tables']['member_screening']['Row']
export type MemberTimeoutRow = Database['public']['Tables']['member_timeouts']['Row']
export type AutoModRuleRow = Database['public']['Tables']['automod_rules']['Row']
export type ThreadRow = Database['public']['Tables']['threads']['Row']
export type ThreadMemberRow = Database['public']['Tables']['thread_members']['Row']
export type ThreadReadStateRow = Database['public']['Tables']['thread_read_states']['Row']
export interface BadgeDefinitionRow {
  id: string
  name: string
  description: string
  icon: string
  color: string
  category: 'general' | 'activity' | 'moderation' | 'special' | 'server'
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary'
  sort_order: number
  created_at: string
}
export interface UserBadgeRow {
  id: string
  user_id: string
  badge_id: string
  awarded_at: string
  awarded_by: string | null
  metadata: Record<string, unknown> | null
}

// AutoMod types
export type AutoModTriggerType = 'keyword_filter' | 'regex_filter' | 'mention_spam' | 'link_spam' | 'rapid_message'

export type AutoModActionType =
  | 'block_message'
  | 'quarantine_message'
  | 'timeout_member'
  | 'warn_member'
  | 'alert_channel'

export interface AutoModAction {
  type: AutoModActionType
  duration_seconds?: number  // for timeout_member
  channel_id?: string        // for alert_channel
  warning_message?: string   // for warn_member
}

export interface KeywordFilterConfig {
  keywords: string[]
  regex_patterns?: string[]
}

export interface MentionSpamConfig {
  mention_threshold: number
}

export interface LinkSpamConfig {
  link_threshold: number
}

export interface RegexFilterConfig {
  regex_patterns: string[]
}

export interface RapidMessageConfig {
  message_threshold: number
  window_seconds: number
}

export interface AutoModConditions {
  channel_ids?: string[]
  role_ids?: string[]
  min_account_age_minutes?: number
  min_trust_level?: number
}

export type AutoModConfig =
  | KeywordFilterConfig
  | RegexFilterConfig
  | MentionSpamConfig
  | LinkSpamConfig
  | RapidMessageConfig

export interface AutoModRuleWithParsed extends Omit<AutoModRuleRow, 'config' | 'actions' | 'conditions'> {
  config: AutoModConfig
  conditions: AutoModConditions
  actions: AutoModAction[]
}

// Extended types with relations
export interface MessageWithAuthor extends MessageRow {
  author: UserRow
  attachments: AttachmentRow[]
  reactions: ReactionRow[]
  reply_to: MessageWithAuthor | null
}

export interface ServerWithChannels extends ServerRow {
  channels: ChannelRow[]
  members_count: number
}

export interface MemberWithRoles extends ServerMemberRow {
  user: UserRow
  roles: RoleRow[]
}

export interface FriendWithUser extends FriendshipRow {
  friend: UserRow
}

export interface ThreadWithDetails extends ThreadRow {
  owner: UserRow
  starter_message: MessageWithAuthor | null
  members: ThreadMemberRow[]
}

export interface MessageWithThread extends MessageWithAuthor {
  thread: ThreadRow | null
}

// --- Composite types for Supabase join queries ---

/** Message with joined channel containing server_id — used by pin, reactions, task, reports routes */
export interface MessageWithChannelServerId {
  id: string
  channel_id: string
  channels: { server_id: string } | null
}

/** Message with channel + author context — used by reports route */
export interface MessageWithChannelAndAuthor extends MessageWithChannelServerId {
  author_id: string
}

/** Member role with nested role permissions — returned by member_roles(roles(permissions)) select */
export interface MemberRoleWithPermissions {
  roles: { permissions: number } | null
}

/** Friendship row with joined user data for categorization */
export interface FriendshipEntry extends FriendshipRow {
  requester: UserRow | null
  addressee: UserRow | null
  friend: UserRow | null
}

/** DM channel encryption info — returned by dm_channels select for encryption check */
export interface DmChannelEncryptionInfo {
  is_encrypted: boolean
  encryption_key_version: number
}

/** Direct message with sender relation */
export interface DirectMessageWithSender extends DirectMessageRow {
  sender: Pick<UserRow, 'id' | 'username' | 'display_name' | 'avatar_url' | 'status'> | null
}
