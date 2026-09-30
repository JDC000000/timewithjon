-- ops/end-admin-sessions.sql — T2.1.06 (review F11). OPERATOR ONLY: the app never runs this.
-- Ends every session of the given admin addresses. Their refresh tokens go with them (auth.refresh_tokens
-- cascades on session_id), so a token taken before this stops working.
-- When: by hand on proto and staging at G2, G3 and G4, and at the T3.16 purge (TSD §12).
-- Usage (direct connection, verify-full TLS):
--   psql "<direct_url>?sslmode=verify-full&sslrootcert=<ca>" -v admin_emails='jon@example.com,test@example.com' \
--        -f ops/end-admin-sessions.sql
\set ON_ERROR_STOP on
\if :{?admin_emails}
\else
  do $$ begin raise exception 'usage: psql <url> -v admin_emails=a@example.com,b@example.com -f ops/end-admin-sessions.sql'; end $$;
\endif

-- Review L3 + pr26-review R3: a mistyped address must not look like success, so EVERY listed address has to match
-- a user (a partial typo in 'a@x,typo@x' is an error too, a non-zero exit). Blank and repeated entries are ignored.
with wanted as (
  select distinct e from unnest(string_to_array(lower(regexp_replace(:'admin_emails', '\s', '', 'g')), ',')) e
  where e <> ''
)
select count(*) > 0 and count(*) = (select count(*) from wanted where e in (select lower(email) from auth.users))
  as matched from wanted \gset
\if :matched
begin;
with admins as (
  select id from auth.users
  where lower(email) = any (string_to_array(lower(regexp_replace(:'admin_emails', '\s', '', 'g')), ','))
), ended as (
  delete from auth.sessions where user_id in (select id from admins) returning 1
)
select (select count(*) from admins) as admin_users, (select count(*) from ended) as sessions_ended;
commit;
\else
  do $$ begin raise exception 'not every admin_emails address matched a user: nothing was ended'; end $$;
\endif
