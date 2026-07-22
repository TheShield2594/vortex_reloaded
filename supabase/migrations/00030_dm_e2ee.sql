-- DM end-to-end encryption primitives (client-managed keys)
ALTER TABLE public.dm_channels
  ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS encryption_key_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS encryption_membership_epoch INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.user_device_keys (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, device_id)
);

CREATE TABLE IF NOT EXISTS public.dm_channel_keys (
  dm_channel_id UUID NOT NULL REFERENCES public.dm_channels(id) ON DELETE CASCADE,
  key_version INTEGER NOT NULL,
  target_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_device_id TEXT NOT NULL,
  wrapped_key TEXT NOT NULL,
  wrapped_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  wrapped_by_device_id TEXT NOT NULL,
  sender_public_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (dm_channel_id, key_version, target_user_id, target_device_id)
);

CREATE INDEX IF NOT EXISTS dm_channel_keys_target_idx
  ON public.dm_channel_keys(target_user_id, target_device_id, dm_channel_id, key_version DESC);

ALTER TABLE public.user_device_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_channel_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own device keys"
  ON public.user_device_keys FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "dm members can view recipient key envelopes"
  ON public.dm_channel_keys FOR SELECT
  USING (
    target_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.dm_channel_members m
      WHERE m.dm_channel_id = dm_channel_keys.dm_channel_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "dm members can insert recipient key envelopes"
  ON public.dm_channel_keys FOR INSERT
  WITH CHECK (
    wrapped_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.dm_channel_members m
      WHERE m.dm_channel_id = dm_channel_keys.dm_channel_id AND m.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.dm_channel_members m
      WHERE m.dm_channel_id = dm_channel_keys.dm_channel_id AND m.user_id = dm_channel_keys.target_user_id
    )
  );

CREATE POLICY "dm members can update recipient key envelopes"
  ON public.dm_channel_keys FOR UPDATE
  USING (
    wrapped_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.dm_channel_members m
      WHERE m.dm_channel_id = dm_channel_keys.dm_channel_id AND m.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.dm_channel_members m
      WHERE m.dm_channel_id = dm_channel_keys.dm_channel_id AND m.user_id = dm_channel_keys.target_user_id
    )
  )
  WITH CHECK (
    wrapped_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.dm_channel_members m
      WHERE m.dm_channel_id = dm_channel_keys.dm_channel_id AND m.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.dm_channel_members m
      WHERE m.dm_channel_id = dm_channel_keys.dm_channel_id AND m.user_id = dm_channel_keys.target_user_id
    )
  );

CREATE OR REPLACE FUNCTION public.prune_dm_channel_keys(p_dm_channel_id UUID, p_keep_versions INTEGER DEFAULT 5)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_version INTEGER;
BEGIN
  SELECT MAX(key_version) INTO v_max_version
  FROM public.dm_channel_keys
  WHERE dm_channel_id = p_dm_channel_id;

  IF v_max_version IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.dm_channel_keys
  WHERE dm_channel_id = p_dm_channel_id
    AND key_version <= (v_max_version - GREATEST(p_keep_versions, 1));
END;
$$;

CREATE OR REPLACE FUNCTION public.dm_channel_keys_prune_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_dm_channel_id UUID;
BEGIN
  FOR v_dm_channel_id IN
    SELECT DISTINCT dm_channel_id FROM new_rows
  LOOP
    PERFORM public.prune_dm_channel_keys(v_dm_channel_id, 5);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS dm_channel_keys_prune_after_write ON public.dm_channel_keys;
DROP TRIGGER IF EXISTS dm_channel_keys_prune_after_insert ON public.dm_channel_keys;
CREATE TRIGGER dm_channel_keys_prune_after_insert
  AFTER INSERT ON public.dm_channel_keys
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.dm_channel_keys_prune_trigger();

DROP TRIGGER IF EXISTS dm_channel_keys_prune_after_update ON public.dm_channel_keys;
CREATE TRIGGER dm_channel_keys_prune_after_update
  AFTER UPDATE ON public.dm_channel_keys
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.dm_channel_keys_prune_trigger();


CREATE OR REPLACE FUNCTION public.upsert_user_device_key(
  p_device_id TEXT,
  p_public_key TEXT,
  p_device_limit INTEGER DEFAULT 20
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.user_device_keys
  WHERE user_id = auth.uid()
    AND device_id <> p_device_id;

  IF v_count >= GREATEST(p_device_limit, 1) THEN
    RAISE EXCEPTION 'device_limit_reached';
  END IF;

  INSERT INTO public.user_device_keys (user_id, device_id, public_key, updated_at)
  VALUES (auth.uid(), p_device_id, p_public_key, NOW())
  ON CONFLICT (user_id, device_id)
  DO UPDATE SET
    public_key = EXCLUDED.public_key,
    updated_at = NOW();

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.dm_channel_rotate_on_member_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.dm_channels
  SET encryption_key_version = CASE WHEN is_encrypted THEN encryption_key_version + 1 ELSE encryption_key_version END,
      encryption_membership_epoch = CASE WHEN is_encrypted THEN encryption_membership_epoch + 1 ELSE encryption_membership_epoch END,
      updated_at = CASE WHEN is_encrypted THEN NOW() ELSE updated_at END
  WHERE id = COALESCE(NEW.dm_channel_id, OLD.dm_channel_id)
    AND is_encrypted = TRUE;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS dm_rotate_on_member_insert ON public.dm_channel_members;
CREATE TRIGGER dm_rotate_on_member_insert
  AFTER INSERT ON public.dm_channel_members
  FOR EACH ROW EXECUTE FUNCTION public.dm_channel_rotate_on_member_change();

DROP TRIGGER IF EXISTS dm_rotate_on_member_delete ON public.dm_channel_members;
CREATE TRIGGER dm_rotate_on_member_delete
  AFTER DELETE ON public.dm_channel_members
  FOR EACH ROW EXECUTE FUNCTION public.dm_channel_rotate_on_member_change();

-- ============================================================
-- Thread-level notification overrides
-- ============================================================
alter table if exists public.notification_settings
  add column if not exists thread_id uuid references public.threads(id) on delete cascade;

alter table if exists public.notification_settings
  drop constraint if exists notification_settings_scope_check;

alter table if exists public.notification_settings
  add constraint notification_settings_scope_check
  check (
    (
      server_id is null and channel_id is null and thread_id is null
    )
    or (
      server_id is not null and channel_id is null and thread_id is null
    )
    or (
      channel_id is not null and thread_id is null
    )
    or (
      thread_id is not null
    )
  );

create unique index if not exists notification_settings_user_thread_unique
  on public.notification_settings (user_id, thread_id)
  where thread_id is not null;
