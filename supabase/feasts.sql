-- DailyQuest Tavern Feasts (Build 4): friends team up for 3 days to fill one table together. Safe to re-run.
-- Replaces the competitive battle rules in battles.sql; it reuses those tables (still named battles and
-- battle_players internally) and the private helpers.
--
-- Rules
-- - One feast at a time per person (waiting invites count until they expire after 2 days).
-- - Invite 1-5 accepted friends who leave "Open to feast invites" (profiles.duels_open) on.
-- - The first yes schedules it for tomorrow .. tomorrow + 2. Friends can still join until it starts.
-- - Each person's app reports XP per day; at most 150 a day counts (report_feast_xp).
-- - The table's goal is 60 XP per person per day: 180 x the number of people who joined.
-- - Rewards, the same for everyone, once it's over: full table 40 coins + a feast badge, at least half 15, otherwise 5.
-- - The host can cancel while nobody has said yes.

create or replace function public.start_feast(friend_ids bigint[], p_today date)
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
  if private.active_battles(me, p_today) >= 1 then return 'busy'; end if;
  if (select count(*) from public.battles where creator = me and created_at > now() - interval '1 day') >= 10 then return 'too_many'; end if;
  insert into public.battles (creator) values (me) returning id into bid;
  insert into public.battle_players (battle_id, user_id, status) values (bid, me, 'accepted');
  insert into public.battle_players (battle_id, user_id, status) select bid, o, 'invited' from unnest(others) o;
  return 'started';
end $$;

create or replace function public.respond_feast(p_battle bigint, p_accept boolean, p_today date)
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
  if private.active_battles(me, p_today) >= 1 then return 'busy'; end if;
  update public.battle_players set status = 'accepted' where battle_id = p_battle and user_id = me;
  update public.battles set status = 'active', start_day = p_today + 1, end_day = p_today + 3 where id = p_battle and status = 'waiting';
  return 'accepted';
end $$;

-- The host calls off a feast nobody has joined yet.
create or replace function public.cancel_feast(p_battle bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); n int;
begin
  if me is null then return false; end if;
  delete from public.battles where id = p_battle and creator = me and status = 'waiting';
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Same counting as before: days inside the window and not in the future, each capped at 150.
create or replace function public.report_feast_xp(p_today date, p_days jsonb)
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

-- Your feasts, with the table's goal and everyone's contribution (name, avatar, status, XP; no codes or ids).
create or replace function public.my_feasts()
returns table (id bigint, status text, start_day date, end_day date, created_at timestamptz, mine boolean, my_status text, claimed boolean, goal int, players jsonb)
language sql stable security definer set search_path = '' as $$
  select b.id, b.status, b.start_day, b.end_day, b.created_at, b.creator = (select auth.uid()), p.status, p.claimed,
    180 * (select count(*)::int from public.battle_players a where a.battle_id = b.id and a.status = 'accepted'),
    (select jsonb_agg(jsonb_build_object('name', pr.name, 'avatar', pr.avatar, 'status', q.status, 'xp', q.xp,
                                          'me', q.user_id = (select auth.uid()), 'creator', q.user_id = b.creator) order by q.user_id = b.creator desc, pr.name)
       from public.battle_players q join public.profiles pr on pr.user_id = q.user_id where q.battle_id = b.id)
  from public.battles b join public.battle_players p on p.battle_id = b.id and p.user_id = (select auth.uid())
  where p.status <> 'declined'
    and ((b.status = 'waiting' and b.created_at > now() - interval '4 days')
      or (b.status = 'active' and b.end_day >= (now() at time zone 'utc')::date - 14))
  order by b.created_at desc
  limit 20;
$$;

-- Collect your reward once the feast is over. Everyone gets the same: full table 40 + badge, half 15, otherwise 5.
create or replace function public.claim_feast_reward(p_battle bigint, p_today date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); p public.battle_players; b public.battles; n int; total int; goal int; coins int;
begin
  if me is null or not private.today_ok(p_today) then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  select * into p from public.battle_players where battle_id = p_battle and user_id = me for update;
  select * into b from public.battles where id = p_battle;
  if p.battle_id is null or p.status <> 'accepted' or b.status <> 'active' then return jsonb_build_object('ok', false, 'error', 'not_in_feast'); end if;
  if p_today <= b.end_day then return jsonb_build_object('ok', false, 'error', 'not_over'); end if;
  if p.claimed then return jsonb_build_object('ok', false, 'error', 'already_claimed'); end if;
  select count(*), coalesce(sum(xp), 0) into n, total from public.battle_players where battle_id = p_battle and status = 'accepted';
  goal := 180 * n;
  coins := case when total >= goal then 40 when total * 2 >= goal then 15 else 5 end;
  update public.battle_players set claimed = true where battle_id = p_battle and user_id = me;
  return jsonb_build_object('ok', true, 'full', total >= goal, 'total', total, 'goal', goal, 'players', n, 'coins', coins);
end $$;

revoke execute on function public.start_feast(bigint[], date), public.respond_feast(bigint, boolean, date), public.cancel_feast(bigint),
  public.report_feast_xp(date, jsonb), public.my_feasts(), public.claim_feast_reward(bigint, date) from public, anon;
grant execute on function public.start_feast(bigint[], date), public.respond_feast(bigint, boolean, date), public.cancel_feast(bigint),
  public.report_feast_xp(date, jsonb), public.my_feasts(), public.claim_feast_reward(bigint, date) to authenticated;

-- The old battle functions are removed once the app no longer calls them (see the second part, applied after the push):
-- drop function if exists public.start_battle(bigint[], date), public.respond_battle(bigint, boolean, date),
--   public.report_battle_xp(date, jsonb), public.my_battles(), public.claim_battle_prize(bigint, date);
