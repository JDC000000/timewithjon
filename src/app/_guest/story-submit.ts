// src/app/_guest/story-submit.ts — what Send does on the story form (S11, S17 "Add a story", S19), pure.
// An empty send is held with the "Add a line or a photo first" line (R7-01 / VD1-07); a photo still uploading
// makes Send wait (wireframe 07 B) and the form sends by itself once the upload settles.
import { doneCount, isUploading, type PhotoState } from './photo-state';

export type SubmitDecision = 'empty' | 'wait' | 'send';

export function decideSubmit(text: string, photos: PhotoState): SubmitDecision {
  if (isUploading(photos)) return 'wait';
  if (!text.trim() && doneCount(photos) === 0) return 'empty';
  return 'send';
}

export interface StoryFields {
  body: string;
  consent: boolean;
  before60Answer?: string;
  hp: string;
}

/** The JSON body for POST /api/stories (and /api/story-page): blank optional answers are left out, never sent as "". */
export function storyBody(f: StoryFields): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = { consent: f.consent };
  if (f.body.trim()) out.body = f.body.trim();
  if (f.before60Answer?.trim()) out.before60Answer = f.before60Answer.trim();
  if (f.hp) out.hp = f.hp;
  return out;
}
