-- 20261102000300_email_template_pattern.sql — lane L3, the build-lanes.md ruling: email_log.template is checked by
-- a PATTERN, not a fixed list, so an added template (E5j, T2.7; E4c, lane L5) needs no constraint change. The only
-- migration that touches this constraint. Idempotent: safe to re-run.
alter table email_log drop constraint if exists email_log_template_check;
alter table email_log drop constraint if exists email_log_template_pattern;
alter table email_log add constraint email_log_template_pattern check (template ~ '^E[0-9]{1,2}[a-z]?$');
