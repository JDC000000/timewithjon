// tests/unit/ui/sheet.dom.test.tsx (U1, pr73-review F3): the Sheet returns focus to its opener ITSELF
// (useReturnFocus). showModal/close are stubbed with no native focus restore, so a browser can't mask a regression.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { Button, Sheet } from '@/ui';

const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>;
const native = { showModal: proto.showModal, close: proto.close };
/** browsers queue the close event as a task; the race test turns that on */
let queueClose = false;
beforeAll(() => {
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    if (queueClose) setTimeout(() => this.dispatchEvent(new Event('close')), 0);
    else this.dispatchEvent(new Event('close'));
  };
});
afterAll(() => {
  proto.showModal = native.showModal;
  proto.close = native.close;
});

let uninstall: () => void = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
});
afterEach(() => {
  cleanup();
  uninstall();
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Open it
      </Button>
      <Sheet
        id="s"
        open={open}
        onClose={() => setOpen(false)}
        title="The Long Lunch"
        closeLabel="Close The Long Lunch"
      >
        <p>Body</p>
      </Sheet>
    </>
  );
}

describe('Sheet focus (no native restore)', () => {
  it('Esc (cancel), ×, and a scrim click each return focus to the opener; focus lands on the title on open', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    const dialog = document.getElementById('s') as HTMLDialogElement;

    await user.click(opener);
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'The Long Lunch' }));
    const cancel = new Event('cancel', { cancelable: true });
    act(() => {
      dialog.dispatchEvent(cancel);
    });
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);

    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Close The Long Lunch' }));
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);

    await user.click(opener);
    fireEvent.click(dialog); // the scrim: a click on the dialog box itself
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('our own close() does not reach the owner (a reopen right after Esc sticks, with the close event queued)', async () => {
    queueClose = true;
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    const dialog = document.getElementById('s') as HTMLDialogElement;
    await user.click(opener);
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    fireEvent.click(opener); // synchronously, before the queued close event of the Esc close has fired
    await act(() => new Promise((r) => setTimeout(r, 10)));
    expect(dialog.open).toBe(true);
    queueClose = false;
  });
});
