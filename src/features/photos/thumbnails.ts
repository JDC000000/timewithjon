// src/features/photos/thumbnails.ts — T3.6.07: Jon sees photos only through 10-minute signed URLs (AD-4).
import 'server-only';
import { q } from '@/lib/db';
import type { ObjectStore } from '@/lib/adapters/photos';
import { THUMB_URL_TTL_SECONDS } from './limits';

export interface AdminPhoto {
  id: string;
  url: string | null; // null when Storage couldn't sign it (the admin shows a placeholder)
  width: number;
  height: number;
}

export async function storyPhotosForAdmin(storyId: string, store: ObjectStore): Promise<AdminPhoto[]> {
  const photos = await q<{ id: string; storage_path: string; width: number; height: number }>(
    `select id, storage_path, width, height from photo where story_id = $1 order by created_at, id`,
    [storyId],
  );
  const urls = await store.createSignedUrls(
    photos.map((p) => p.storage_path),
    THUMB_URL_TTL_SECONDS,
  );
  return photos.map((p) => ({
    id: p.id,
    url: urls[p.storage_path] ?? null,
    width: p.width,
    height: p.height,
  }));
}
