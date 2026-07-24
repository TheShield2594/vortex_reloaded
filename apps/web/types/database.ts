/**
 * Application row types, frozen against the snake_case JSON shape every
 * API route/response contract and frontend consumer in this app was built
 * around (originally Supabase's PostgREST output).
 *
 * The database is now SQLite via Drizzle (`@vortex/db`). Drizzle result
 * rows use camelCase JS properties; routes convert them back to snake_case
 * at the DB boundary (see lib/utils/case.ts `toSnakeCase`) so these types
 * stay the single source of truth for the wire/prop shape.
 *
 * This file was trimmed during the Supabase→SQLite cutover (issue #69) to
 * the handful of tables actually referenced by the app. The `Row` types
 * below are the snake_case subset those consumers need; the `Insert`/
 * `Update`/`Relationships` variants and the ~90 legacy Discord-era tables
 * that the old Supabase-generated file carried were dropped.
 */

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
      }
      reactions: {
        Row: {
          message_id: string
          user_id: string
          emoji: string
          created_at: string
        }
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
      }
    }
  }
}

// Derived row aliases used across the app.
export type UserRow = Database['public']['Tables']['users']['Row']
export type UserPinnedItemRow = Database['public']['Tables']['user_pinned_items']['Row']
export type UserActivityLogRow = Database['public']['Tables']['user_activity_log']['Row']
export type MessageRow = Database['public']['Tables']['messages']['Row']
export type AttachmentRow = Database['public']['Tables']['attachments']['Row']
export type ReactionRow = Database['public']['Tables']['reactions']['Row']
export type FriendshipRow = Database['public']['Tables']['friendships']['Row']

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

// Extended types with relations.
export interface MessageWithAuthor extends MessageRow {
  author: UserRow
  attachments: AttachmentRow[]
  reactions: ReactionRow[]
  reply_to: MessageWithAuthor | null
}

export interface FriendWithUser extends FriendshipRow {
  friend: UserRow
}
