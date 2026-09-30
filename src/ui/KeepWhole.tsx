// src/ui/KeepWhole.tsx (U1).
// VD5-03 / VD7-07 (pack gen.py keep_whole, site.js whole()): a date or a time is never split across lines.
// Each one is wrapped in <span class="nw"> (white-space: nowrap); a leading weekday gets its own outer span so at
// very large text only the weekday may part from the date; a <wbr> before it gives WebKit its break.
import { Fragment, type ReactNode } from 'react';
import { splitWhole } from './keep-whole';

export function KeepWhole({ text }: { text: string }): ReactNode {
  return splitWhole(text).map((p, i) =>
    p.whole ? (
      <Fragment key={i}>
        {p.wbr && <wbr />}
        {p.weekday ? (
          <span className="nw">
            {p.weekday}
            <span className="nw">{p.text}</span>
          </span>
        ) : (
          <span className="nw">{p.text}</span>
        )}
      </Fragment>
    ) : (
      <Fragment key={i}>{p.text}</Fragment>
    ),
  );
}
