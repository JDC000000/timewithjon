-- 20261102000302_audit_client_key.sql — lane L3, pr32-review M1: the guest's per-submit client_key may be
-- recorded in audit_log.detail, so Ask for another time is idempotent (a double tap or a network retry finds the
-- first audit row and changes nothing). A random UUID from the browser: no PII. Idempotent.
alter table audit_log drop constraint if exists audit_log_detail_check;
alter table audit_log add constraint audit_log_detail_check check (
  jsonb_typeof(detail) = 'object'
  and (detail - array['from_status','to_status','slot_id','offer_id','override','template','client_key']) = '{}'::jsonb);
