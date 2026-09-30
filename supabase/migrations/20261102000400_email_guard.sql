-- T3.2 (TSD AD-5 guard rules 3, 4 and 6). Lane L4.
-- 'digested': a P3 email that went out inside the hourly digest to Jon instead of on its own.
alter type email_status add value if not exists 'digested';
-- The day's "Email limit reached" moment: a P1 email had to wait, or Resend refused a send for quota.
-- While it's set, every app email that day waits for the next UTC day (admin sign-in still goes out, P0).
alter table email_budget add column if not exists limit_hit_at timestamptz;
-- email_queue holds both waits: 'next_day' (sent from 00:05 UTC in priority, then age, order) and 'digest'
-- (collapsed into the next hourly digest to Jon).
alter table email_queue add column if not exists kind text not null default 'next_day'
  check (kind in ('next_day', 'digest'));
