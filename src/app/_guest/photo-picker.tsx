'use client';
// src/app/_guest/photo-picker.tsx — T1.8.U2: the 1–2 photo picker shared by S11, S17 and S19. Previews, a tile
// per photo (uploading → Added, or "didn't go through" with Try again), no progress bar. Markup and class names
// follow the v1.12 pack (s11: .photo-pick / .photo / .photo--added; wireframe 07 B/C for the tile states).
import { useCallback, useEffect, useId, useReducer, useRef } from 'react';
import { AFTER_SEND } from '@/content';
import { PHOTO_PICKER } from '@/content/ui/guest-after';
import { TextButton } from '@/ui';
import { announce, moveFocus } from '@/ui/focus';
import {
  EMPTY_PHOTOS,
  canPreview,
  photoReducer,
  roomLeft,
  type PhotoAction,
  type PhotoState,
} from './photo-state';
import type { Uploader } from './uploader';

export interface Photos {
  state: PhotoState;
  max: number;
  add: (files: FileList | File[]) => void;
  retry: (key: string) => void;
  remove: (key: string) => void;
}

/** An object URL for the thumbnail (null when the browser can't show the file), tracked so it is revoked later. */
function makePreview(file: File, open: Set<string>): string | null {
  const preview = canPreview(file.type) ? URL.createObjectURL(file) : null;
  if (preview) open.add(preview);
  return preview;
}

/** The picker's state and actions. The form owns it, so Send can wait for an upload (story-submit.ts). */
export function usePhotos(max: number, uploader: Uploader): Photos {
  const [state, dispatch] = useReducer(
    (s: PhotoState, a: PhotoAction) => photoReducer(s, a, max),
    EMPTY_PHOTOS,
  );
  const aborts = useRef(new Map<string, AbortController>());
  const previews = useRef(new Set<string>());
  const seq = useRef(0);
  const room = roomLeft(state, max);

  const start = useCallback(
    (key: string, file: File, preview: string | null) => {
      const ac = new AbortController();
      aborts.current.set(key, ac);
      uploader(file, ac.signal).then(
        () => dispatch({ type: 'done', key }),
        () => {
          if (ac.signal.aborted) return;
          // pr90 F7: a failed tile shows no preview, so its object URL goes now, not at unmount (retry makes a new one).
          if (preview) {
            URL.revokeObjectURL(preview);
            previews.current.delete(preview);
          }
          dispatch({ type: 'failed', key });
          // pr94 F2: the tile's line is not a live region, so the failure is spoken once, here.
          announce(PHOTO_PICKER.failed);
        },
      );
    },
    [uploader],
  );

  const add = useCallback(
    (files: FileList | File[]) => {
      const picked = Array.from(files).slice(0, room);
      const items = picked.map((file) => ({
        key: `p${++seq.current}`,
        file,
        preview: makePreview(file, previews.current),
      }));
      dispatch({ type: 'add', items });
      for (const it of items) start(it.key, it.file, it.preview);
    },
    [room, start],
  );

  const retry = useCallback(
    (key: string) => {
      const item = state.items.find((p) => p.key === key && p.status === 'failed');
      if (!item) return;
      const preview = makePreview(item.file, previews.current);
      dispatch({ type: 'retry', key, preview });
      start(key, item.file, preview);
    },
    [state.items, start],
  );

  const remove = useCallback(
    (key: string) => {
      aborts.current.get(key)?.abort();
      aborts.current.delete(key);
      const item = state.items.find((p) => p.key === key);
      if (item?.preview) {
        URL.revokeObjectURL(item.preview);
        previews.current.delete(item.preview);
      }
      dispatch({ type: 'remove', key });
    },
    [state.items],
  );

  useEffect(() => {
    const open = previews.current;
    const running = aborts.current;
    return () => {
      for (const url of open) URL.revokeObjectURL(url);
      for (const ac of running.values()) ac.abort();
    };
  }, []);

  return { state, max, add, retry, remove };
}

export function PhotoPicker({ photos }: { photos: Photos }) {
  const inputId = useId();
  const addRef = useRef<HTMLInputElement>(null);
  const { state, max } = photos;
  const room = roomLeft(state, max);
  const prevDone = useRef(0);

  // One polite line per photo that lands (pack site.js: "Photo added."), through the page's one live region.
  const done = state.items.filter((p) => p.status === 'done').length;
  useEffect(() => {
    if (done > prevDone.current) announce(PHOTO_PICKER.addedSay);
    prevDone.current = done;
  }, [done]);

  const removeAndRefocus = (key: string) => {
    photos.remove(key);
    // The tile goes away with the focused button in it: focus moves to the add control that takes its place.
    requestAnimationFrame(() => moveFocus(addRef.current));
  };

  return (
    <fieldset className="field" style={{ maxWidth: 'none' }}>
      <legend>
        {AFTER_SEND.photoTitle} <span className="hint">{AFTER_SEND.photoHint}</span>
      </legend>
      {room === 0 && <p className="hint">{PHOTO_PICKER.full(state.items.length, max)}</p>}
      <div className="photo-pick">
        {state.items.map((p, i) => (
          <PhotoTile key={p.key} n={i + 1} item={p} onRetry={photos.retry} onRemove={removeAndRefocus} />
        ))}
        {room > 0 && (
          <div className="photo">
            <label htmlFor={inputId}>{AFTER_SEND.photoButton}</label>
            <input
              ref={addRef}
              id={inputId}
              type="file"
              accept="image/*"
              multiple={room > 1}
              onChange={(e) => {
                if (e.currentTarget.files?.length) photos.add(e.currentTarget.files);
                e.currentTarget.value = '';
              }}
            />
          </div>
        )}
        {state.items.length === 0 && (
          <div className="photo" aria-hidden="true" style={{ borderStyle: 'dashed' }} />
        )}
      </div>
    </fieldset>
  );
}

/** The tile's words and button sit above its preview image. */
const ON_TOP = { position: 'relative' } as const;
const COVER = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' } as const;

function PhotoTile({
  n,
  item,
  onRetry,
  onRemove,
}: {
  n: number;
  item: PhotoState['items'][number];
  onRetry: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  const failed = item.status === 'failed';
  return (
    <div
      className={failed ? 'photo' : 'photo photo--added'}
      role="group"
      aria-label={PHOTO_PICKER.photoName(n)}
    >
      {item.preview && item.status === 'done' && (
        // A local object URL of the guest's own file: next/image can't optimise it.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.preview} alt="" style={COVER} />
      )}
      <p style={ON_TOP}>
        {item.status === 'uploading'
          ? PHOTO_PICKER.uploading
          : failed
            ? PHOTO_PICKER.failed
            : PHOTO_PICKER.added}
      </p>
      {failed ? (
        <>
          <TextButton style={ON_TOP} onClick={() => onRetry(item.key)}>
            {PHOTO_PICKER.tryAgain}
          </TextButton>
          {/* pr94 F1: a failed tile keeps its slot, so the guest can always take it out. */}
          <TextButton style={ON_TOP} onClick={() => onRemove(item.key)}>
            {PHOTO_PICKER.remove}
          </TextButton>
        </>
      ) : (
        <TextButton style={ON_TOP} onClick={() => onRemove(item.key)}>
          {item.status === 'uploading' ? PHOTO_PICKER.stop : PHOTO_PICKER.remove}
        </TextButton>
      )}
    </div>
  );
}
