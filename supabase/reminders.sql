-- DailyQuest reminders: tables for push notifications.
-- Run once after schema.sql (SQL Editor -> New query -> paste -> Run). The schedule that
-- calls the send-reminders function every 15 minutes is in reminders-schedule.sql.

-- Phones that turned on reminders (one row per device).
create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint   text not null unique,                    -- the phone's push address (from the browser)
  p256dh     text not null,                           -- the phone's encryption keys for this address
  auth       text not null,
  tz         text not null default 'America/New_York', -- so "8:00 AM" means the user's own 8:00
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;
drop policy if exists "Read own devices" on public.push_subscriptions;
drop policy if exists "Add own devices" on public.push_subscriptions;
drop policy if exists "Update own devices" on public.push_subscriptions;
drop policy if exists "Remove own devices" on public.push_subscriptions;
create policy "Read own devices" on public.push_subscriptions for select to authenticated using ((select auth.uid()) = user_id);
create policy "Add own devices" on public.push_subscriptions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own devices" on public.push_subscriptions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Remove own devices" on public.push_subscriptions for delete to authenticated using ((select auth.uid()) = user_id);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Reminders already sent, so each one goes out once. Only the server function (service role) touches it.
create table if not exists public.push_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  key     text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.push_log enable row level security;
revoke all on table public.push_log from anon, authenticated;

-- The send-reminders function runs as service_role. Newer projects don't grant table access by default.
grant select on table public.saves to service_role;
grant select, delete on table public.push_subscriptions to service_role;
grant select, insert, delete on table public.push_log to service_role;
