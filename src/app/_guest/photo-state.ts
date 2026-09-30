// src/app/_guest/photo-state.ts — the photo picker's state (T1.8.U2), pure so it can be unit tested without a DOM.
// Shared by S11 (After Send), S17 ("Add a story or photo") and S19 (the story page). Each photo keeps one stable
// key from the moment it is picked, so React never rebuilds a tile under a pending click (INT-06).

export type PhotoStatus = 'uploading' | 'done' | 'failed';

export interface PhotoItem {
  key: string;
  file: File;
  /** An object URL for the thumbnail, or null when the browser can't show the file (e.g. HEIC). */
  preview: string | null;
  status: PhotoStatus;
}

export interface PhotoState {
  items: PhotoItem[];
}

export type PhotoAction =
  | { type: 'add'; items: { key: string; file: File; preview: string | null }[] }
  | { type: 'done'; key: string }
  | { type: 'failed'; key: string }
  | { type: 'retry'; key: string; preview: string | null }
  | { type: 'remove'; key: string };

export const EMPTY_PHOTOS: PhotoState = { items: [] };

/** How many more photos fit (never below 0). */
export function roomLeft(state: PhotoState, max: number): number {
  return Math.max(0, max - state.items.length);
}

function setStatus(state: PhotoState, key: string, from: PhotoStatus[], to: PhotoStatus): PhotoState {
  let changed = false;
  const items = state.items.map((p) => {
    if (p.key !== key || !from.includes(p.status)) return p;
    changed = true;
    return { ...p, status: to };
  });
  return changed ? { items } : state;
}

/**
 * `max` caps the list: extra files in one pick are dropped (the picker offers only what fits). An upload that
 * finishes after its photo was removed changes nothing.
 */
export function photoReducer(state: PhotoState, action: PhotoAction, max: number): PhotoState {
  switch (action.type) {
    case 'add': {
      const fresh = action.items
        .slice(0, roomLeft(state, max))
        .map((p) => ({ ...p, status: 'uploading' as const }));
      return fresh.length ? { items: [...state.items, ...fresh] } : state;
    }
    case 'done':
      return setStatus(state, action.key, ['uploading'], 'done');
    case 'failed': {
      // The failed tile shows no preview, and the hook revokes its object URL (pr90 F7): drop the dead URL too.
      const next = setStatus(state, action.key, ['uploading'], 'failed');
      return next === state ? state : withPreview(next, action.key, null);
    }
    case 'retry': {
      // A retry brings a fresh object URL (the old one was revoked when the upload failed).
      const next = setStatus(state, action.key, ['failed'], 'uploading');
      return next === state ? state : withPreview(next, action.key, action.preview);
    }
    case 'remove': {
      const items = state.items.filter((p) => p.key !== action.key);
      return items.length === state.items.length ? state : { items };
    }
  }
}

function withPreview(state: PhotoState, key: string, preview: string | null): PhotoState {
  return { items: state.items.map((p) => (p.key === key ? { ...p, preview } : p)) };
}

export const isUploading = (state: PhotoState): boolean => state.items.some((p) => p.status === 'uploading');
export const doneCount = (state: PhotoState): number => state.items.filter((p) => p.status === 'done').length;

/** The files a browser can preview in an <img>; anything else (HEIC on most browsers) shows the "Added" tile. */
export function canPreview(type: string): boolean {
  return /^image\/(jpeg|png|gif|webp|avif)$/.test(type);
}
