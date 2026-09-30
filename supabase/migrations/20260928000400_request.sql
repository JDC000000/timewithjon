-- T0.2.05 request (§6) incl. the GiST exclusion constraint and slot partial unique index
create table request (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  client_key uuid not null unique,
  guest_id uuid not null references guest(id),
  invite_id uuid not null references invite(id),
  contact_name text not null check (char_length(contact_name) between 1 and 80),
  contact_email citext not null check (char_length(contact_email) <= 254),
  contact_phone text check (char_length(contact_phone) <= 30),
  dish text not null,
  mode request_mode not null,
  status request_status not null default 'requested',
  spam_suspect boolean not null default false,
  crew_size int not null default 1 check (crew_size between 1 and 99),
  big_crew boolean not null default false,
  guest_time_zone text null,
  contact_problem contact_problem null,
  guest_rsvp guest_rsvp null,
  joined_to_request_id uuid null references request(id),
  closed_in_person boolean not null default false,
  note text check (char_length(note) <= 1000),
  date_prefs jsonb,
  overnight boolean not null default false,
  pitch_idea text check (char_length(pitch_idea) <= 2000),
  surprise_need_to_know text check (char_length(surprise_need_to_know) <= 2000),
  surprise_plan_sealed text check (char_length(surprise_plan_sealed) <= 2000),
  standby_week date null references week(week_start),
  counts_toward counts_toward not null,
  locked_slot_id uuid null references slot(id),
  locked_starts_at timestamptz,
  locked_ends_at timestamptz,
  locked_where text,
  google_event_id text,
  calendar_state calendar_state not null default 'none',
  ics_sequence int not null default 0,
  before60_note text,
  jon_note text,
  created_at timestamptz not null default now(),
  awaiting_jon_since timestamptz,
  nudged_for timestamptz,
  cancelled_at timestamptz,
  cancelled_by cancelled_by,
  constraint request_big_crew_ck check (big_crew = (crew_size >= 16)),
  -- Both ends NOT NULL: a NULL end makes the CHECK pass as NULL and the range unbounded, which would block
  -- every later lock in the season through request_no_overlap (review T4.2.00 M2).
  constraint request_locked_range_ck check (
    status not in ('locked', 'done') or joined_to_request_id is not null
    or (locked_starts_at is not null and locked_ends_at is not null and locked_ends_at > locked_starts_at)),
  constraint request_no_overlap exclude using gist (tstzrange(locked_starts_at, locked_ends_at) with &&)
    where (status = 'locked' and joined_to_request_id is null)
);
create unique index request_locked_slot_uq on request (locked_slot_id)
  where status = 'locked' and joined_to_request_id is null;
create index request_awaiting_idx on request (awaiting_jon_since) where awaiting_jon_since is not null;
create index request_status_idx on request (status);
create index request_guest_idx on request (guest_id);
