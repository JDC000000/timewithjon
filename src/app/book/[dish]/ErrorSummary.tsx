'use client';
// The error summary (pack s10b .errsum): "N things to fix" and one link per error. Send moves focus here; a link
// moves focus to its control (script focus, so the shared helper keeps it in view).
import { forwardRef } from 'react';
import { moveFocus } from '@/ui/focus';
import { thingsToFix } from '@/content/ui/booking';
import type { FormError } from './_lib/form-errors';

export const ErrorSummary = forwardRef<HTMLDivElement, { errors: readonly FormError[] }>(
  function ErrorSummary({ errors }, ref) {
    return (
      <div className="errsum" tabIndex={-1} hidden={errors.length === 0} aria-labelledby="es-h" ref={ref}>
        <h2 id="es-h">{thingsToFix(errors.length)}</h2>
        <ul>
          {errors.map((e) => (
            <li key={e.key}>
              <a
                href={`#${e.target}`}
                onClick={(ev) => {
                  ev.preventDefault();
                  moveFocus(document.getElementById(e.target), 'script');
                }}
              >
                {e.summary}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  },
);
