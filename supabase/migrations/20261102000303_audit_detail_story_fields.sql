-- 20261102000303_audit_detail_story_fields.sql — lane L2b, pr37 review F1/F9, pr44 review B1/M1/L1 (number granted
-- by the orchestrator; build-lanes "SINGLE-OWNER CONSTRAINTS"). audit_log_detail_check is re-created with the FULL
-- union of keys: every key already on main (up to 0302's client_key) plus
--   story_id: the consent / Check-these audits name their story (story-page and emailed stories have no request);
--             a JSON string holding a lowercase uuid, nothing else;
--   fields:   the settings audit lists the changed column names: a flat array of 1-20 snake_case names, never
--             values. Strict jsonpath, so no lax unwrapping lets a nested array or a value ride along.
-- Idempotent. A later change must re-list every key here, in a later migration (never edit this one).
alter table audit_log drop constraint if exists audit_log_detail_check;
alter table audit_log add constraint audit_log_detail_check check (
  jsonb_typeof(detail) = 'object'
  and (detail - array['from_status','to_status','slot_id','offer_id','override','template','client_key',
                      'story_id','fields']) = '{}'::jsonb
  and (not detail ? 'story_id'
       or (jsonb_typeof(detail -> 'story_id') = 'string'
           and (detail ->> 'story_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  and (not detail ? 'fields'
       or (jsonb_typeof(detail -> 'fields') = 'array'
           and jsonb_array_length(detail -> 'fields') between 1 and 20
           and not jsonb_path_exists(detail -> 'fields',
                 'strict $[*] ? (@.type() != "string" || !(@ like_regex "^[a-z][a-z0-9_]{0,39}$"))', '{}', true))));
