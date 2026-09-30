-- 20261102000720_story_idempotency_key.sql: pr82-review F5 (T3.7.02). A6 "Add emailed story" is idempotent: a lost
-- 201 retried with the same client Idempotency-Key answers the story it already made instead of a duplicate.
-- The key is scoped per story source (the unique index leads with `source`) and bound to a SHA-256 of the payload
-- (pr83-review M1): the same key with another payload is refused (409), never answered with the first story.
-- Additive and re-runnable.
alter table story
  add column if not exists idempotency_key text
  constraint story_idempotency_key_format check (idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$');
alter table story
  add column if not exists idempotency_payload_hash text
  constraint story_idempotency_payload_hash_format check (idempotency_payload_hash ~ '^[0-9a-f]{64}$');
alter table story drop constraint if exists story_idempotency_pair;
alter table story
  add constraint story_idempotency_pair check ((idempotency_key is null) = (idempotency_payload_hash is null));
create unique index if not exists story_source_idempotency_key_uq
  on story (source, idempotency_key) where idempotency_key is not null;
