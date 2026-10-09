-- 20261102000750_client_payload_hash.sql — ENG-01, ENG-14 (adversarial engine QA, 2026-10-08): a client key replays
-- only the submit it was first sent with. request.client_payload_hash is the SHA-256 (hex) of the body a request was
-- created from; audit_log.detail.payload_hash the same for Ask for another time / proposed times. Rows from before
-- this have none and replay as before. No PII (a hash). Additive and re-runnable.
alter table request add column if not exists client_payload_hash text;
alter table request drop constraint if exists request_client_payload_hash_check;
alter table request add constraint request_client_payload_hash_check
  check (client_payload_hash is null or client_payload_hash ~ '^[0-9a-f]{64}$');

-- audit_log_detail_check re-created with the FULL union of keys on main (0304: ... story_id, fields, request_id)
-- plus payload_hash (64 lowercase hex). A later change must re-list every key, in a later migration.
alter table audit_log drop constraint if exists audit_log_detail_check;
alter table audit_log add constraint audit_log_detail_check check (
  jsonb_typeof(detail) = 'object'
  and (detail - array['from_status','to_status','slot_id','offer_id','override','template','client_key',
                      'story_id','fields','request_id','payload_hash']) = '{}'::jsonb
  and (not detail ? 'story_id'
       or (jsonb_typeof(detail -> 'story_id') = 'string'
           and (detail ->> 'story_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  and (not detail ? 'request_id'
       or (jsonb_typeof(detail -> 'request_id') = 'string'
           and (detail ->> 'request_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  and (not detail ? 'payload_hash'
       or (jsonb_typeof(detail -> 'payload_hash') = 'string' and (detail ->> 'payload_hash') ~ '^[0-9a-f]{64}$'))
  and (not detail ? 'fields'
       or (jsonb_typeof(detail -> 'fields') = 'array'
           and jsonb_array_length(detail -> 'fields') between 1 and 20
           and not jsonb_path_exists(detail -> 'fields',
                 'strict $[*] ? (@.type() != "string" || !(@ like_regex "^[a-z][a-z0-9_]{0,39}$"))', '{}', true))));
