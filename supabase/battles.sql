-- DailyQuest battles (Build 4, batch 2) and the weekly Tavern Champion. Safe to re-run.
--
-- A battle is 2 to 6 friends competing for 3 days on XP earned from quests. The creator challenges 1-5 accepted
-- friends who have "Open to battles" on; each accepts or declines. When the first friend accepts, the battle is
-- scheduled to start the NEXT day and run 3 full days (start_day .. end_day). Each player's app reports XP per day
-- (counted at most 150 per day); when the battle is over each player claims their own prize once.
-- Dates are the players' local dates, checked to be within one day of the server's date.
-- No direct table access: everything goes through the functions below, which check who is asking.

-- 1. Last week's XP on the hero card, for the Tavern Champion crown.
alter table public.profiles add column if not exists last_week_xp int not null default 0;
alter table public.profiles add column if not exists last_week text not null default '';
alter table public.profiles drop constraint if exists profiles_last_week_xp_range;
alter table public.profiles add constraint profiles_last_week_xp_range check (last_week_xp between 0 and 1000000);
alter table public.profiles drop constraint if exists profiles_last_week_format;
alter table public.profiles add constraint profiles_last_week_format check (last_week = '' or last_week ~ '^\d{4}-\d{2}-\d{2}$');

-- 2. Battles
create table if not exists public.battles (
  id         bigint generated always as identity primary key,
  creator    uuid not null references public.profiles(user_id) on delete cascade,
  status     text not null default 'waiting' check (status in ('waiting', 'active')),
  start_day  date,
  end_day    date,
  created_at timestamptz not null default now(),
  check ((status = 'waiting' and start_day is null and end_day is null) or (status = 'active' and start_day is not null and end_day = start_day + 2))
);
create table if not exists public.battle_players (
  battle_id bigint not null references public.battles(id) on delete cascade,
  user_id   uuid not null references public.profiles(user_id) on delete cascade,
  status    text not null check (status in ('invited', 'accepted', 'declined')),
  days      jsonb not null default '{}'::jsonb,          -- { "2026-11-26": 120, ... } XP counted per day, each at most 150
  xp        int not null default 0 check (xp between 0 and 100000),
  claimed   boolean not null default false,
  primary key (battle_id, user_id)
);
create index if not exists battle_players_user on public.battle_players (user_id);
create index if not exists battles_creator on public.battles (creator, created_at);

alter table public.battles enable row level security;
alter table public.battle_players enable row level security;
revoke all on public.battles, public.battle_players from anon, authenticated;
grant all on public.battles, public.battle_players to service_role;
-- RLS on with no policies = no direct access; only the functions below touch these tables.

-- 3. Private helpers (not reachable through the API)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.today_ok(p_today date) returns boolean
language sql stable set search_path = '' as $$
  select p_today between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date + 1;
$$;
-- Battles a player is in that still count toward the limit of 3: waiting (invites expire after 2 days) or not yet over.
create or replace function private.active_battles(p_user uuid, p_today date) returns int
language sql stable set search_path = '' as $$
  select count(*)::int from public.battles b join public.battle_players p on p.battle_id = b.id
  where p.user_id = p_user and p.status = 'accepted'
    and ((b.status = 'waiting' and b.created_at > now() - interval '2 days') or (b.status = 'active' and b.end_day >= p_today));
$$;
revoke all on function private.today_ok(date), private.active_battles(uuid, date) from public, anon, authenticated;

-- 4. Functions the app calls
-- Challenge 1-5 accepted friends (by friendship id). Returns: started | not_friends | closed | too_many | bad_size | bad_date | no_profile | login_required
create or replace function public.start_battle(friend_ids bigint[], p_today date)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); others uuid[]; wanted int; bid bigint;
begin
  if me is null then return 'login_required'; end if;
  if not private.today_ok(p_today) then return 'bad_date'; end if;
  if not exists (select 1 from public.profiles where user_id = me) then return 'no_profile'; end if;
  select count(distinct x) into wanted from unnest(coalesce(friend_ids, '{}')) x;
  if wanted < 1 or wanted > 5 then return 'bad_size'; end if;
  select array_agg(distinct case when f.requester = me then f.addressee else f.requester end) into others
    from public.friendships f where f.id = any(friend_ids) and f.status = 'accepted' and me in (f.requester, f.addressee);
  if others is null or cardinality(others) <> wanted then return 'not_friends'; end if;
  if exists (select 1 from public.profiles where user_id = any(others) and not duels_open) then return 'closed'; end if;
  if private.active_battles(me, p_today) >= 3
     or (select count(*) from public.battles where creator = me and created_at > now() - interval '1 day') >= 10 then
    return 'too_many';
  end if;
  insert into public.battles (creator) values (me) returning id into bid;
  insert into public.battle_players (battle_id, user_id, status) values (bid, me, 'accepted');
  insert into public.battle_players (battle_id, user_id, status) select bid, o, 'invited' from unnest(others) o;
  return 'started';
end $$;

-- Accept or decline a battle invite. The first acceptance schedules the battle for tomorrow .. tomorrow + 2.
-- Returns: accepted | declined | not_invited | expired | too_late | too_many | bad_date | login_required
create or replace function public.respond_battle(p_battle bigint, p_accept boolean, p_today date)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); my_status text; b public.battles;
begin
  if me is null then return 'login_required'; end if;
  if not private.today_ok(p_today) then return 'bad_date'; end if;
  select p.status into my_status from public.battle_players p where p.battle_id = p_battle and p.user_id = me for update;
  select * into b from public.battles where id = p_battle;
  if my_status is null or my_status <> 'invited' or b.id is null then return 'not_invited'; end if;
  if not p_accept then
    update public.battle_players set status = 'declined' where battle_id = p_battle and user_id = me;
    return 'declined';
  end if;
  if b.status = 'waiting' and b.created_at <= now() - interval '2 days' then return 'expired'; end if;
  if b.status = 'active' and p_today >= b.start_day then return 'too_late'; end if;
  if private.active_battles(me, p_today) >= 3 then return 'too_many'; end if;
  update public.battle_players set status = 'accepted' where battle_id = p_battle and user_id = me;
  update public.battles set status = 'active', start_day = p_today + 1, end_day = p_today + 3 where id = p_battle and status = 'waiting';
  return 'accepted';
end $$;

-- The app reports XP earned per local day (at most 7 days). Only days inside a battle's window and not in the
-- future count, each capped at 150. Returns how many battles were updated.
create or replace function public.report_battle_xp(p_today date, p_days jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); r record; k text; v text; d date; newdays jsonb; n int := 0;
begin
  if me is null or not private.today_ok(p_today) or jsonb_typeof(p_days) <> 'object' then return 0; end if;
  if (select count(*) from jsonb_object_keys(p_days)) > 7 then return 0; end if;
  for r in
    select p.battle_id, p.days, b.start_day, b.end_day from public.battle_players p join public.battles b on b.id = p.battle_id
    where p.user_id = me and p.status = 'accepted' and b.status = 'active' and b.start_day <= p_today and b.end_day >= p_today - 1
  loop
    newdays := r.days;
    for k, v in select key, value from jsonb_each_text(p_days) loop
      if k ~ '^\d{4}-\d{2}-\d{2}$' and v ~ '^\d{1,6}$' then
        d := k::date;
        if d between r.start_day and least(r.end_day, p_today) then newdays := newdays || jsonb_build_object(k, least(v::int, 150)); end if;
      end if;
    end loop;
    update public.battle_players
      set days = newdays, xp = (select coalesce(sum(value::int), 0) from jsonb_each_text(newdays))
      where battle_id = r.battle_id and user_id = me;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Your battles (waiting ones for 4 days, active ones until 14 days after they end), with every player's name,
-- avatar, status and XP. No friend codes or user ids.
create or replace function public.my_battles()
returns table (id bigint, status text, start_day date, end_day date, created_at timestamptz, mine boolean, my_status text, claimed boolean, players jsonb)
language sql stable security definer set search_path = '' as $$
  select b.id, b.status, b.start_day, b.end_day, b.created_at, b.creator = (select auth.uid()), p.status, p.claimed,
    (select jsonb_agg(jsonb_build_object('name', pr.name, 'avatar', pr.avatar, 'status', q.status, 'xp', q.xp,
                                          'me', q.user_id = (select auth.uid()), 'creator', q.user_id = b.creator) order by q.xp desc, pr.name)
       from public.battle_players q join public.profiles pr on pr.user_id = q.user_id where q.battle_id = b.id)
  from public.battles b join public.battle_players p on p.battle_id = b.id and p.user_id = (select auth.uid())
  where p.status <> 'declined'
    and ((b.status = 'waiting' and b.created_at > now() - interval '4 days')
      or (b.status = 'active' and b.end_day >= (now() at time zone 'utc')::date - 14))
  order by b.created_at desc
  limit 20;
$$;

-- Claim your own prize once a battle is over. Winner (most XP, more than 0): 50 coins + a trophy.
-- In battles of 3+: 2nd 25, 3rd 10. Everyone else who took part: 5. Ties share the better place.
create or replace function public.claim_battle_prize(p_battle bigint, p_today date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); p public.battle_players; b public.battles; n int; place int; coins int;
begin
  if me is null or not private.today_ok(p_today) then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  select * into p from public.battle_players where battle_id = p_battle and user_id = me for update;
  select * into b from public.battles where id = p_battle;
  if p.battle_id is null or p.status <> 'accepted' or b.status <> 'active' then return jsonb_build_object('ok', false, 'error', 'not_in_battle'); end if;
  if p_today <= b.end_day then return jsonb_build_object('ok', false, 'error', 'not_over'); end if;
  if p.claimed then return jsonb_build_object('ok', false, 'error', 'already_claimed'); end if;
  select count(*) into n from public.battle_players where battle_id = p_battle and status = 'accepted';
  select 1 + count(*) into place from public.battle_players where battle_id = p_battle and status = 'accepted' and xp > p.xp;
  coins := case when p.xp = 0 then 5 when place = 1 then 50 when n >= 3 and place = 2 then 25 when n >= 3 and place = 3 then 10 else 5 end;
  update public.battle_players set claimed = true where battle_id = p_battle and user_id = me;
  return jsonb_build_object('ok', true, 'place', place, 'players', n, 'coins', coins, 'trophy', p.xp > 0 and place = 1, 'xp', p.xp);
end $$;

-- 5. friend_list now also returns last week's XP (for the Tavern Champion crown); the return type changes, so recreate it.
drop function if exists public.friend_list();
create function public.friend_list()
returns table (id bigint, status text, incoming boolean, name text, code text, avatar text, level int,
               streak int, week_xp int, week text, duels_open boolean, updated_at timestamptz, last_week_xp int, last_week text)
language sql stable security definer set search_path = '' as $$
  select f.id, f.status, f.addressee = (select auth.uid()), p.name, p.code, p.avatar, p.level,
         case when f.status = 'accepted' then p.streak end,
         case when f.status = 'accepted' then p.week_xp end,
         case when f.status = 'accepted' then p.week end,
         case when f.status = 'accepted' then p.duels_open end,
         case when f.status = 'accepted' then p.updated_at end,
         case when f.status = 'accepted' then p.last_week_xp end,
         case when f.status = 'accepted' then p.last_week end
  from public.friendships f
  join public.profiles p on p.user_id = case when f.requester = (select auth.uid()) then f.addressee else f.requester end
  where (select auth.uid()) in (f.requester, f.addressee)
  order by f.created_at;
$$;

revoke execute on function public.friend_list(), public.start_battle(bigint[], date), public.respond_battle(bigint, boolean, date),
  public.report_battle_xp(date, jsonb), public.my_battles(), public.claim_battle_prize(bigint, date) from public, anon;
grant execute on function public.friend_list(), public.start_battle(bigint[], date), public.respond_battle(bigint, boolean, date),
  public.report_battle_xp(date, jsonb), public.my_battles(), public.claim_battle_prize(bigint, date) to authenticated;
