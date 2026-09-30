// src/app/admin/_season/GoogleBanner.tsx — T3.3.U1: the shell's Google banner (wireframe 09 A7d, "with the shell
// banner"): drawn once per width, above the panes, whenever Google needs Jon (googleBanner(): the grant is dead or
// the token gone), with the one way out. The AdminShell renders it only after requireAdmin passes. Server.
import { CALENDAR } from '@/content/ui/admin-season';

/** T3.3.03's route: it redirects to Google, so a plain link (never next/link, which would prefetch it). */
export const CONNECT_GOOGLE = '/api/admin/google/connect';

export function GoogleBanner({ canConnect }: { canConnect: boolean }) {
  return (
    <div className="pane-pad" style={{ gridColumn: '1 / -1' }}>
      <div className="notice" role="note" style={{ marginTop: 'var(--s4)' }}>
        <p>{CALENDAR.banner}</p>
        {canConnect ? (
          <p style={{ marginTop: 'var(--s2)' }}>
            <a className="btn btn--sm" href={CONNECT_GOOGLE}>
              {CALENDAR.connect}
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}
