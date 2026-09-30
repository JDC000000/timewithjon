// T1.7.U2 the details step on a personal invite (T1.7 AC8): one "Sending as" line and no fields until Change;
// Change shows the fields holding the invite's values, and the edited values are what the POST sends. A general link
// is unchanged. fetch is stubbed; the real POST is tests/e2e/booking/prefill.spec.ts.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { FLOW } from '@/content';
import { DetailsFields, useSend } from '../SendDetails';
import type { GuestView } from '../_lib/flow-view';
import type { FormError } from '../_lib/form-errors';
import { SEND_AS } from '../_lib/prefill';

const DAVE: GuestView = { name: 'Dave', email: 'dave@example.com', general: false };
const GENERAL: GuestView = { name: '', email: '', general: true };

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
});
afterEach(() => {
  uninstall();
  vi.unstubAllGlobals();
  cleanup();
  document.body.innerHTML = '';
});

const box = (name: string) =>
  screen.queryByRole('textbox', { name: new RegExp(`^${name}`) }) as HTMLInputElement | null;
const change = () => screen.queryByRole('button', { name: SEND_AS.change });

function Harness({ guest, errors = [] }: { guest: GuestView; errors?: FormError[] }) {
  const s = useSend('pitch-me', guest, () => {});
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void s.submit({ pitchIdea: 'Sailing' });
      }}
    >
      <DetailsFields s={s} errors={errors} onFixed={() => {}} />
      <button type="submit">{FLOW.send}</button>
    </form>
  );
}

describe('personal-link pre-fill (T1.7.U2)', () => {
  it('AC1 + AC4: one summary line with the masked email; no fields until Change', () => {
    render(<Harness guest={DAVE} />);
    const line = document.querySelector('.sendas')!;
    expect(line.textContent).toBe(`${SEND_AS.lead} Dave · dave@…${SEND_AS.change}`);
    expect(line.querySelector('strong')!.textContent).toBe('Dave');
    expect(line.textContent).not.toContain('example.com');
    expect(change()!.getAttribute('aria-expanded')).toBe('false');
    expect(box(FLOW.nameLabel)).toBeNull();
    expect(box(FLOW.emailLabel)).toBeNull();
  });

  it('AC2: Change shows the fields holding the invite values, focus on the name; edits are what the POST sends', async () => {
    const f = vi.fn<(u: string, i?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ ok: true })),
    );
    vi.stubGlobal('fetch', f);
    const user = userEvent.setup();
    render(<Harness guest={DAVE} />);
    await user.click(change()!);
    expect(document.querySelector('.sendas')).toBeNull();
    expect(box(FLOW.nameLabel)!.value).toBe('Dave');
    expect(box(FLOW.emailLabel)!.value).toBe('dave@example.com');
    expect(document.activeElement).toBe(box(FLOW.nameLabel));
    await user.clear(box(FLOW.nameLabel)!);
    await user.type(box(FLOW.nameLabel)!, 'Dave K');
    await user.clear(box(FLOW.emailLabel)!);
    await user.type(box(FLOW.emailLabel)!, 'dk@example.org');
    await user.click(screen.getByRole('button', { name: FLOW.send }));
    expect(f).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(f.mock.calls[0]![1]!.body));
    expect(body).toMatchObject({ name: 'Dave K', email: 'dk@example.org', pitchIdea: 'Sailing' });
  });

  it('AC2: unchanged, the POST sends the pre-filled values', async () => {
    const f = vi.fn<(u: string, i?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ ok: true })),
    );
    vi.stubGlobal('fetch', f);
    const user = userEvent.setup();
    render(<Harness guest={DAVE} />);
    await user.click(screen.getByRole('button', { name: FLOW.send }));
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toMatchObject({
      name: 'Dave',
      email: 'dave@example.com',
    });
  });

  it('a name or email error shows the fields', () => {
    const err: FormError = { key: 'email', target: 'f-email', inline: 'x', summary: 'x' };
    render(<Harness guest={DAVE} errors={[err]} />);
    expect(document.querySelector('.sendas')).toBeNull();
    expect(box(FLOW.emailLabel)!.value).toBe('dave@example.com');
  });

  it('AC3: a general link has no summary line and empty fields', () => {
    render(<Harness guest={GENERAL} />);
    expect(document.querySelector('.sendas')).toBeNull();
    expect(change()).toBeNull();
    expect(box(FLOW.nameLabel)!.value).toBe('');
    expect(box(FLOW.emailLabel)!.value).toBe('');
  });
});
