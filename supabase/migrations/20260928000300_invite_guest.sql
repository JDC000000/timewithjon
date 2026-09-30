-- T0.2.04 invite + guest (§6, C2). v1.8: invite.our_things replaces jon_line.
-- "Our things": '{}' (blank -> open-link line) or up to 3 phrases. Each phrase: 1-40 characters, 1-4 words split
-- by plain spaces, no leading/trailing space, no commas, no control or non-space whitespace characters.
-- IDENTICAL to ourThingError() in src/features/invites/our-things.ts (shared case table: tests/fixtures/our-things-cases.ts).
create function our_things_ok(a text[]) returns boolean language sql immutable set search_path = pg_catalog as $$
  select a is not null
     and coalesce(array_ndims(a), 1) = 1
     and cardinality(a) <= 3
     and not exists (
       select 1 from unnest(a) t
        where t is null
           or char_length(t) not between 1 and 40
           or t ~ '[,\u0001-\u001F\u007F-\u009F\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]'
           or t ~ '^ | $'
           or cardinality(regexp_split_to_array(t, ' +')) > 4)
$$;
create table invite (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  kind invite_kind not null,
  token_secret text not null unique check (token_secret ~ '^[0-9a-hjkmnp-tv-z]{8}$'),
  name_slug text not null check (name_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  display_name text,
  our_things text[] not null default '{}' check (our_things_ok(our_things)),
  picked_dish text null,
  prefill_name text,
  prefill_email citext null,
  hoped_for boolean not null default false,
  revoked_at timestamptz,
  first_opened_at timestamptz,
  open_count int not null default 0,
  created_at timestamptz not null default now()
);
create unique index invite_one_active_general on invite (kind) where kind = 'general' and revoked_at is null;
create table guest (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  first_name_seen text,
  created_at timestamptz not null default now()
);
