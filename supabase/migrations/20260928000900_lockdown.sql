-- T0.2.10 AD-3 lockdown: RLS on with zero policies; no grants to anon/authenticated
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;
revoke all on all tables in schema public from anon, authenticated;       -- TWJ:SUPABASE-ROLES
revoke all on all sequences in schema public from anon, authenticated;    -- TWJ:SUPABASE-ROLES
revoke execute on all functions in schema public from public, anon, authenticated; -- TWJ:SUPABASE-ROLES
alter default privileges in schema public revoke all on tables from anon, authenticated;        -- TWJ:SUPABASE-ROLES
alter default privileges in schema public revoke execute on functions from public, anon, authenticated; -- TWJ:SUPABASE-ROLES
