-- AD-3 lockdown, completed for objects later migrations create (tests/int/db-lockdown.int.test.ts checks it all):
-- 1. Sequences created in public give anon/authenticated nothing, as new tables already don't
--    (20260928000900_lockdown.sql revoked the existing sequences, not future ones).
-- 2. Functions: Postgres's built-in default lets PUBLIC (so every role) execute a new function, and a default set
--    "in schema public" can't take a built-in default away, so 20260928000900's per-schema revoke left new functions
--    executable by anon/authenticated. Revoked here for the role that runs the migrations; the server's own role owns
--    and runs them as before. Existing functions were revoked explicitly in 20260928000900 and stay so.
alter default privileges in schema public revoke all on sequences from anon, authenticated; -- TWJ:SUPABASE-ROLES
alter default privileges revoke execute on functions from public;
