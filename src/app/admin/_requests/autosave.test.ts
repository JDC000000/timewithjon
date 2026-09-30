// T2.8.U1 (T2.8 AC1): notes save as Jon types; newest text wins; a failure keeps the text for Try again.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosaver, type SaveState, TYPING_PAUSE_MS } from './autosave';

const AT = new Date('2027-03-03T03:42:00Z');

function setup(results: boolean[] = [], initial = '') {
  const saves: string[] = [];
  const states: SaveState[] = [];
  const pending: ((ok: boolean) => void)[] = [];
  const auto = createAutosaver({
    initial,
    now: () => AT,
    onState: (s) => states.push(s),
    save: (text) => {
      saves.push(text);
      const r = results.shift();
      if (r !== undefined) return Promise.resolve(r);
      return new Promise<boolean>((resolve) => pending.push(resolve));
    },
  });
  return { auto, saves, states, pending };
}

const flushPromises = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createAutosaver', () => {
  it('saves once after a pause in typing, with the last text', async () => {
    const { auto, saves, states } = setup([true]);
    auto.change('F');
    auto.change('Fi');
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS - 1);
    expect(saves).toEqual([]);
    auto.change('Finally');
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS);
    expect(saves).toEqual(['Finally']);
    expect(states).toEqual([{ kind: 'saving' }, { kind: 'saved', at: AT }]);
  });

  it('text typed during a save goes in the next save; "Saved" only after the newest lands', async () => {
    const { auto, saves, states, pending } = setup();
    auto.change('one');
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS);
    auto.change('one two');
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS * 3);
    expect(saves).toEqual(['one']); // one in flight at a time
    pending.shift()!(true);
    await flushPromises();
    expect(saves).toEqual(['one', 'one two']);
    expect(states).toEqual([{ kind: 'saving' }, { kind: 'saving' }]);
    pending.shift()!(true);
    await flushPromises();
    expect(states.at(-1)).toEqual({ kind: 'saved', at: AT });
  });

  it('a failed save says so and Try again sends the newest text', async () => {
    const { auto, saves, states } = setup([false, true]);
    auto.change('draft');
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS);
    expect(states.at(-1)).toEqual({ kind: 'failed' });
    auto.retry();
    await flushPromises();
    expect(saves).toEqual(['draft', 'draft']);
    expect(states.at(-1)).toEqual({ kind: 'saved', at: AT });
  });

  it('a save that throws counts as failed', async () => {
    const states: SaveState[] = [];
    const auto = createAutosaver({
      initial: '',
      onState: (s) => states.push(s),
      save: () => Promise.reject(new Error('x')),
    });
    auto.change('a');
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS);
    expect(states).toEqual([{ kind: 'saving' }, { kind: 'failed' }]);
  });

  it('leaving the field saves at once; nothing unsaved = no call', async () => {
    const { auto, saves } = setup([true], 'kept');
    auto.flush();
    await flushPromises();
    expect(saves).toEqual([]);
    auto.change('kept, and more');
    auto.flush();
    await flushPromises();
    expect(saves).toEqual(['kept, and more']);
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS * 2);
    expect(saves).toEqual(['kept, and more']); // the pending pause timer doesn't save it twice
  });

  it('typing back to the saved text sends nothing', async () => {
    const { auto, saves } = setup([], 'same');
    auto.change('samey');
    auto.change('same');
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS * 2);
    expect(saves).toEqual([]);
  });

  it('leaving mid-pause saves the pending edit once, and reports nothing after (pr77-review F3)', async () => {
    const { auto, saves, states, pending } = setup();
    auto.change('a');
    auto.dispose();
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS * 2);
    expect(saves).toEqual(['a']);
    pending.shift()!(true);
    await flushPromises();
    expect(states).toEqual([{ kind: 'saving' }]); // "Saving…" was said before leaving; nothing after
  });

  it('dispose with nothing pending saves nothing', async () => {
    const { auto, saves } = setup([true], 'kept');
    auto.dispose();
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS * 2);
    expect(saves).toEqual([]);
  });

  it('after dispose a save in flight reports nothing', async () => {
    const { auto, saves, states, pending } = setup();
    auto.change('b');
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS);
    auto.dispose();
    pending.shift()!(true);
    await flushPromises();
    expect(saves).toEqual(['b']);
    expect(states).toEqual([{ kind: 'saving' }]);
  });
});
