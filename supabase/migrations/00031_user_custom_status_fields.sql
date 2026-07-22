alter table if exists public.users
  add column if not exists status_emoji text,
  add column if not exists status_expires_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_status_emoji_length_check'
  ) then
    alter table public.users
      add constraint users_status_emoji_length_check
      check (char_length(status_emoji) <= 8);
  end if;
end $$;
