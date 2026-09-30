-- T0.2.02 extensions + enums (§6). pg_cron/pg_net are enabled here but only scheduled in T3.9.
create extension if not exists citext;
create extension if not exists pg_cron with schema pg_catalog;   -- TWJ:SUPABASE-ONLY
create extension if not exists pg_net with schema extensions;    -- TWJ:SUPABASE-ONLY

create type settings_env      as enum ('prototype','staging','production');
create type slot_window       as enum ('lunch','evening');
create type block_kind        as enum ('blocked','away');
create type invite_kind       as enum ('personal','general');
create type request_mode      as enum ('slots','dates');
create type request_status    as enum ('requested','locked','needs_new_time','standby','cancelled','done');
create type counts_toward     as enum ('weekly_cap','big_day','none');
create type contact_problem   as enum ('bounced','complained','delayed');
create type guest_rsvp        as enum ('pending','yes','no','maybe'); -- TSD v1.9: Google's raw values are mapped only in src/lib/adapters/google/rsvp.ts
create type calendar_state    as enum ('none','pending','synced','ics_sent','failed');
create type cancelled_by      as enum ('guest','jon');
create type offer_kind        as enum ('suggested_times','standby_open','weather_call');
create type token_purpose     as enum ('manage','take_offer','pick_new_date');
create type story_source      as enum ('after_send','story_page','email_in');
create type consent_source    as enum ('tickbox','email_reply','jon');
create type suppression_reason as enum ('bounced','complained');
create type outbox_kind       as enum ('calendar_create','calendar_patch','calendar_delete','ics','attachment_finalise','r2_copy');
create type email_status      as enum ('pending','queued','sent','failed','bounced','complained','delayed'); -- pending/queued: build additions for the send path + AD-5 guard
create type audit_actor       as enum ('guest','jon','system');
