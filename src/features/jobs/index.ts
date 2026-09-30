// src/lib/jobs/index.ts — import every job module here so registration happens once.
import './jobs/materialise-done';
import './jobs/email-retry';
import './jobs/outbox-retry';
import './jobs/email-queue';
import './jobs/bounce-poll';
import './jobs/offer-expiry';
import './jobs/e3-nudge';
import './jobs/token-health';
import './jobs/e13-daily';
import './jobs/prune-rate-limit';
import './jobs/purge-incoming';
import './jobs/rsvp-watch';
import './jobs/purge-exports';
export { runTick, registeredJobs } from './registry';
