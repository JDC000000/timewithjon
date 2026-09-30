// src/app/admin/(app)/settings/_a7/CalendarPane.tsx — T3.3.U1 / T3.15.U1: the A7 Calendar group (wireframe 09 A7
// connected, A7d not connected: where E14's "Reconnect" lands). Connected: the calendar facts + Re-sync. Not
// connected: the last good check, what happens meanwhile, and Connect/Reconnect Google (the one commit). Server.
import type { ReactNode } from 'react';
import { CALENDAR, SETTINGS } from '@/content/ui/admin-season';
import { LandingHeading } from '@/app/admin/_season/Landing';
import type { CalendarStatus } from './data';
import { checkedLabel } from './model';
import { CALENDAR_PATH, CONNECT_GOOGLE, SETTINGS_RETURN_KEY } from './paths';
import type { MailerMode } from '@/lib/adapters/mailer';
import { DisconnectButton } from './DisconnectButton';
import { ResyncButton } from './ResyncButton';

export function CalendarPane({
  status,
  say,
  land,
  back,
  mailer,
  now = new Date(),
}: {
  status: CalendarStatus;
  say: string | null;
  land: boolean;
  back: ReactNode;
  mailer: MailerMode;
  now?: Date;
}) {
  const checked = checkedLabel(status.lastOkAt, now);
  const connected = status.state === 'connected';
  return (
    <>
      {back}
      <div className="pane-pad" style={{ paddingTop: 'var(--s4)', paddingBottom: 'var(--s6)' }}>
        <p className="cap muted">{SETTINGS.title}</p>
        <LandingHeading
          returnKey={SETTINGS_RETURN_KEY}
          href={CALENDAR_PATH}
          say={say}
          land={land}
          className="h1"
          style={{ marginTop: 'var(--s2)' }}
        >
          {SETTINGS.calendar}
        </LandingHeading>
        {say ? <p className="notice">{say}</p> : null}
        {connected ? (
          <>
            <dl className="kv">
              <dt>{CALENDAR.google}</dt>
              <dd>{CALENDAR.connected(checked)}</dd>
              <dt>{CALENDAR.calendar}</dt>
              <dd>{status.calendarName}</dd>
              <dt>{CALENDAR.busy}</dt>
              <dd>{CALENDAR.busyValue}</dd>
              <dt>{CALENDAR.invites}</dt>
              <dd>{CALENDAR.invitesValue}</dd>
            </dl>
            <ResyncButton />
            <DisconnectButton mailer={mailer} />
          </>
        ) : (
          <>
            <p className="ui" style={{ marginTop: 'var(--s3)' }}>
              {CALENDAR.notConnected}
            </p>
            <dl className="kv">
              {checked ? (
                <>
                  <dt>{CALENDAR.lastGood}</dt>
                  <dd>{checked}</dd>
                </>
              ) : null}
              <dt>{CALENDAR.meanwhile}</dt>
              <dd>{CALENDAR.meanwhileValue}</dd>
              <dt>{CALENDAR.calendar}</dt>
              <dd>{status.calendarName}</dd>
            </dl>
            {status.canConnect ? (
              <p style={{ marginTop: 'var(--s5)' }}>
                <a className="btn btn--commit" href={CONNECT_GOOGLE}>
                  {status.state === 'never' ? CALENDAR.connect : CALENDAR.reconnect}
                </a>
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
