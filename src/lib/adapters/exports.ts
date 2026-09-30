// src/lib/adapters/exports.ts — T3.10: the private `exports` bucket port, chosen by APP_MODE.
// Prototype: an in-process memory bucket (nothing real is exported there). Staging/production: Supabase Storage,
// the zip sent with a resumable (TUS) upload so a 400 MB file never sits in memory.
import 'server-only';
import { getEnv } from '@/config/env';
import { prototypeExportStore } from './mock/export-store';
import { supabaseExportStore } from './supabase-exports';

/** Object paths are bucket-relative, all under `zips/`: `zips/<export_job.id>.zip`. */
export interface ExportStore {
  /** Upload a finished file from local disk (`bytes` = its size). Never overwrites. */
  uploadFile(path: string, file: string, bytes: number): Promise<void>;
  /** A short-lived signed download link (Jon only; 10 minutes). */
  signedDownloadUrl(path: string, ttlSeconds: number, downloadName: string): Promise<string>;
  /** Object paths directly under `prefix` created before `cutoff`. */
  listCreatedBefore(prefix: string, cutoff: Date): Promise<string[]>;
  remove(paths: string[]): Promise<void>;
}

export function exportStore(): ExportStore {
  return getEnv().APP_MODE === 'prototype' ? prototypeExportStore : supabaseExportStore();
}
