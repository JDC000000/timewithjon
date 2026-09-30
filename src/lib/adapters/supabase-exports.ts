// src/lib/adapters/supabase-exports.ts — T3.10: the private `exports` bucket (Supabase Storage, secret key).
// Uploads go through TUS (./tus.ts); Jon gets a 10-minute signed link; the tick deletes zips after 24 h (L8).
import 'server-only';
import { getEnv } from '@/config/env';
import type { ExportStore } from './exports';
import {
  listCreatedBefore,
  removeAll,
  StorageError,
  statusOfStorageError,
  storageBucket,
} from './supabase-storage';
import { tusUpload } from './tus';

export const EXPORTS_BUCKET = 'exports';

export function supabaseExportStore(): ExportStore {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getEnv();
  const bucket = storageBucket(EXPORTS_BUCKET);
  return {
    async uploadFile(path, file, bytes) {
      await tusUpload({
        endpoint: `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/upload/resumable`,
        apiKey: SUPABASE_SERVICE_ROLE_KEY,
        bucket: EXPORTS_BUCKET,
        objectName: path,
        contentType: 'application/zip',
        file,
        bytes,
      });
    },
    async signedDownloadUrl(path, ttlSeconds, downloadName) {
      const { data, error } = await bucket.createSignedUrl(path, ttlSeconds, { download: downloadName });
      if (error || !data) throw new StorageError('sign_read', statusOfStorageError(error));
      return data.signedUrl;
    },
    listCreatedBefore: (prefix, cutoff) => listCreatedBefore(bucket, prefix, cutoff),
    remove: (paths) => removeAll(bucket, paths),
  };
}
