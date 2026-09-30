-- T0.2.08 email_suppression, email_log, email_budget, email_queue, outbox, system_status, oauth_connection, freebusy_cache
-- (inbound_message removed in TSD v1.4: inbound is Cloudflare Email Routing -> Jon's Gmail)
create table email_suppression (
  email citext primary key,
  reason suppression_reason not null,
  at timestamptz not null default now()
);
create table email_log (
  id uuid primary key default gen_random_uuid(),
  template text not null check (template in ('E1','E2','E3','E4','E4m','E5','E5b','E6','E7','E8','E9','E10','E11','E12','E13','E14','E16')),
  to_email citext not null,
  request_id uuid null references request(id) on delete set null,
  event_key text,
  resend_id text,
  status email_status not null default 'pending',
  -- L-3 retry (review T4.2.00 M4): rows are queued 'pending' inside the transaction, sent after commit, and
  -- re-sent by the tick job 'email-retry' at +5/+15/+30 min (the §6 outbox cadence), 4 attempts in all.
  -- vars = the template inputs, so a retry can re-render. Never a rendered body (dev_outbox holds those).
  vars jsonb not null default '{}'::jsonb check (jsonb_typeof(vars) = 'object'),
  attempts int not null default 0 check (attempts between 0 and 4),
  next_attempt_at timestamptz not null default now() + interval '5 minutes',
  last_error text check (char_length(last_error) <= 200), -- an error class name only, never a message (PII)
  created_at timestamptz not null default now(),
  constraint email_log_idem unique nulls not distinct (template, request_id, event_key)
);
create index email_log_retry_idx on email_log (next_attempt_at) where status in ('pending', 'failed');
create index email_log_to_day_idx on email_log (to_email, template, created_at);
-- AD-5 daily-cap guard (v1.4): one row per UTC day; budget 90, reserve 10.
create table email_budget (
  utc_day date primary key,
  sent_count int not null default 0,
  digest_mode boolean not null default false,
  updated_at timestamptz not null default now()
);
create table email_queue (
  id uuid primary key default gen_random_uuid(),
  email_log_id uuid not null unique references email_log(id) on delete cascade,
  priority int not null check (priority between 1 and 3),
  not_before timestamptz not null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_queue_due_idx on email_queue (not_before, priority) where sent_at is null;
create table outbox (
  id uuid primary key default gen_random_uuid(),
  kind outbox_kind not null,
  request_id uuid null references request(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index outbox_due_idx on outbox (next_attempt_at) where done_at is null;
create table system_status (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
create table oauth_connection (
  provider text primary key check (provider = 'google'),
  account_email citext not null,
  refresh_token_enc bytea not null,
  scopes text[] not null,
  calendar_id text,
  last_ok_at timestamptz,
  last_error text,
  connected_at timestamptz not null default now()
);
create table freebusy_cache (
  id boolean primary key default true check (id),   -- keeps only the newest row
  fetched_at timestamptz not null,
  busy jsonb not null
);
