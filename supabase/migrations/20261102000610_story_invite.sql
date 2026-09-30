-- pr43-review F1 (T3.12.01, T3.16, T3.10): a story_page story keeps the invite it was saved through, so an
-- is_test invite's stories can be purged (ops/purge-test-data.sql) and left out of the export. Nullable: After
-- Send stories reach their invite through request_id, and Jon's emailed stories have no invite. Additive only.
alter table story add column if not exists invite_id uuid null references invite(id) on delete set null;
