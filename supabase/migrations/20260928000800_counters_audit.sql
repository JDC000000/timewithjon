-- T0.2.09 rate_limit, event_count, audit_log (+ detail whitelist)
create table rate_limit (
  scope text not null,
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (scope, key, window_start)
);
create table event_count (
  day date not null,
  name text not null,
  count int not null default 0,
  primary key (day, name)
);
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor audit_actor not null,
  action text not null,
  request_id uuid null references request(id) on delete set null,
  detail jsonb not null default '{}'::jsonb check (
    jsonb_typeof(detail) = 'object'
    and (detail - array['from_status','to_status','slot_id','offer_id','override','template']) = '{}'::jsonb),
  at timestamptz not null default now()
);
create index audit_log_request_idx on audit_log (request_id, at);
