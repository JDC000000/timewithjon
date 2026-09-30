// src/ui/StagingBanner.tsx (T3.16.U1): on staging only, a strip at the top of every page saying it's a test site
// (the pack's .notice style; orchestrator ruling). Rendered by the root layout; lanes do nothing.
import { STAGING_BANNER } from '@/content/ui/foundation';

export function StagingBanner({ mode }: { mode: string }) {
  if (mode !== 'staging') return null;
  return (
    <div className="wrap">
      <p className="notice" role="note">
        {STAGING_BANNER}
      </p>
    </div>
  );
}
