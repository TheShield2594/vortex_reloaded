alter table if exists public.users
  add column if not exists discoverable boolean not null default false;

drop policy if exists "Users can view all profiles" on public.users;

create policy "Users can view all profiles"
  on public.users
  for select
  using (
    auth.uid() = id
    or discoverable = true
    or exists (
      select 1
      from public.server_members sm_target
      join public.server_members sm_self
        on sm_self.server_id = sm_target.server_id
      where sm_target.user_id = users.id
        and sm_self.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = users.id)
          or (f.addressee_id = auth.uid() and f.requester_id = users.id)
        )
    )
  );
