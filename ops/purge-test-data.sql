-- ops/purge-test-data.sql — T3.16.04 (TSD T3.16, R2-L3). OPERATOR ONLY, by hand; the app never runs it.
-- Deletes every trace of is_test data: test requests (and any request on a test invite or joined to one) with their
-- slot choices, offers, action tokens, stories, photos and photo uploads; story-page stories saved through a test
-- invite (story.invite_id); guests referenced only by test requests; their audit_log, email_log (+ email_queue)
-- and outbox rows; the email_suppression rows of the resend.dev bounce/complaint tests; the test invites. Resets
-- invite open counts, event_count and rate_limit. One transaction: any error changes nothing (psql exit 3).
--
-- Before deleting, it lists every test request still linked to a "Time with Jon" calendar event (google_event_id
-- set, or a create still pending). That list must be empty: cancel those bookings in the app first (that deletes
-- the event), or delete them from the calendar by hand and rerun with -v events_ok=1.
--
-- Before committing it checks that every real (non-test) request, story, photo, guest and invite is still there,
-- else everything rolls back (pr55 F4). -v dry_run is REQUIRED and must be exactly 1 (preview, rolls back) or 0
-- (commit). Give it once: psql keeps only the LAST -v dry_run and can't tell it was repeated.
-- Production (pr55 F3) needs -v confirm=production; once invites are open (settings.personal_open_at has passed)
-- it also needs -v post_launch_ok=1, and then it leaves open counts, event_count and rate_limit alone.
--
-- Then run ops/purge-storage.ts (the photo objects + R2 twins), and ops/end-admin-sessions.sql (review F11).
-- Usage (direct connection, verify-full TLS):
--   psql "<direct_url>?sslmode=verify-full&sslrootcert=<ca>" -X -v env=staging -v dry_run=1 -f ops/purge-test-data.sql
\set ON_ERROR_STOP on
\if :{?env}
\else
  do $$ begin raise exception 'usage: psql <url> -v env=prototype|staging|production -v dry_run=1|0 -f ops/purge-test-data.sql'; end $$;
\endif
\if :{?events_ok}
\else
  \set events_ok 0
\endif
\if :{?confirm}
\else
  \set confirm none
\endif
\if :{?post_launch_ok}
\else
  \set post_launch_ok 0
\endif
\if :{?dry_run}
\else
  -- pr60-verify: required, so a forgotten flag can never commit.
  do $$ begin raise exception 'refusing: pass -v dry_run=1 (preview) or -v dry_run=0 (commit)'; end $$;
\endif
-- pr55-verify N-A: dry_run must be exactly 0 or 1. psql reads any other value (2, maybe, empty) as false, which would
-- COMMIT: refuse before anything else runs.
select :'dry_run' in ('0', '1') as dry_run_valid, :'dry_run' = '1' as dry_run_on \gset
\if :dry_run_valid
\else
  do $$ begin raise exception 'refusing: -v dry_run must be exactly 0 or 1'; end $$;
\endif

begin;
select set_config('twj.purge_env', :'env', true), set_config('twj.events_ok', :'events_ok', true),
       set_config('twj.confirm', :'confirm', true), set_config('twj.post_launch_ok', :'post_launch_ok', true);
do $$ begin
  -- The -v env must name THIS database, so a staging purge can't be pointed at production by mistake.
  if (select count(*) from settings) <> 1
     or (select env::text from settings) is distinct from current_setting('twj.purge_env') then
    raise exception 'refusing: settings.env is not %', current_setting('twj.purge_env');
  end if;
  if current_setting('twj.purge_env') = 'production' then
    if current_setting('twj.confirm') <> 'production' then
      raise exception 'refusing: a production purge needs -v confirm=production';
    end if;
    if now() > (select personal_open_at from settings) and current_setting('twj.post_launch_ok') <> '1' then
      raise exception 'refusing: invites are open; a post-launch purge needs -v post_launch_ok=1 (it then keeps open counts, event_count and rate_limit)';
    end if;
  end if;
end $$;
-- The global resets are for a pre-launch baseline only: never on production once invites are open.
select set_config('twj.resets',
         case when current_setting('twj.purge_env') = 'production' and now() > (select personal_open_at from settings)
              then 'off' else 'on' end, true) as global_resets;

create temp table purge_request on commit drop as
  with recursive r(id) as (
    select request.id from request where is_test or invite_id in (select id from invite where is_test)
    union
    select q.id from request q join r on q.joined_to_request_id = r.id
  )
  select request.id, request.guest_id, request.google_event_id, request.calendar_state,
         exists (select 1 from outbox o
                  where o.request_id = request.id and o.done_at is null
                    and o.kind in ('calendar_create', 'calendar_patch', 'calendar_delete')) as calendar_outbox
    from request join r using (id);
create temp table purge_story on commit drop as
  select id from story
   where request_id in (select id from purge_request)
      or invite_id in (select id from invite where is_test);
create temp table purge_upload on commit drop as
  select id from photo_upload where story_id in (select id from purge_story);
create temp table purge_photo on commit drop as
  select id from photo where story_id in (select id from purge_story);

-- pr55 F4: what must survive, counted now and again before the commit.
create temp view purge_real as
  select (select count(*) from request where id not in (select id from purge_request)) as requests,
         (select count(*) from story where id not in (select id from purge_story)) as stories,
         (select count(*) from photo where id not in (select id from purge_photo)) as photos,
         (select count(*) from guest where id not in (select guest_id from purge_request)) as guests,
         (select count(*) from invite where not is_test) as invites;
create temp table purge_real_before on commit drop as select requests, stories, photos, guests, invites from purge_real;

\echo 'Test requests still linked to a calendar event, or with a calendar change still queued (must be none):'
select id as request_id, google_event_id, calendar_state, calendar_outbox
  from purge_request
 where google_event_id is not null or calendar_state = 'pending' or calendar_outbox
 order by id;
do $$ begin
  if current_setting('twj.events_ok') <> '1' and exists (
       select 1 from purge_request where google_event_id is not null or calendar_state = 'pending' or calendar_outbox) then
    raise exception 'refusing: test requests still have calendar events (listed above); nothing was deleted';
  end if;
end $$;

-- Rows that would only lose their request_id (on delete set null) go first.
delete from audit_log
 where request_id in (select id from purge_request)
    or detail->>'story_id' in (select id::text from purge_story);
delete from email_log -- email_queue cascades
 where request_id in (select id from purge_request)
    or to_email in ('bounced@resend.dev', 'complained@resend.dev', 'delivered@resend.dev');
delete from outbox
 where request_id in (select id from purge_request)
    or payload->>'photoId' in (select id::text from purge_photo)
    or payload->>'photoUploadId' in (select id::text from purge_upload);
delete from email_suppression where email in ('bounced@resend.dev', 'complained@resend.dev');
-- Stories cascade to photos and photo uploads; requests to slot choices, offers, action tokens, After-Send stories.
delete from story where id in (select id from purge_story);
delete from request where id in (select id from purge_request);
delete from guest g
 where g.id in (select guest_id from purge_request)
   and not exists (select request.id from request where request.guest_id = g.id)
   and not exists (select 1 from story where guest_id = g.id);
delete from invite where is_test;
do $$ begin
  if current_setting('twj.resets') = 'on' then
    update invite set open_count = 0, first_opened_at = null where open_count <> 0 or first_opened_at is not null;
    delete from event_count;
    delete from rate_limit;
  end if;
end $$;

\echo 'Real rows before and after (must match, else everything rolls back):'
select 'before' as at, requests, stories, photos, guests, invites from purge_real_before
union all select 'after', requests, stories, photos, guests, invites from purge_real;
do $$ begin
  if exists (select requests, stories, photos, guests, invites from purge_real_before
             except select requests, stories, photos, guests, invites from purge_real) then
    raise exception 'refusing: real rows changed (listed above); everything was rolled back';
  end if;
end $$;

\echo 'After the purge (every count must be 0):'
select (select count(*) from invite where is_test) as test_invites,
       (select count(*) from request where is_test) as test_requests,
       (select count(*) from story s join invite i on i.id = s.invite_id where i.is_test) as test_stories,
       (select count(*) from event_count where current_setting('twj.resets') = 'on') as event_count_rows,
       (select count(*) from email_suppression
         where email in ('bounced@resend.dev', 'complained@resend.dev')) as test_suppressions;
\if :dry_run_on
  rollback;
  \echo 'DRY RUN: nothing was changed.'
\else
  commit;
\endif
