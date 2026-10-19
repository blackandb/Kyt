-- KYT Monitor — automatic sync every minute
-- Replace YOUR_APP_URL and YOUR_CRON_SECRET, then run in Supabase SQL Editor.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('kyt-monitor-sync')
where exists (select 1 from cron.job where jobname = 'kyt-monitor-sync');

select cron.schedule(
  'kyt-monitor-sync',
  '* * * * *',
  $$
  select net.http_get(
    url := 'https://YOUR_APP_URL/api/cron/sync',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET'),
    timeout_milliseconds := 55000
  );
  $$
);

-- Daily sanctions list refresh (03:10 UTC)
select cron.unschedule('kyt-monitor-sanctions')
where exists (select 1 from cron.job where jobname = 'kyt-monitor-sanctions');

select cron.schedule(
  'kyt-monitor-sanctions',
  '10 3 * * *',
  $$
  select net.http_get(
    url := 'https://YOUR_APP_URL/api/cron/sanctions',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET'),
    timeout_milliseconds := 55000
  );
  $$
);
