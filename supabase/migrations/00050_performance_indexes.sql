-- Migration 00050: Performance indexes for high-traffic FK join columns
--
-- Audit of supabase/migrations/ shows four columns originally flagged
-- (messages.channel_id, messages.author_id, reactions.message_id,
-- server_members.server_id) were already indexed in 00001_initial_schema.sql.
-- The CREATE INDEX … IF NOT EXISTS guards below are therefore safe no-ops on
-- existing databases; they are included here so the audit trail is complete
-- and so the indexes are guaranteed to exist even on fresh schema applies that
-- may have skipped portions of 00001.
--
-- Five additional FK join columns found to lack indexes during the audit are
-- also covered below — these will create real indexes on existing databases.
--
-- NOTE: CONCURRENTLY is omitted because Supabase CLI executes migrations
-- inside a transaction pipeline, and CREATE INDEX CONCURRENTLY cannot run
-- within a transaction (SQLSTATE 25001).

-- ── Already-indexed columns (safe no-ops on live DBs) ────────────────────────

CREATE INDEX IF NOT EXISTS idx_messages_channel_id
  ON public.messages (channel_id);

CREATE INDEX IF NOT EXISTS idx_messages_author_id
  ON public.messages (author_id);

CREATE INDEX IF NOT EXISTS idx_reactions_message_id
  ON public.reactions (message_id);

CREATE INDEX IF NOT EXISTS idx_server_members_server_id
  ON public.server_members (server_id);

-- ── Genuinely-missing FK indexes discovered during audit ─────────────────────

-- attachments.message_id: every attachment lookup joins on this FK; no index
-- was created in any prior migration.
CREATE INDEX IF NOT EXISTS idx_attachments_message_id
  ON public.attachments (message_id);

-- channel_permissions.channel_id: RLS policies join channel_permissions to
-- channels on this column for every permission check; no prior index.
CREATE INDEX IF NOT EXISTS idx_channel_permissions_channel_id
  ON public.channel_permissions (channel_id);

-- channel_permissions.role_id: join target when resolving role → channel
-- permission overrides; no prior index.
CREATE INDEX IF NOT EXISTS idx_channel_permissions_role_id
  ON public.channel_permissions (role_id);

-- member_roles.role_id: used when cascading role deletes and when checking
-- which members hold a given role; the existing composite (user_id, server_id)
-- index does not help role_id-first lookups.
CREATE INDEX IF NOT EXISTS idx_member_roles_role_id
  ON public.member_roles (role_id);

-- dm_channel_members.dm_channel_id: fetching all members of a DM channel
-- (e.g. for group-DM member lists) requires this FK scan; only user_id was
-- previously indexed.
CREATE INDEX IF NOT EXISTS idx_dm_channel_members_dm_channel_id
  ON public.dm_channel_members (dm_channel_id);

-- audit_logs.actor_id: moderators frequently filter audit logs by the user
-- who performed the action; only the (server_id, created_at) index existed.
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id
  ON public.audit_logs (actor_id);
