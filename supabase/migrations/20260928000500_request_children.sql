-- T0.2.06 request_slot_choice, offer, action_token (§6)
create table request_slot_choice (
  request_id uuid not null references request(id) on delete cascade,
  slot_id uuid not null references slot(id),
  primary key (request_id, slot_id)
);
create table offer (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references request(id) on delete cascade,
  kind offer_kind not null,
  slot_ids uuid[] not null default '{}',
  ranges jsonb not null default '[]'::jsonb,
  expires_at timestamptz null,
  taken_slot_id uuid null references slot(id),
  taken_range jsonb,
  taken_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now()
);
create index offer_live_idx on offer (kind) where taken_at is null and released_at is null;
create table action_token (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  purpose token_purpose not null,
  request_id uuid not null references request(id) on delete cascade,
  offer_id uuid null references offer(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
