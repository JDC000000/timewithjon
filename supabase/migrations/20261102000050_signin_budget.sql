-- T2.1.07 (TSD v1.10 AD-7, review F1/F2): admin sign-in emails go through the same Resend account, so they
-- take a slot in the daily counter too. signin_count carries the P0 cap (production 8, proto 2, staging 2).
alter table email_budget add column signin_count int not null default 0;
