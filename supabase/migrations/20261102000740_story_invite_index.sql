-- 20261102000740_story_invite_index.sql: an index on story.invite_id (its foreign key had none), so removing an
-- invite (on delete set null) and purging stories by invite read the index instead of scanning story.
-- Additive and re-runnable.
create index if not exists story_invite_id_idx on story (invite_id);
