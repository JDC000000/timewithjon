-- 20261102000304_audit_detail_request_id.sql — lane L2d, pr47 review F4 (number granted by the orchestrator;
-- build-lanes "SINGLE-OWNER CONSTRAINTS"). audit_log_detail_check is re-created with the FULL union of keys on main
-- (0303: ... client_key, story_id, fields) plus
--   request_id: the spam_request_deleted audit names the request it removed. The row's request_id column can't:
--               the delete sets it null. A JSON string holding a lowercase uuid, nothing else (as story_id).
-- Idempotent. A later change must re-list every key here, in a later migration (never edit this one).
alter table audit_log drop constraint if exists audit_log_detail_check;
alter table audit_log add constraint audit_log_detail_check check (
  jsonb_typeof(detail) = 'object'
  and (detail - array['from_status','to_status','slot_id','offer_id','override','template','client_key',
                      'story_id','fields','request_id']) = '{}'::jsonb
  and (not detail ? 'story_id'
       or (jsonb_typeof(detail -> 'story_id') = 'string'
           and (detail ->> 'story_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  and (not detail ? 'request_id'
       or (jsonb_typeof(detail -> 'request_id') = 'string'
           and (detail ->> 'request_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  and (not detail ? 'fields'
       or (jsonb_typeof(detail -> 'fields') = 'array'
           and jsonb_array_length(detail -> 'fields') between 1 and 20
           and not jsonb_path_exists(detail -> 'fields',
                 'strict $[*] ? (@.type() != "string" || !(@ like_regex "^[a-z][a-z0-9_]{0,39}$"))', '{}', true))));
