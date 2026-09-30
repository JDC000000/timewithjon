-- 20261102000301_action_token_email_log.sql — lane L3, T2.3.05: action tokens are minted when an email is SENT
-- (src/features/email/link-vars.ts), never stored raw. A link is deterministic per email_log row; the token
-- records that row, so a retry of the email finds its token instead of making a second one. Idempotent.
alter table action_token add column if not exists email_log_id uuid null references email_log(id) on delete set null;
create index if not exists action_token_email_log_idx on action_token (email_log_id) where email_log_id is not null;
