// ops/bucket-limits.ts — the Storage bucket settings the app relies on, in one tracked place. Applied to a hosted
// project by ops/pin-bucket-limits.ts and to the local stack by supabase/config.toml ([storage.buckets.*]); a unit test
// keeps the three in step with the app's own limits.
import { MAX_UPLOAD_BYTES } from '../src/features/photos/limits';

export interface BucketLimits {
  public: false;
  fileSizeLimit: number;
  allowedMimeTypes: string[];
}

const MiB = 1024 * 1024;

export const BUCKET_LIMITS = {
  // Guest and admin photo uploads (signed upload URLs). The uploader sends the picked file's own type, or
  // application/octet-stream when the browser reports none (a .heic on some desktops); finalise then checks the
  // file's leading bytes and re-encodes it whatever its declared type.
  photos: {
    public: false,
    fileSizeLimit: MAX_UPLOAD_BYTES, // 20 MiB
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
      'image/avif',
      'application/octet-stream',
    ],
  },
  // The stories export zip (server-side resumable upload), deleted after 24 h.
  exports: {
    public: false,
    fileSizeLimit: 50 * MiB,
    allowedMimeTypes: ['application/zip'],
  },
} as const satisfies Record<string, BucketLimits>;
