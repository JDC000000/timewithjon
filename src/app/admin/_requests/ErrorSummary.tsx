'use client';
// src/app/admin/_requests/ErrorSummary.tsx — the pack's "Things to fix" box (a1, a1b, a4c): shown after a send
// with problems, focused (FOC-04), one line per problem; a line with a field id is a link that moves focus there.
import { useEffect, useRef } from 'react';
import { moveFocus } from '@/ui/focus';
import { fixCountHeading } from '@/content/ui/admin-requests';

export interface Problem {
  /** The field to go to; none for a problem that isn't one field's (e.g. the server said no). */
  fieldId?: string;
  message: string;
}

export function ErrorSummary({ problems, attempt }: { problems: Problem[]; attempt: number }) {
  const box = useRef<HTMLDivElement>(null);
  // Each send with problems lands focus on the summary, even when the same problems come back.
  useEffect(() => {
    if (attempt > 0 && problems.length > 0) moveFocus(box.current, 'script');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new send moves focus, never a fix in progress
  }, [attempt]);

  return (
    <div className="errsum" tabIndex={-1} hidden={problems.length === 0} aria-labelledby="es-h" ref={box}>
      <h2 id="es-h">{fixCountHeading(problems.length)}</h2>
      <ul>
        {problems.map((p) => (
          <li key={`${p.fieldId ?? ''}:${p.message}`}>
            {p.fieldId ? (
              <a
                href={`#${p.fieldId}`}
                onClick={(e) => {
                  e.preventDefault();
                  moveFocus(document.getElementById(p.fieldId!), 'script');
                }}
              >
                {p.message}
              </a>
            ) : (
              p.message
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
