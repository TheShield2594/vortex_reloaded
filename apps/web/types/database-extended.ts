/**
 * Supplementary type definitions for database tables that are not yet
 * present in the auto-generated `database.ts`.
 *
 * These tables were added via migrations after the last codegen run.
 * When the generated types are regenerated these should be reconciled
 * and this file removed.
 */

// ── Auth / security ────────────────────────────────────────────────────────

export interface AuthTrustedDeviceRow {
  id: string
  user_id: string
  label: string
  token_hash: string
  last_seen_at: string | null
  expires_at: string
  revoked_at: string | null
  created_at: string
}

export interface AuthSessionRow {
  id: string
  user_id: string
  trusted_device_id: string | null
  session_token_hash: string
  user_agent: string | null
  ip_address: string | null
  last_seen_at: string | null
  expires_at: string
  revoked_at: string | null
  created_at: string
}

export interface AuthSecurityPolicyRow {
  user_id: string
  passkey_first: boolean
  enforce_passkey: boolean
  fallback_password: boolean
  fallback_magic_link: boolean
}

export interface AuthChallengeRow {
  id: string
  user_id: string
  flow: string
  challenge: string
  rp_id: string
  origin: string
  expires_at: string
  used_at: string | null
  created_at: string
}

export interface PasskeyCredentialRow {
  id: string
  user_id: string
  credential_id: string
  public_key: string
  counter: number
  name: string | null
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

export interface RecoveryCodeRow {
  id: string
  user_id: string
  code_hash: string
  used_at: string | null
  created_at: string
}

export interface LoginRiskEventRow {
  id: string
  user_id: string | null
  email: string
  ip_address: string | null
  user_agent: string | null
  location_hint: string | null
  risk_score: number
  reasons: string[]
  suspicious: boolean
  succeeded: boolean
  created_at: string
}

// ── DM extras (not in generated types) ─────────────────────────────────────

export interface DmReactionRow {
  dm_id: string
  user_id: string
  emoji: string
  created_at: string
}

export interface DmAttachmentRow {
  id: string
  dm_id: string
  url: string
  filename: string
  size: number
  content_type: string
  storage_path: string
  encryption_key_version: number | null
  encrypted_dek: string | null
  iv: string | null
  expires_at: string | null
  purged_at: string | null
  created_at: string
}
