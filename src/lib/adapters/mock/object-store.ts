// src/lib/adapters/mock/object-store.ts — in-memory stand-ins for the T3.6 storage ports.
// createMemoryStore() behaves like the bucket (tests drive the whole pipeline with it); the prototype store is
// the same with signing switched off, because the prototype stores no photos (§5.5).
import type { ObjectStore, PhotoBackup } from '../photos';

export interface MemoryStore extends ObjectStore {
  objects: Map<string, { bytes: Buffer; contentType: string; createdAt: Date }>;
  /** Simulates the guest's direct upload to a signed URL. */
  put(path: string, bytes: Buffer, contentType?: string, createdAt?: Date): void;
}

export function createMemoryStore(opts: { signs?: boolean } = {}): MemoryStore {
  const objects: MemoryStore['objects'] = new Map();
  const put: MemoryStore['put'] = (
    path,
    bytes,
    contentType = 'application/octet-stream',
    createdAt = new Date(),
  ) => void objects.set(path, { bytes, contentType, createdAt });
  return {
    objects,
    put,
    async createSignedUploadUrl(path) {
      return opts.signs === false ? null : { signedUrl: `memory://upload/${path}?token=t`, token: 't' };
    },
    async download(path) {
      return objects.get(path)?.bytes ?? null;
    },
    async upload(path, bytes, contentType) {
      put(path, bytes, contentType);
    },
    async remove(paths) {
      for (const p of paths) objects.delete(p);
    },
    async listCreatedBefore(prefix, cutoff) {
      return [...objects]
        .filter(
          ([p, o]) =>
            p.startsWith(`${prefix}/`) && !p.slice(prefix.length + 1).includes('/') && o.createdAt < cutoff,
        )
        .map(([p]) => p);
    },
    async createSignedUrls(paths, ttlSeconds) {
      return Object.fromEntries(paths.map((p) => [p, `memory://read/${p}?ttl=${ttlSeconds}`]));
    },
  };
}

export const prototypePhotoStore: ObjectStore = createMemoryStore({ signs: false });

export interface MemoryBackup extends PhotoBackup {
  objects: Map<string, Buffer>;
  /** When each key was written (tests backdate it to model an old object). */
  writtenAt: Map<string, Date>;
}
export function createMemoryBackup(): MemoryBackup {
  const objects = new Map<string, Buffer>();
  const writtenAt = new Map<string, Date>();
  return {
    objects,
    writtenAt,
    async put(key, bytes) {
      objects.set(key, bytes);
      writtenAt.set(key, new Date());
    },
    async remove(keys) {
      for (const k of keys) {
        objects.delete(k);
        writtenAt.delete(k);
      }
    },
    async listCreatedBefore(prefix, cutoff) {
      return [...objects.keys()].filter(
        (k) => k.startsWith(`${prefix}/`) && (writtenAt.get(k) ?? new Date(0)) < cutoff,
      );
    },
  };
}
export const mockPhotoBackup: PhotoBackup = createMemoryBackup();
