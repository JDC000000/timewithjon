// Once per run, app target only: start the stand-in Supabase Auth for admin screens and resolve the guest's real
// invite link (support/sessions.ts). The returned function is the teardown.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { request, type FullConfig } from '@playwright/test';
import { TARGET } from './screens';
import { adminSessionCookie, GUEST_INVITE_FOR, SESSIONS_FILE, startFakeAuth } from './sessions';

/** Booking is open for every invite (the seed's open dates are in the future): set through the admin's own API. */
const OPEN_AT = '2026-01-01T08:00:00Z';

export default async function globalSetup(config: FullConfig): Promise<() => Promise<void>> {
  if (TARGET !== 'app') return async () => {};
  const auth = await startFakeAuth();
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error('global-setup: no baseURL');
  // It writes to the server's database (booking open dates): loopback servers only, never a shared one.
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(new URL(baseURL).origin)) {
    throw new Error(`global-setup: loopback servers only, got ${baseURL}`);
  }
  const api = await request.newContext({ baseURL });
  const res = await api.get(`/?for=${GUEST_INVITE_FOR}`, { maxRedirects: 0 });
  const cookie = (await api.storageState()).cookies.find((c) => c.name === 'twj_invite');
  const admin = adminSessionCookie();
  const opened = await api.patch('/api/admin/settings', {
    headers: { origin: new URL(baseURL).origin, cookie: `${admin.name}=${admin.value}` },
    data: { personalOpenAt: OPEN_AT, generalOpenAt: OPEN_AT },
  });
  const openedText = opened.ok() ? '' : await opened.text();
  await api.dispose();
  if (res.status() !== 303 || !cookie) {
    throw new Error(`global-setup: the invite link answered ${res.status()} without a twj_invite cookie`);
  }
  if (openedText) throw new Error(`global-setup: opening booking answered ${opened.status()} ${openedText}`);
  mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
  writeFileSync(SESSIONS_FILE, JSON.stringify({ guest: { name: cookie.name, value: cookie.value } }));
  return async () => {
    await new Promise((resolve) => auth.close(resolve));
  };
}
