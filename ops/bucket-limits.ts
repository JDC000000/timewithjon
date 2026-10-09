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
  // The stories export zip, one file sent by resumable upload and deleted after 24 h. The season's book is about
  // 150-250 photos at 3000 px (~1.5-2.5 MiB each after re-encode) plus the CSV: roughly 250-600 MiB at the top
  // end, ~300-400 MiB expected. The zip is built in the function's /tmp (512 MB on Vercel), so a zip much larger than
  // 450 MiB (472 MB) couldn't be built anyway; 450 MiB also sits under a 500 MB project-wide limit however the
  // dashboard counts a MB. Needs a paid plan: free projects cap every upload at 50 MB (see limitsFor).
  exports: {
    public: false,
    fileSizeLimit: 450 * MiB,
    allowedMimeTypes: ['application/zip'],
  },
} as const satisfies Record<string, BucketLimits>;

/** The most a free-plan project takes in one upload (its project-wide limit can't be raised past this). */
export const FREE_PLAN_MAX_UPLOAD_BYTES = 50 * MiB;

/**
 * The limits for a project's plan. Production is on a paid plan and takes BUCKET_LIMITS as they are; the free-plan
 * projects (proto, staging) get every size capped at 50 MB, so an export there holds only a test-sized season.
 */
export function limitsFor(plan: 'paid' | 'free'): Record<keyof typeof BUCKET_LIMITS, BucketLimits> {
  const out = {} as Record<keyof typeof BUCKET_LIMITS, BucketLimits>;
  for (const [name, l] of Object.entries(BUCKET_LIMITS) as [keyof typeof BUCKET_LIMITS, BucketLimits][]) {
    out[name] = {
      ...l,
      allowedMimeTypes: [...l.allowedMimeTypes],
      fileSizeLimit:
        plan === 'free' ? Math.min(l.fileSizeLimit, FREE_PLAN_MAX_UPLOAD_BYTES) : l.fileSizeLimit,
    };
  }
  return out;
}
