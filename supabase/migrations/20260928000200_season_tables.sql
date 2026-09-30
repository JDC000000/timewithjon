-- T0.2.03 settings, week, slot, availability_block (§6)
create table settings (
  id boolean primary key default true check (id),
  env settings_env not null,
  season_start date not null default '2027-04-01',
  season_end date not null default '2027-06-30',
  personal_open_at timestamptz not null default '2027-02-25T16:00:00Z',
  general_open_at timestamptz not null default '2027-03-01T16:00:00Z',
  default_weekly_cap int not null default 2 check (default_weekly_cap between 0 and 10),
  bigday_target int not null default 6,
  freebusy_calendar_ids text[] not null default array['primary'],
  reply_promise_days int not null default 2,
  before60_enabled boolean not null default false,
  household_hold_released boolean not null default false,
  story_deadline date not null default '2027-12-31',
  updated_at timestamptz not null default now()
);
create table week (
  week_start date primary key check (extract(isodow from week_start) = 1),
  cap_override int null check (cap_override between 0 and 10),
  note text
);
create table slot (
  id uuid primary key default gen_random_uuid(),
  date date not null check (extract(isodow from date) in (4,5)),
  window_kind slot_window not null,           -- TSD name `window` is a reserved word in Postgres
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  unique (date, window_kind)
);
create table availability_block (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  kind block_kind not null,
  confirm_by date null,
  note text,
  created_at timestamptz not null default now()
);
