// QA L4: the date lock's commit is the .btn--dt button's two flex items, so no piece of the day and time becomes a
// flex item of its own (the column gap opened before the comma: "Lock in Sat Apr 3 , 9 am").
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from '@/ui';
import { CommitLabel } from './DateLockSheet';
import { commitParts } from './lock-sheet';

afterEach(cleanup);

describe('the date lock commit (QA L4)', () => {
  it('is two spans: the verb, then the day and time', () => {
    render(
      <Button variant="commit" dt>
        <CommitLabel {...commitParts('2027-04-03', '09:00')} />
      </Button>,
    );
    const b = screen.getByRole('button');
    expect([...b.children].map((c) => c.tagName)).toEqual(['SPAN', 'SPAN']);
    const loose = [...b.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
    expect(loose).toEqual([]);
    expect(b.children[0]!.textContent).toBe('Lock in');
    expect(b.children[1]!.textContent).toBe('Sat Apr 3, 9 am');
    expect(b.textContent).toBe('Lock in Sat Apr 3, 9 am');
  });
});
