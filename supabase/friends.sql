-- DailyQuest friends (Build 4, batch 1). Safe to re-run.
--
-- profiles     = each player's public hero card: nickname, friend code, avatar, level, streak, XP this week.
--                Never quest names, calendars, rewards or email. Players read and write ONLY their own row;
--                friends' cards come through friend_list(), which hides stats until a request is accepted.
-- friendships  = friend requests (pending) and friends (accepted). No direct table access at all:
--                every read and change goes through the functions below, which check who is asking.

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 2 and 20),
  code       text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),          -- no 0/O/1/I, easy to read aloud
  avatar     text not null default 'mint' check (avatar ~ '^[a-z]{1,16}$'),
  level      int  not null default 1 check (level between 1 and 100000),
  streak     int  not null default 0 check (streak between 0 and 100000),
  week_xp    int  not null default 0 check (week_xp between 0 and 1000000),
  week       text not null default '' check (week = '' or week ~ '^\d{4}-\d{2}-\d{2}$'),  -- Monday the week_xp belongs to
  searchable boolean not null default true,    -- "Let classmates find me by nickname"
  duels_open boolean not null default true,    -- "Open to duels" (used by batch 2)
  updated_at timestamptz not null default now()
);

create table if not exists public.friendships (
  id         bigint generated always as identity primary key,
  requester  uuid not null references public.profiles(user_id) on delete cascade,
  addressee  uuid not null references public.profiles(user_id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
create unique index if not exists friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists friendships_addressee on public.friendships (addressee);

-- Row Level Security + explicit grants (AGENTS.md rule 7)
alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
revoke all on public.profiles, public.friendships from anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles, public.friendships to service_role;

drop policy if exists "own profile: read" on public.profiles;
drop policy if exists "own profile: create" on public.profiles;
drop policy if exists "own profile: change" on public.profiles;
drop policy if exists "own profile: delete" on public.profiles;
create policy "own profile: read"   on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy "own profile: create" on public.profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own profile: change" on public.profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own profile: delete" on public.profiles for delete to authenticated using (user_id = (select auth.uid()));
-- friendships: RLS on with no policies = no direct access; only the functions below (security definer) touch it.

-- Find players by exact friend code, or by nickname prefix (only players who allow it). At most 8 results,
-- and only name, code, avatar and level.
create or replace function public.find_players(q text)
returns table (name text, code text, avatar text, level int)
language sql stable security definer set search_path = '' as $$
  with t as (select left(btrim(coalesce(q, '')), 20) as q)
  select p.name, p.code, p.avatar, p.level
  from public.profiles p, t
  where (select auth.uid()) is not null
    and p.user_id <> (select auth.uid())
    and char_length(t.q) >= 3
    and (p.code = upper(t.q)
         or (p.searchable and p.name ilike replace(replace(replace(t.q, '\', '\\'), '%', '\%'), '_', '\_') || '%'))
  order by (p.code = upper(t.q)) desc, p.level desc, p.name
  limit 8;
$$;

-- Send a friend request by code. If they already asked you, this accepts it instead.
-- Returns: sent | accepted | already | not_found | self | no_profile | too_many | login_required
create or replace function public.request_friend(target_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); other uuid; f public.friendships;
begin
  if me is null then return 'login_required'; end if;
  if not exists (select 1 from public.profiles where user_id = me) then return 'no_profile'; end if;
  select user_id into other from public.profiles where code = upper(btrim(coalesce(target_code, '')));
  if other is null then return 'not_found'; end if;
  if other = me then return 'self'; end if;
  select * into f from public.friendships
    where least(requester, addressee) = least(me, other) and greatest(requester, addressee) = greatest(me, other);
  if found then
    if f.status = 'pending' and f.addressee = me then
      update public.friendships set status = 'accepted' where id = f.id;
      return 'accepted';
    end if;
    return 'already';
  end if;
  -- spam limits: 20 unanswered requests, 200 friends
  if (select count(*) from public.friendships where requester = me and status = 'pending') >= 20
     or (select count(*) from public.friendships where me in (requester, addressee) and status = 'accepted') >= 200 then
    return 'too_many';
  end if;
  insert into public.friendships (requester, addressee) values (me, other);
  return 'sent';
end $$;

-- Accept or decline a request sent TO you.
create or replace function public.respond_friend(request_id bigint, accept boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); n int;
begin
  if me is null then return false; end if;
  if accept then
    update public.friendships set status = 'accepted' where id = request_id and addressee = me and status = 'pending';
  else
    delete from public.friendships where id = request_id and addressee = me and status = 'pending';
  end if;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Unfriend, or cancel a request you sent. Either side may do it.
create or replace function public.remove_friend(request_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); n int;
begin
  if me is null then return false; end if;
  delete from public.friendships where id = request_id and me in (requester, addressee);
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Your friends and requests. Level, streak and weekly XP are shown only once a request is accepted.
create or replace function public.friend_list()
returns table (id bigint, status text, incoming boolean, name text, code text, avatar text, level int,
               streak int, week_xp int, week text, duels_open boolean, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select f.id, f.status, f.addressee = (select auth.uid()), p.name, p.code, p.avatar, p.level,
         case when f.status = 'accepted' then p.streak end,
         case when f.status = 'accepted' then p.week_xp end,
         case when f.status = 'accepted' then p.week end,
         case when f.status = 'accepted' then p.duels_open end,
         case when f.status = 'accepted' then p.updated_at end
  from public.friendships f
  join public.profiles p on p.user_id = case when f.requester = (select auth.uid()) then f.addressee else f.requester end
  where (select auth.uid()) in (f.requester, f.addressee)
  order by f.created_at;
$$;

revoke execute on function public.find_players(text), public.request_friend(text), public.respond_friend(bigint, boolean),
  public.remove_friend(bigint), public.friend_list() from public, anon;
grant execute on function public.find_players(text), public.request_friend(text), public.respond_friend(bigint, boolean),
  public.remove_friend(bigint), public.friend_list() to authenticated;
