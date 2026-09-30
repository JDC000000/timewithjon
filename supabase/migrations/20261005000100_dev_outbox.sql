-- T1.10.03 dev_outbox: rendered emails for /dev/outbox. Written ONLY by the prototype mock Mailer.
create table dev_outbox (
  id uuid primary key default gen_random_uuid(),
  template text not null,
  to_email citext not null,
  subject text not null,
  text_body text not null,
  html_body text,
  created_at timestamptz not null default now()
);
alter table dev_outbox enable row level security;
revoke all on dev_outbox from anon, authenticated;
