// src/app/_guest/stale.tsx — the friendly "gone a bit stale" page body (S16, the s17b "Link expired" frame), used
// when a capability or token link has expired (T1.8 AC3, T2.7 AC3).
import Link from 'next/link';
import { NOT_FOUND } from '@/content';
import { STALE } from '@/content/ui/guest-after';
import { NARROW } from './layout';

export function StaleState() {
  return (
    <main id="main">
      <div className="wrap" style={NARROW}>
        <div className="flow-top">
          <p className="status-pill">{STALE.pill}</p>
          <h1 className="h1" style={{ marginTop: 'var(--s4)' }}>
            {STALE.title}
          </h1>
          <p className="lead intro">{STALE.body}</p>
        </div>
        <div className="actions">
          <Link href="/">
            <span>{NOT_FOUND.back}</span>
            <span aria-hidden="true">›</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
