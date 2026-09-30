-- 20261102000730_availability_block_window.sql: T2.5.06 (lane U11). Jon can block ONE window (lunch or evening) of a
-- Thursday or Friday instead of the whole day. window_kind null = the whole day(s): the meaning every existing row
-- keeps (the TSD name `window` is a reserved word, as on slot). A window block is kind 'blocked' (away is always whole
-- days), exactly one date (start = end) and a Thursday or Friday (the only dates with windows). One row per date and
-- window: a double tap gets the row already there (insertBlock); the unique index is the belt. A window block may sit
-- inside a whole-day block, as date-only rows may overlap each other; the whole day wins (C3 rule 2(b)).
-- Additive and re-runnable; existing rows are untouched (all null).
alter table availability_block add column if not exists window_kind slot_window null;
alter table availability_block drop constraint if exists availability_block_window_check;
alter table availability_block
  add constraint availability_block_window_check check (
    window_kind is null
    or (kind = 'blocked' and start_date = end_date and extract(isodow from start_date) in (4, 5))
  );
create unique index if not exists availability_block_window_uq
  on availability_block (start_date, window_kind) where window_kind is not null;
