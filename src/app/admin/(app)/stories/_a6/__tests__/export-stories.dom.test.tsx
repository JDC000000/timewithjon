// T3.10.U1: A6 "Export" under user-event. While the export runs the button reads "Exporting…", is aria-busy and
// can't be pressed again; a JSON { url } answer (staging, production) opens the signed link; an application/zip
// answer (the prototype) is saved as a file under its attachment name; a 409 or any error shows and announces
// ERRORS.generic, and the next press clears it.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERRORS } from '@/content';
import { installFocusGuard } from '@/ui/focus';
import { ExportStories } from '../ExportStories';
import { attachmentName } from '../api';
import { openLink, saveFile } from '../download';

vi.mock('../download', () => ({ openLink: vi.fn(), saveFile: vi.fn() }));

const SIGNED = 'https://proj.supabase.co/storage/v1/object/sign/exports/zips/x.zip?token=t';
const NAME = 'time-with-jon-stories-2027-07-01.zip';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const zip = () =>
  new Response(new Uint8Array([0x50, 0x4b, 3, 4]), {
    headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${NAME}"` },
  });

/** fetch answers with `reply`, held until release() so the busy state can be seen. */
function stubFetch(reply: () => Response | Promise<Response>) {
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const fn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    await gate;
    return reply();
  });
  vi.stubGlobal('fetch', fn);
  return { fn, release };
}

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
  document.body.insertAdjacentHTML('afterbegin', '<div id="live" aria-live="polite"></div>');
  vi.mocked(openLink).mockClear();
  vi.mocked(saveFile).mockClear();
});
afterEach(() => {
  cleanup();
  uninstall();
  document.getElementById('live')?.remove();
  vi.unstubAllGlobals();
});

const setup = () => {
  const user = userEvent.setup();
  render(<ExportStories />);
  return { user, button: () => screen.getByRole('button') };
};

describe('ExportStories (A6)', () => {
  it('busy: "Exporting…", aria-busy, a second press sends nothing; then the signed link opens', async () => {
    const { fn, release } = stubFetch(() => json({ ok: true, url: SIGNED, stories: 2, photos: 1, bytes: 9 }));
    const { user, button } = setup();
    expect(button()).toHaveProperty('textContent', 'Export');
    await user.click(button());
    expect(button().textContent).toBe('Exporting…');
    expect(button().getAttribute('aria-busy')).toBe('true');
    expect(button().getAttribute('aria-disabled')).toBe('true');
    await user.click(button());
    release();
    await vi.waitFor(() => expect(openLink).toHaveBeenCalledWith(SIGNED));
    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe('/api/admin/export');
    expect(init).toMatchObject({
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(button().textContent).toBe('Export');
    expect(button().hasAttribute('aria-busy')).toBe(false);
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('the prototype answer (application/zip) is saved as a file under its attachment name', async () => {
    const { release } = stubFetch(zip);
    const { user, button } = setup();
    await user.click(button());
    release();
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    const [blob, name] = vi.mocked(saveFile).mock.calls[0]!;
    expect(name).toBe(NAME);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([0x50, 0x4b, 3, 4]));
    expect(openLink).not.toHaveBeenCalled();
  });

  it.each([
    ['409 (one already running)', () => json({ ok: false, code: 'export_running' }, 409)],
    ['500', () => json({ ok: false, code: 'export_failed' }, 500)],
    ['a network error', () => Promise.reject(new TypeError('offline'))],
    ['a link that is not https', () => json({ ok: true, url: 'memory://read/zips/x.zip' })],
  ])('%s: ERRORS.generic shown and announced; the next press clears it', async (_, reply) => {
    const first = stubFetch(reply);
    const { user, button } = setup();
    await user.click(button());
    first.release();
    await vi.waitFor(() => expect(screen.getByText(ERRORS.generic, { selector: 'p' })).toBeTruthy());
    expect(document.getElementById('live')!.textContent!.trim()).toBe(ERRORS.generic); // a repeat gets a trailing space
    expect(button().textContent).toBe('Export');
    expect(openLink).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();

    const again = stubFetch(() => json({ ok: true, url: SIGNED }));
    await user.click(button());
    expect(screen.queryByText(ERRORS.generic, { selector: 'p' })).toBeNull();
    again.release();
    await vi.waitFor(() => expect(openLink).toHaveBeenCalledWith(SIGNED));
  });

  it('reached by keyboard: Tab focuses it, Enter runs it', async () => {
    const { release } = stubFetch(() => json({ ok: true, url: SIGNED }));
    const { user, button } = setup();
    await user.tab();
    expect(document.activeElement).toBe(button());
    await user.keyboard('{Enter}');
    expect(button().textContent).toBe('Exporting…');
    expect(document.activeElement).toBe(button());
    release();
    await vi.waitFor(() => expect(openLink).toHaveBeenCalledWith(SIGNED));
  });
});

describe('attachmentName', () => {
  it('reads the quoted file name, with a fallback', () => {
    expect(attachmentName(`attachment; filename="${NAME}"`)).toBe(NAME);
    expect(attachmentName(null)).toBe('time-with-jon-stories.zip');
  });
});
