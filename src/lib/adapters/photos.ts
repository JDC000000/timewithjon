// src/lib/adapters/photos.ts — T3.6: the photo storage ports, chosen by APP_MODE (AD-4).
// Prototype: nothing is stored (§5.5), so signing answers null and the guest UI keeps its mock picker.
// Staging/production: the private Supabase Storage bucket `photos`, plus the write-through R2 backup copy.
import 'server-only';
import { getEnv } from '@/config/env';
import { mockPhotoBackup, prototypePhotoStore } from './mock/object-store';
import { r2PhotoBackup } from './r2';
import { supabasePhotoStore } from './supabase-storage';

/** Paths are bucket-relative: `incoming/<photo_upload.id>` (raw) and `final/<photo.id>.jpg` (clean). */
export interface ObjectStore {
  /** A one-time signed upload URL for `path`; null when this mode stores nothing (prototype). */
  createSignedUploadUrl(path: string): Promise<{ signedUrl: string; token: string } | null>;
  /** The object's bytes, or null when there is no such object. */
  download(path: string): Promise<Buffer | null>;
  upload(path: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  /** Object paths directly under `prefix` created before `cutoff`. */
  listCreatedBefore(prefix: string, cutoff: Date): Promise<string[]>;
  /** Short-lived signed read URLs (admin only), keyed by path. */
  createSignedUrls(paths: string[], ttlSeconds: number): Promise<Record<string, string>>;
}

/** The backup target (R2). Only ever written; restores are an operator job. */
export interface PhotoBackup {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Deletes these keys; a key that isn't there is not an error. */
  remove(keys: string[]): Promise<void>;
  /** Every key under `prefix/` (all pages) last written before `cutoff`. */
  listCreatedBefore(prefix: string, cutoff: Date): Promise<string[]>;
}

/** The R2 twin of a `final/<photo.id>.jpg` object. */
export const r2KeyOf = (finalPath: string): string => `photos/${finalPath}`;

export function photoStore(): ObjectStore {
  return getEnv().APP_MODE === 'prototype' ? prototypePhotoStore : supabasePhotoStore();
}
export function photoBackup(): PhotoBackup {
  return getEnv().APP_MODE === 'prototype' ? mockPhotoBackup : r2PhotoBackup();
}
