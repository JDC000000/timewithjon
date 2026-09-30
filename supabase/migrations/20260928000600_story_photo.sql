-- T0.2.07 story, photo_upload, photo, export_job (§6, C7)
create table story (
  id uuid primary key default gen_random_uuid(),
  source story_source not null,
  request_id uuid null references request(id) on delete cascade,
  guest_id uuid null references guest(id),
  from_email citext,
  from_name text,
  body text check (char_length(body) <= 5000),
  consent boolean not null default false,
  consent_source consent_source,
  consent_needs_jon boolean not null default false,
  before60_answer text check (char_length(before60_answer) <= 2000),
  created_at timestamptz not null default now()
);
create unique index story_one_after_send_uq on story (request_id) where source = 'after_send';
create table photo (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references story(id) on delete cascade,
  storage_path text not null unique check (storage_path like 'final/%'),
  width int not null, height int not null, bytes int not null,
  created_at timestamptz not null default now()
);
create table photo_upload (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references story(id) on delete cascade,
  incoming_path text not null unique check (incoming_path like 'incoming/%'),
  expires_at timestamptz not null default now() + interval '15 minutes',
  finalised_at timestamptz,
  photo_id uuid null references photo(id)
);
create table export_job (
  id uuid primary key default gen_random_uuid(),
  consented_only boolean not null default true,
  include_email boolean not null default false,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  storage_path text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
