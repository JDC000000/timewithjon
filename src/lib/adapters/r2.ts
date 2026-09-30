// src/lib/adapters/r2.ts — T3.6.05: the write-through backup copy of each finalised photo to a private R2
// bucket (AD-4: Supabase backups don't include Storage objects). Put, plus delete and list for a story's
// deletion and the operator's orphan sweep (T3.16.05). Nothing reads a photo back here.
import 'server-only';
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getEnv } from '@/config/env';
import type { PhotoBackup } from './photos';

export class R2NotConfiguredError extends Error {
  override name = 'R2NotConfiguredError';
}

/** R2's error without its message (it can echo keys). */
export class R2Error extends Error {
  override name = 'R2Error';
}

export interface R2Config {
  accountId?: string | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  bucket?: string | undefined;
}

const DELETE_BATCH = 1000; // DeleteObjects' own limit

/** The app's backup from its env; ops/purge-storage.ts passes the operator's config instead. */
export function r2PhotoBackup(): PhotoBackup {
  const env = getEnv();
  return createR2Backup({
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BACKUP_BUCKET,
  });
}

export function createR2Backup(cfg: R2Config): PhotoBackup {
  // Checked per call, not at boot: a missing R2 config fails that r2_copy job, which is retried and reported; never a guest.
  function connect(): { client: S3Client; bucket: string } {
    const { accountId, accessKeyId, secretAccessKey, bucket } = cfg;
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      throw new R2NotConfiguredError('R2 backup is not configured');
    }
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
    return { client, bucket };
  }
  return {
    async put(key, bytes, contentType) {
      const { client, bucket } = connect();
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }),
      );
    },
    async remove(keys) {
      if (keys.length === 0) return;
      const { client, bucket } = connect();
      for (let i = 0; i < keys.length; i += DELETE_BATCH) {
        const batch = keys.slice(i, i + DELETE_BATCH);
        const out = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        if (out.Errors?.length) throw new R2Error(`r2 delete failed for ${out.Errors.length} key(s)`);
      }
    },
    async listCreatedBefore(prefix, cutoff) {
      const { client, bucket } = connect();
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix}/`, ContinuationToken: token }),
        );
        for (const o of page.Contents ?? [])
          if (o.Key && o.LastModified && o.LastModified < cutoff) keys.push(o.Key);
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },
  };
}
