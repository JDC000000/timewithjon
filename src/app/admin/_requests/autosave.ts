// src/app/admin/_requests/autosave.ts — T2.8.U1: a note on A3 saves as Jon types (wireframe 09 A3k/A3k2: "Saves
// as you type.", "Saving…", "Saved 7:42 pm", "Couldn't save." + Try again). One save in flight at a time; the
// newest text always wins; nothing is lost when a save fails (Try again sends the newest text). No React here.

export type SaveState =
  { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: Date } | { kind: 'failed' };

export interface Autosaver {
  /** The text changed: save it after a pause in typing. */
  change(text: string): void;
  /** Leaving the field: save now if anything is unsaved. */
  flush(): void;
  /** "Try again" after a failure. */
  retry(): void;
  /** The page is going away: save a pending edit now, then stop (no state is reported after this). */
  dispose(): void;
}

export const TYPING_PAUSE_MS = 800;

export function createAutosaver(opts: {
  initial: string;
  save: (text: string) => Promise<boolean>;
  onState: (s: SaveState) => void;
  now?: () => Date;
  pauseMs?: number;
}): Autosaver {
  const now = opts.now ?? (() => new Date());
  const pause = opts.pauseMs ?? TYPING_PAUSE_MS;
  let latest = opts.initial;
  let saved = opts.initial;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const run = async () => {
    clear();
    if (disposed || inFlight || latest === saved) return;
    inFlight = true;
    const text = latest;
    opts.onState({ kind: 'saving' });
    let ok = false;
    try {
      ok = await opts.save(text);
    } catch {
      ok = false;
    }
    inFlight = false;
    if (disposed) return;
    if (!ok) return opts.onState({ kind: 'failed' });
    saved = text;
    // Jon typed on while it saved: the newer text goes next; the status stays "Saving…" until it lands.
    if (latest !== saved) return void run();
    opts.onState({ kind: 'saved', at: now() });
  };

  return {
    change(text) {
      latest = text;
      clear();
      timer = setTimeout(() => void run(), pause);
    },
    flush() {
      void run();
    },
    retry() {
      void run();
    },
    dispose() {
      // pr77-review F3: leaving mid-pause (Back, a link, the tab closing) still saves the last edit; the caller's
      // save survives the page (fetch keepalive), and nothing is reported once disposed.
      if (timer) void run();
      disposed = true;
      clear();
    },
  };
}
