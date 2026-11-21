-- DailyQuest accounts: one saved game per user.
-- Run once in Supabase: SQL Editor -> New query -> paste this file -> Run.

create table if not exists public.saves (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,                       -- the whole DailyQuest save (quests, XP, rewards, settings)
  updated_at timestamptz not null default now()    -- set by the app on every save; used to spot changes from other devices
);

-- Table access: signed-in users may read and write rows (the policies below still limit them to their own row);
-- anonymous visitors get nothing. Newer Supabase projects don't grant this automatically.
revoke all on table public.saves from anon;
revoke all on table public.saves from authenticated;
grant select, insert, update, delete on table public.saves to authenticated;

-- Row Level Security: this is what makes the public "publishable" key safe to put in the page.
-- With it on, a signed-in user can only see and change the one row whose user_id is their own id,
-- and people who aren't signed in can't read or write anything.
alter table public.saves enable row level security;

drop policy if exists "Read own save" on public.saves;
drop policy if exists "Create own save" on public.saves;
drop policy if exists "Update own save" on public.saves;
drop policy if exists "Delete own save" on public.saves;

create policy "Read own save" on public.saves
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Create own save" on public.saves
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own save" on public.saves
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Delete own save" on public.saves
  for delete to authenticated using ((select auth.uid()) = user_id);
