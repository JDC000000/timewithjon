// "Things to fix" (pack a1/a1b): focus lands on it after each send with problems (FOC-04); a field line moves
// focus to its field. user-event only.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { ErrorSummary, type Problem } from './ErrorSummary';

let uninstall: () => void = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
});
afterEach(() => {
  uninstall();
  cleanup(); // unmount React roots first: a live root's scheduler would fire after jsdom teardown
  document.body.innerHTML = '';
});

function Form({ problems }: { problems: Problem[] }) {
  const [attempt, setAttempt] = useState(0);
  const [shown, setShown] = useState<Problem[]>([]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setShown(problems);
        setAttempt((n) => n + 1);
      }}
    >
      <ErrorSummary problems={shown} attempt={attempt} />
      <label htmlFor="s-email">Your email</label>
      <input id="s-email" />
      <button type="submit">Send me a code</button>
    </form>
  );
}

describe('ErrorSummary', () => {
  it('hidden until a send has problems; then focused, counted, and each field line goes to its field', async () => {
    const user = userEvent.setup();
    render(<Form problems={[{ fieldId: 's-email', message: 'Add the admin email.' }]} />);
    expect(screen.queryByRole('heading', { name: /to fix/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Send me a code' }));
    expect(screen.getByRole('heading', { name: 'One thing to fix' }).closest('[hidden]')).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'One thing to fix' }).parentElement,
    );
    await user.click(screen.getByRole('link', { name: 'Add the admin email.' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Your email' }));
    await user.click(screen.getByRole('button', { name: 'Send me a code' }));
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'One thing to fix' }).parentElement,
    ); // again
  });

  it('a problem with no field is plain text; two problems say so', async () => {
    const user = userEvent.setup();
    render(
      <Form
        problems={[
          { message: 'Something got in the way.' },
          { fieldId: 's-email', message: 'Check your email.' },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Send me a code' }));
    expect(screen.getByRole('heading', { name: 'Two things to fix' }).closest('[hidden]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Something got in the way.' })).toBeNull();
    expect(screen.getByText('Something got in the way.').closest('[hidden]')).toBeNull();
  });
});
