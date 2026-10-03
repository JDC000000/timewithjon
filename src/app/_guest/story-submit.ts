// src/app/_guest/story-submit.ts — what Send does on the story form (S11, S17 "Add a story", S19), pure.
// An empty send is held with the "Add a line or a photo first" line (R7-01 / VD1-07); a photo still uploading
// makes Send wait (wireframe 07 B) and the form sends by itself once the upload settles.
import { doneCount, isUploading, type PhotoState } from './photo-state';
import type { OpenStory } from './uploader';

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

export interface StorySaverOptions {
  endpoint: string;
  headers?: Record<string, string>;
  /** false on S19 until its first save lands: that save creates the story (and issues twj_story). */
  opened: boolean;
  /** The general invite's Turnstile token (undefined: none needed); only the first save carries one. */
  takeToken: () => Promise<string | undefined>;
  /** L11: a refused first save spent its token. */
  reset: () => void;
}

/**
 * The story POST. On S19 the first save creates the story, so `open` (run before the first photo sign) saves the
 * story as it stands when a photo comes before Send; once a save lands, `open` does nothing and Send just updates.
 */
export function storySaver(o: StorySaverOptions): {
  save: (fields: Record<string, string | boolean>, signal: AbortSignal) => Promise<Response>;
  open: OpenStory;
} {
  let opened = o.opened;
  const save = async (fields: Record<string, string | boolean>, signal: AbortSignal) => {
    const token = opened ? undefined : await o.takeToken();
    const res = await fetch(o.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...o.headers },
      body: JSON.stringify(token ? { ...fields, turnstileToken: token } : fields),
      signal,
    }).catch((e: unknown) => {
      if (token) o.reset(); // the token may have gone with a call whose answer was lost
      throw e;
    });
    if (res.ok) opened = true;
    else if (token) o.reset();
    return res;
  };
  const open: OpenStory = (signal) =>
    opened ? Promise.resolve(new Response(null)) : save({ consent: false }, signal);
  return { save, open };
}
