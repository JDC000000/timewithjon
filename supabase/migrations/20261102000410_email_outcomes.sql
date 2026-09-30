-- T3.13 (TSD H3, AD-5): bounces and complaints, by webhook or by polling. Lane L4.
-- 'suppressed': an email that never went out because its address bounced or complained first.
alter type email_status add value if not exists 'suppressed';
-- delivery_final_at: Resend's final word is known (delivered, bounced or complained): polling stops.
-- delivery_checked_at: the last poll, so ≤ 30 calls a tick still reach every open row in turn.
alter table email_log add column if not exists delivery_final_at timestamptz;
alter table email_log add column if not exists delivery_checked_at timestamptz;
create index if not exists email_log_delivery_poll_idx on email_log (delivery_checked_at nulls first, created_at)
  where status = 'sent' and delivery_final_at is null and resend_id is not null;
-- Every webhook/poll outcome finds its row by the provider id (pr34 L6).
create index if not exists email_log_resend_id_idx on email_log (resend_id) where resend_id is not null;
-- Webhook dedupe on svix-id, written in the same transaction as the outcome.
create table if not exists webhook_event (
  id text primary key check (char_length(id) <= 200),
  received_at timestamptz not null default now()
);
alter table webhook_event enable row level security;
revoke all on webhook_event from anon, authenticated;
