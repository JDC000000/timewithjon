// src/app/admin/(app)/settings/_a7/SettingsList.tsx — T2.9.U1: the A7 list pane (wireframe 09 A7): the groups. The
// A7d Google banner is the shell's (src/app/admin/_season/GoogleBanner.tsx), drawn once per width. Server.
// wireframe 09 also lists "Account"; it has no drawn state, so it waits for one (not built).
import Link from 'next/link';
import { SETTINGS } from '@/content/ui/admin-season';
import { CALENDAR_PATH, OPENING_PATH, REPLIES_PATH } from './paths';

export type SettingsGroup = 'calendar' | 'opening' | 'replies';

const GROUPS: { key: SettingsGroup; href: string; label: string }[] = [
  { key: 'calendar', href: CALENDAR_PATH, label: SETTINGS.calendar },
  { key: 'opening', href: OPENING_PATH, label: SETTINGS.opening },
  { key: 'replies', href: REPLIES_PATH, label: SETTINGS.replies },
];

export function SettingsList({ current }: { current?: SettingsGroup }) {
  return (
    <>
      <div className="pane-pad">
        <h1 className="h1" style={{ marginTop: 'var(--s4)' }}>
          {SETTINGS.title}
        </h1>
      </div>
      <ul className="rows" style={{ marginTop: 'var(--s3)' }}>
        {GROUPS.map((g) => (
          <li key={g.key}>
            <Link className="req" href={g.href} aria-current={current === g.key ? 'page' : undefined}>
              <span className="who">{g.label}</span>
              <span className="age" aria-hidden="true">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
