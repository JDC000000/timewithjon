-- ops/seed-season.sql — T3.16.01 (staging) and T3.1 (production): settings + the season's weeks and slots.
-- Operator-run, once per project, after `supabase db push`:
--   psql "$DIRECT_URL?sslmode=verify-full&sslrootcert=<ca>" -v ON_ERROR_STOP=1 -v env=staging -f ops/seed-season.sql
-- env must be staging or production. If a settings row already exists with another env, it fails (exit 3) and
-- changes nothing.
-- No invites here: real ones come from scripts/create-invite.ts (random secrets, never committed).
-- Release times deliberately use the migration defaults (personal 2027-02-25, general 2027-03-01, 16:00Z).
-- PROTO's live DB was opened by hand for the Oct 2026 social test (T1.7.10); never copy that here.
-- The weeks/slots below must match supabase/seed.sql (tests/int/seed-season.int.test.ts checks it).
-- Any error stops psql with exit 3 and rolls the whole seed back (one transaction).
\set ON_ERROR_STOP on
\if :{?env}
\else
  do $$ begin raise exception 'missing -v env=staging|production'; end $$;
\endif
-- Never 'prototype': features/dev/guard.ts trusts settings.env, so staging/production must not carry that label.
select :'env' in ('staging', 'production') as env_ok \gset
\if :env_ok
\else
  do $$ begin raise exception 'env must be staging or production'; end $$;
\endif

begin;

insert into settings (env) values (:'env') on conflict (id) do nothing;
-- ON CONFLICT DO NOTHING keeps an existing row (e.g. supabase/seed.sql's 'prototype'): fail instead of leaving it.
select set_config('twj.seed_env', :'env', true);
do $$ begin
  if (select env::text from settings) is distinct from current_setting('twj.seed_env') then
    raise exception 'settings.env is %, expected %', (select env from settings), current_setting('twj.seed_env');
  end if;
end $$;

insert into week (week_start)
select d::date from generate_series('2027-03-29'::date, '2027-06-28'::date, interval '7 days') d
on conflict do nothing;

insert into slot (date, window_kind, starts_at, ends_at)
select d::date, w.k::slot_window,
       (d::date + w.s) at time zone 'America/Vancouver',
       (d::date + w.e) at time zone 'America/Vancouver'
from generate_series('2027-04-01'::date, '2027-06-30'::date, interval '1 day') d
cross join (values ('lunch', time '12:00', time '14:00'), ('evening', time '19:00', time '22:00')) w(k, s, e)
where extract(isodow from d) in (4, 5)
on conflict (date, window_kind) do nothing;

commit;
