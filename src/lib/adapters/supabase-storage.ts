// src/lib/adapters/supabase-storage.ts — T3.6: the private `photos` bucket through the Storage API with the
// secret (service) key. Server only: the key never reaches a browser; guests get one-time signed upload URLs.
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getEnv } from '@/config/env';
import type { ObjectStore } from './photos';

export const PHOTOS_BUCKET = 'photos';

/** The Storage API's error without its message (it can echo paths); the status is enough to act on. */
export class StorageError extends Error {
  override name = 'StorageError';
  constructor(
    readonly op: string,
    readonly status?: number,
  ) {
    super(`storage ${op} failed${status ? ` (${status})` : ''}`);
  }
}
const statusOf = (e: unknown) => statusOfStorageError(e);

/**
 * A private bucket through the Storage API with the secret key (photos, exports). `project` is for operator
 * scripts (ops/purge-storage.ts) that run outside the app's env; the app always uses its own.
 */
export function storageBucket(name: string, project?: { url: string; serviceKey: string }) {
  const { url, serviceKey } = project ?? {
    url: getEnv().SUPABASE_URL,
    serviceKey: getEnv().SUPABASE_SERVICE_ROLE_KEY,
  };
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from(name);
}
export const statusOfStorageError = (e: unknown) =>
  Number((e as { statusCode?: string; status?: number })?.statusCode ?? (e as { status?: number })?.status) ||
  undefined;

type Bucket = ReturnType<typeof storageBucket>;
const LIST_PAGE = 1000;
/** Object paths directly under `prefix` created before `cutoff`, every page (the T3.16.05 sweep sees all of final/). */
export async function listCreatedBefore(bucket: Bucket, prefix: string, cutoff: Date): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await bucket.list(prefix, {
      limit: LIST_PAGE,
      offset,
      sortBy: { column: 'created_at', order: 'asc' },
    });
    if (error) throw new StorageError('list', statusOfStorageError(error));
    for (const o of data)
      if (o.id !== null && o.created_at && new Date(o.created_at) < cutoff) paths.push(`${prefix}/${o.name}`);
    if (data.length < LIST_PAGE) return paths;
  }
}

/** Deletes every path; the Storage bulk delete takes at most 1000 per call (pr55 F6, pr55-verify N-B). */
export async function removeAll(bucket: Bucket, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += LIST_PAGE) {
    const { error } = await bucket.remove(paths.slice(i, i + LIST_PAGE));
    if (error) throw new StorageError('remove', statusOfStorageError(error));
  }
}

export function supabasePhotoStore(): ObjectStore {
  return photoStoreOn(storageBucket(PHOTOS_BUCKET));
}

/** The photos store of an explicit project (ops/purge-storage.ts runs outside the app's env). */
export function createSupabasePhotoStore(url: string, serviceKey: string): ObjectStore {
  return photoStoreOn(storageBucket(PHOTOS_BUCKET, { url, serviceKey }));
}

function photoStoreOn(bucket: Bucket): ObjectStore {
  return {
    async createSignedUploadUrl(path) {
      const { data, error } = await bucket.createSignedUploadUrl(path);
      if (error || !data) throw new StorageError('sign_upload', statusOf(error));
      return { signedUrl: data.signedUrl, token: data.token };
    },
    async download(path) {
      const { data, error } = await bucket.download(path);
      if (error) {
        const status = statusOf(error);
        if (status === 400 || status === 404) return null; // the Storage API answers 400 "not_found" too
        throw new StorageError('download', status);
      }
      return Buffer.from(await data.arrayBuffer());
    },
    async upload(path, bytes, contentType) {
      const { error } = await bucket.upload(path, bytes, { contentType, upsert: false });
      if (error) throw new StorageError('upload', statusOf(error));
    },
    async remove(paths) {
      await removeAll(bucket, paths);
    },
    listCreatedBefore: (prefix, cutoff) => listCreatedBefore(bucket, prefix, cutoff),
    async createSignedUrls(paths, ttlSeconds) {
      if (paths.length === 0) return {};
      const { data, error } = await bucket.createSignedUrls(paths, ttlSeconds);
      if (error) throw new StorageError('sign_read', statusOf(error));
      return Object.fromEntries(
        data.flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])),
      );
    },
  };
}
