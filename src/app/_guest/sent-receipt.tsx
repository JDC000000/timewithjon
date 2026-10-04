// src/app/_guest/sent-receipt.tsx — QA L7 / QA r2 M1: the "When" receipt of what the guest sent (times, dates,
// a window or stand-by days, as /sent lists them), while nothing is locked. Shared by /manage and the S18 pages.
import { Fragment } from 'react';
import { MANAGE_UI } from '@/content/manage';
import { KeepWhole } from '@/ui';

export function SentReceipt({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="receipt" data-manage-sent="">
      <dl className="facts" style={{ marginTop: 0, border: 0, padding: 0 }}>
        <dt>{MANAGE_UI.when}</dt>
        <dd>
          {lines.map((line, i) => (
            <Fragment key={line}>
              {i > 0 && <br />}
              <KeepWhole text={line} />
            </Fragment>
          ))}
        </dd>
      </dl>
    </div>
  );
}
