-- Runs the send-reminders Edge Function every 15 minutes.
-- Run once after the function is deployed (SQL Editor -> New query -> paste -> Run).
-- The key in the header is the project's public anon key (the same kind that's in the app), not a secret.
-- Calling the function more often is harmless: push_log makes sure each reminder is sent only once.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('dailyquest-send-reminders') where exists (select 1 from cron.job where jobname = 'dailyquest-send-reminders');
select cron.schedule(
  'dailyquest-send-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://vewmdwohvtruavpcsrow.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZld21kd29odnRydWF2cGNzcm93Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUyMTQxODAsImV4cCI6MjExMDc5MDE4MH0.ja6lxD3Zfs8RY5NOAG6188snHIoG1I4l_udxnhjjKfw'
    ),
    body := '{}'::jsonb
  );
  $$
);
