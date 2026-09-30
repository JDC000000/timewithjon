-- T3.9.02 (TSD AD-8, M5). Lane L4. pg_cron calls the app through pg_net:
--   twj-tick  every 15 min -> POST /api/cron/tick   (timeout 10 s; the endpoint finishes in under 8 s)
--   twj-media every 5 min  -> POST /api/jobs/media  (timeout 120 s; the endpoint is T3.6, lane L6)
-- The app URL and the cron secret live in Supabase Vault ('twj_app_url', 'twj_cron_secret'), created once per
-- environment by the operator (a merge-time step), and are read when each job runs: never in this file.
-- cron.schedule() with an existing job name replaces that job, so this file can run again safely.
-- The lines marked TWJ:SUPABASE-ONLY are skipped by the plain Postgres 15 test database (scripts/test-db.sh).
create extension if not exists pg_cron; -- TWJ:SUPABASE-ONLY
create extension if not exists pg_net with schema extensions; -- TWJ:SUPABASE-ONLY
select cron.schedule('twj-tick', '*/15 * * * *', $job$ select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'twj_app_url') || '/api/cron/tick', headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'twj_cron_secret')), body := '{}'::jsonb, timeout_milliseconds := 10000) $job$); -- TWJ:SUPABASE-ONLY
select cron.schedule('twj-media', '*/5 * * * *', $job$ select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'twj_app_url') || '/api/jobs/media', headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'twj_cron_secret')), body := '{}'::jsonb, timeout_milliseconds := 120000) $job$); -- TWJ:SUPABASE-ONLY
