-- Every minute, ask the app to send due pushes.
-- Needs two Vault secrets (run once after deploying, see README):
--   select vault.create_secret('https://your-app.vercel.app', 'app_url');
--   select vault.create_secret('<CRON_SECRET from .env>', 'cron_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'nudgebook-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )
  where exists (select 1 from public.reminder_pings where sent_at is null and send_at <= now());
  $$
);
