// src/lib/engine/index.ts
export * from './types';
export { openWindows, weekStatus, isSlotOpen, unavailableDates, opensAtFor } from './openWindows';
export { canLock, REFUSAL_MESSAGE } from './canLock';
export type { CanLockInput, CanLockResult, LockRefusal, LockWarning } from './canLock';
export { resolveBusy, FREEBUSY_TTL_MS } from './freebusy';
