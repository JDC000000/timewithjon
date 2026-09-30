// src/app/admin/(app)/settings/_a7/GroupPane.tsx — T2.9.U1: one A7 group's detail frame (wireframe 09 A7b/A7c):
// "‹ Settings" on a phone, the SETTINGS caption and the group's title, where focus lands on arrival (FOC-04). Server.
import type { ReactNode } from 'react';
import { SETTINGS } from '@/content/ui/admin-season';
import { LandingHeading } from '@/app/admin/_season/Landing';
import { BackRow } from '@/app/admin/_season/SeasonList';
import { SETTINGS_PATH, SETTINGS_RETURN_KEY } from './paths';

export const settingsBack = () => <BackRow href={SETTINGS_PATH} label={SETTINGS.back} />;

export function GroupPane({ title, href, children }: { title: string; href: string; children: ReactNode }) {
  return (
    <>
      {settingsBack()}
      <div className="pane-pad" style={{ paddingTop: 'var(--s4)', paddingBottom: 'var(--s6)' }}>
        <p className="cap muted">{SETTINGS.title}</p>
        <LandingHeading
          returnKey={SETTINGS_RETURN_KEY}
          href={href}
          className="h1"
          style={{ marginTop: 'var(--s2)' }}
        >
          {title}
        </LandingHeading>
        {children}
      </div>
    </>
  );
}
