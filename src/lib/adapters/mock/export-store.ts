// src/lib/adapters/mock/export-store.ts — an in-memory `exports` bucket for tests and the prototype.
import { readFile } from 'node:fs/promises';
import type { ExportStore } from '../exports';

export interface MemoryExportStore extends ExportStore {
  objects: Map<string, { bytes: Buffer; createdAt: Date }>;
  put(path: string, bytes: Buffer, createdAt?: Date): void;
}

export function createMemoryExportStore(): MemoryExportStore {
  const objects: MemoryExportStore['objects'] = new Map();
  const put: MemoryExportStore['put'] = (path, bytes, createdAt = new Date()) =>
    void objects.set(path, { bytes, createdAt });
  return {
    objects,
    put,
    async uploadFile(path, file) {
      if (objects.has(path)) throw new Error('exists');
      put(path, await readFile(file));
    },
    async signedDownloadUrl(path, ttlSeconds, downloadName) {
      return `memory://read/${path}?ttl=${ttlSeconds}&download=${encodeURIComponent(downloadName)}`;
    },
    async listCreatedBefore(prefix, cutoff) {
      return [...objects]
        .filter(
          ([p, o]) =>
            p.startsWith(`${prefix}/`) && !p.slice(prefix.length + 1).includes('/') && o.createdAt < cutoff,
        )
        .map(([p]) => p);
    },
    async remove(paths) {
      for (const p of paths) objects.delete(p);
    },
  };
}

export const prototypeExportStore = createMemoryExportStore();
