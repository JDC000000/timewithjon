// src/app/admin/(app)/stories/_a6/data.ts — T2.9.U1: what the A6 pages read (server-only): the stories list (T2.9.01)
// and, for one story, its photos as 10-minute signed URLs (T3.6.07). Explicit column lists live in the features;
// the sealed plan is never selected.
import 'server-only';
import { listStories, type StoryItem } from '@/features/admin/stories';
import { storyPhotosForAdmin, type AdminPhoto } from '@/features/photos/thumbnails';
import { photoStore } from '@/lib/adapters/photos';

export async function storiesPage(): Promise<StoryItem[]> {
  return (await listStories()).stories;
}

/** The list plus one story and its photos, or null when that story isn't there. */
export async function storyPage(
  id: string,
): Promise<{ stories: StoryItem[]; story: StoryItem; photos: AdminPhoto[] } | null> {
  const stories = await storiesPage();
  const story = stories.find((s) => s.id === id);
  if (!story) return null;
  const photos = story.photoCount > 0 ? await storyPhotosForAdmin(id, photoStore()) : [];
  return { stories, story, photos };
}
