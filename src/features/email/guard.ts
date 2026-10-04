// src/features/email/guard.ts — T3.2.04: the AD-5 daily-cap guard decision. Pure.
import type { TemplateId } from '@/content/emails';
import type { MailerMode } from '@/lib/adapters/mailer';

/** 0 = admin sign-in (counted in T2.1.07, sent by Supabase, never queued). 1..3 = app email. */
export type Priority = 0 | 1 | 2 | 3;
export type AppPriority = Exclude<Priority, 0>;
export type GuardDecision = 'send' | 'digest' | 'queue';

export const PRIORITY: Record<TemplateId, AppPriority> = {
  E4: 1,
  E4c: 1, // the guest's calendar entry (AD-6 .ics fallback): as urgent as the E4 it goes with
  E5: 1,
  E5b: 1,
  E5j: 1, // not in the TSD's rule 2 list yet: a guest's booked time is off (like E5), so P1
  E7: 1,
  E10: 1,
  E11: 1,
  E17: 1, // Jon cancelled the guest's booking (QA r2 M5): as urgent as E11
  E14: 1,
  E1: 2,
  E6: 2,
  E8: 2,
  E9: 2,
  E2: 3,
  E3: 3,
  E12: 3,
  E13: 3,
  E16: 3,
};

/** P3 collapses into the hourly digest from `digestFrom`; P2/P3 wait from `budget`; P1 waits from `p1Ceiling`. */
export interface GuardLimits {
  digestFrom: number;
  budget: number;
  p1Ceiling: number;
}

/**
 * The thresholds per mailer (pr36 F5, orchestrator RULING 2026-09-25). Resend Free sends 100 a day (TSD v1.10:
 * 60 / 85 / 95). Jon's Gmail (the AD-5 rule 7 fallback, and staging) sends ~500 a day: capped at 400, digest
 * from 280, P2/P3 stop at 360, P1 up to 400. The counter is the same UTC-day row; only the ceilings change.
 */
export const GUARD_LIMITS: Readonly<Record<MailerMode, GuardLimits>> = {
  resend: { digestFrom: 60, budget: 85, p1Ceiling: 95 },
  gmail_api: { digestFrom: 280, budget: 360, p1Ceiling: 400 },
};

/**
 * `count` = today's sends BEFORE this one. `digestable` is false for the hourly digest itself (it can't
 * collapse into itself). The P0 cap lives in takeSlot('signin'), not here.
 */
export function decide(
  count: number,
  p: Priority,
  digestable = true,
  limits: GuardLimits = GUARD_LIMITS.resend,
): GuardDecision {
  if (p === 0) return 'send';
  if (p === 1) return count >= limits.p1Ceiling ? 'queue' : 'send';
  if (count >= limits.budget) return 'queue';
  if (p === 3 && digestable && count >= limits.digestFrom) return 'digest';
  return 'send';
}

/**
 * pr31 review M1: the count under which this class may take a slot. decide() is 'send' exactly when
 * count < ceilingFor(), so takeAppSlot() can enforce the guard inside its atomic upsert.
 */
export function ceilingFor(
  p: AppPriority,
  digestable = true,
  limits: GuardLimits = GUARD_LIMITS.resend,
): number {
  if (p === 1) return limits.p1Ceiling;
  return p === 3 && digestable ? limits.digestFrom : limits.budget;
}

/** The next-UTC-day queue opens at 00:05 UTC (AD-5 rule 4). */
export function nextQueueOpen(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5));
}

/** A digested email waits for the top of the next UTC hour. */
export function nextHour(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1));
}

/** E13's hourly event_key (T3.2.06): 'hour:' + the ISO hour, e.g. 'hour:2027-03-01T14'. */
export function digestEventKey(now: Date): string {
  return `hour:${now.toISOString().slice(0, 13)}`;
}
export function isHourlyDigest(template: TemplateId, eventKey: string | null): boolean {
  return template === 'E13' && !!eventKey?.startsWith('hour:');
}
