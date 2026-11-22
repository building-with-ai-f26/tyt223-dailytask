-- Security round 2, F6: database-level limits (applied 2026-11-22).
-- Safe to re-run. Neither rule changes existing rows; both only refuse bad new writes.

-- 1. A save can't be bigger than 1 MB (a heavy real save is ~15 KB). Stops one account
--    from filling the free database by uploading a huge object.
alter table public.saves drop constraint if exists saves_data_size;
alter table public.saves add constraint saves_data_size check (octet_length(data::text) <= 1000000);

-- 2. Push addresses must be https and reasonably short (second layer behind the
--    push-service allow-list in supabase/functions/send-reminders/endpoints.ts).
alter table public.push_subscriptions drop constraint if exists push_endpoint_https;
alter table public.push_subscriptions add constraint push_endpoint_https check (endpoint like 'https://%' and length(endpoint) <= 1000);
