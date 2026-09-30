-- T2.2.01 (TSD T2.2 AC1, C4 "the sealed plan"): admin SQL shows "Sealed plan on file" through this column and
-- never names surprise_plan_sealed. The request schema trims the plan but allows an empty string, so a blank
-- plan counts as no plan (a stricter form of the tasks.md `is not null`).
alter table request
  add column if not exists has_sealed_plan boolean
  generated always as (coalesce(btrim(surprise_plan_sealed) <> '', false)) stored;
