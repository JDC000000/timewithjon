-- Review L14: 20261102000050 is already applied on proto and staging, so it is never edited. This follow-up
-- is the idempotent form of the same change: a no-op where the column exists, and it creates the column on
-- any database that reached this point without it (a hand-applied or partial replay).
alter table email_budget add column if not exists signin_count int not null default 0;
