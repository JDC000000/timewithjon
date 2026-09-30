// src/app/admin/_requests/pending-lock.test.ts — PR-G2: the pending lock commits once, whoever fires first
// (the window ending, pagehide, the tab going hidden, the pane unmounting); Undo cancels only while pending.
import { describe, expect, it, vi } from 'vitest';
import { commitOnLeave, createPendingCommit } from './pending-lock';

const fresh = () => {
  const send = vi.fn(async (p: string) => `sent:${p}`);
  return { send, ctl: createPendingCommit(send) };
};

/** A tiny event target standing in for window / document. */
function target() {
  const t = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
  t.visibilityState = 'visible';
  return t;
}

describe('createPendingCommit', () => {
  it('commits the pending payload once: a second commit (double fire) is null, one send', async () => {
    const { send, ctl } = fresh();
    expect(ctl.start('a')).toBe(true);
    expect(ctl.pending()).toBe(true);
    await expect(ctl.commit()).resolves.toBe('sent:a');
    expect(ctl.commit()).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    expect(ctl.pending()).toBe(false);
  });

  it('a second start while pending does nothing', () => {
    const { ctl } = fresh();
    expect(ctl.start('a')).toBe(true);
    expect(ctl.start('b')).toBe(false);
  });

  it('undo cancels while pending (no send); too late once committed', async () => {
    const { send, ctl } = fresh();
    ctl.start('a');
    expect(ctl.undo()).toBe(true);
    expect(ctl.commit()).toBeNull();
    expect(send).not.toHaveBeenCalled();
    ctl.start('b');
    await ctl.commit();
    expect(ctl.undo()).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('nothing pending: commit is null and undo is false', () => {
    const { send, ctl } = fresh();
    expect(ctl.commit()).toBeNull();
    expect(ctl.undo()).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('commitOnLeave', () => {
  it('pagehide commits', () => {
    const [win, doc, commit] = [target(), target(), vi.fn()];
    commitOnLeave(commit, win, doc);
    win.dispatchEvent(new Event('pagehide'));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('the tab going hidden commits; becoming visible does not', () => {
    const [win, doc, commit] = [target(), target(), vi.fn()];
    commitOnLeave(commit, win, doc);
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(commit).not.toHaveBeenCalled();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('unmount (the cleanup) stops listening; with a pending commit, all of them together send once', async () => {
    const { send, ctl } = fresh();
    const [win, doc] = [target(), target()];
    ctl.start('a');
    const off = commitOnLeave(() => void ctl.commit(), win, doc);
    win.dispatchEvent(new Event('pagehide'));
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    off();
    ctl.commit(); // the unmount's own commit
    win.dispatchEvent(new Event('pagehide'));
    expect(send).toHaveBeenCalledTimes(1);
  });
});
