'use client';
// src/app/admin/(app)/settings/_a7/DisconnectButton.tsx — dec 55a (GAP T3.15.03 / T3.14.04): A7 "Disconnect Google".
// Two steps: the button asks first (Yes / Keep it connected), then POST /api/admin/google/disconnect (T3.3.05:
// requireAdmin + FEATURE_ADMIN_AUTH; revokes at Google, forgets the token, keeps calendar_id). Success lands back on
// /admin/settings with ?google=… (like the OAuth callback) so the pane shows its notice; a failure stays here with a line.
// Under mailer_mode gmail_api the ask warns that email stops too (pr95 F3): mail goes out through the Google token.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CALENDAR } from '@/content/ui/admin-season';
import { Button } from '@/ui';
import { announce } from '@/ui/focus';
import { disconnectGoogle } from './api';
import { disconnectOutcome } from './model';
import type { MailerMode } from '@/lib/adapters/mailer';
import { SETTINGS_PATH } from './paths';

export function DisconnectButton({ mailer }: { mailer: MailerMode }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = () => {
    setAsking(false);
    requestAnimationFrame(() => document.getElementById('disconnect-open')?.focus());
  };

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const out = disconnectOutcome(await disconnectGoogle());
    if (out.ok) {
      router.replace(`${SETTINGS_PATH}?google=${out.google}`);
      router.refresh();
      return;
    }
    setBusy(false);
    setError(out.line);
    announce(out.line);
  };

  return (
    <div style={{ marginTop: 'var(--s5)' }}>
      {asking ? (
        <div role="group" aria-labelledby="disconnect-q">
          <p id="disconnect-q" className="ui">
            {mailer === 'gmail_api' ? CALENDAR.disconnectAskGmail : CALENDAR.disconnectAsk}
          </p>
          <p style={{ marginTop: 'var(--s2)', display: 'flex', gap: 'var(--s2)' }}>
            <Button
              variant="commit"
              onClick={() => void run()}
              busy={busy ? CALENDAR.disconnecting : undefined}
              aria-describedby="disconnect-r"
            >
              {CALENDAR.disconnectYes}
            </Button>
            <Button onClick={cancel} disabled={busy}>
              {CALENDAR.disconnectNo}
            </Button>
          </p>
        </div>
      ) : (
        <Button id="disconnect-open" onClick={() => setAsking(true)}>
          {CALENDAR.disconnect}
        </Button>
      )}
      <p id="disconnect-r" className={error ? 'err' : 'help'} style={{ marginTop: 'var(--s2)' }}>
        {error}
      </p>
    </div>
  );
}
