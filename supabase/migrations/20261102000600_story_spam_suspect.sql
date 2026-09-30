-- T3.8.03 (AD-9): a filled honeypot on a story form is stored, flagged, never refused (like request.spam_suspect).
alter table story add column if not exists spam_suspect boolean not null default false;
