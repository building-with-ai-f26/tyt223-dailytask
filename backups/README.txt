DailyQuest manual database backups (git-ignored: never commit these files).

Supabase's free plan has no automatic backups, so before any database change the coding agent
exports every table here as JSON with a read-only query:

  select json_build_object('exported_at', now(),
    'saves', (select coalesce(json_agg(s), '[]'::json) from public.saves s),
    'push_subscriptions', (select coalesce(json_agg(p), '[]'::json) from public.push_subscriptions p),
    'push_log', (select coalesce(json_agg(l), '[]'::json) from public.push_log l));

To restore a user's save, insert/update public.saves (user_id, data, updated_at) from the file
in the Supabase SQL Editor. The files contain personal quests and private calendar links.
