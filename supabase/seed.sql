-- supabase/seed.sql — T0.2.11 (prototype). Staging and production use ops/seed-season.sql (env=staging|production).
-- PROTO OVERRIDE (T1.7.10, 2026-09-25): the live proto DB has both release times set to 2026-09-01 16:00Z by hand
-- for the Oct social test. This file keeps the 2027 defaults; never copy the override to staging/production.
insert into settings (env) values ('prototype') on conflict (id) do nothing;

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

-- Prototype invites (§5.5): 1 general + 2 personal demos. Fixed secrets = proto DB only; E2E relies on them.
-- The 5 social-test invites are created by scripts/create-invite.ts in T1.11 (random secrets, never committed).
insert into invite (kind, token_secret, name_slug, display_name, is_test) values
  ('general', 'g3hx8q2v', 'friends', null, true)
on conflict do nothing;
insert into invite (kind, token_secret, name_slug, display_name, our_things, picked_dish, prefill_name, prefill_email, hoped_for, is_test) values
  ('personal', 'k7q2m9xp', 'dave', 'Dave', array['the Seymour lap', 'Tofino again'], 'the-shore-ride', 'Dave', 'dave@example.com', true, true),
  ('personal', 'p4r8t2wz', 'priya', 'Priya', '{}', 'the-long-lunch', 'Priya', null, true, true) -- blank our_things: falls back to the open-link line
on conflict do nothing;
