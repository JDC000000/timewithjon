// T4.6.04 (+T1.11.U3): put the prototype server in the state each audited page needs and write the audit targets.
// Loopback test server + DB only (CI). Same moves as the E2E suite: booking opened through the admin API behind the
// stand-in Supabase Auth (tests/e2e/support/global-setup.ts), the seeded guest's real invite link for the picker,
// and a seeded request with a signed twj_req capability for After Send (tests/e2e/guest-after/s11-picker.spec.ts).
// Each page is fetched once with its cookie and must answer 200 in the right state, so a score is never taken of an
// error or a stale page.
// Usage: pnpm exec tsx tests/lighthouse/prepare.ts <baseURL> <out.tsv>   (tab-separated: page, url, cookie header)
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { AFTER_SEND, DISHES } from '../../src/content';
import { isBookable } from '../../src/content/menu-helpers';
import { signCookie } from '../../src/features/invites/tokens';
import { ROUTES } from '../../src/ui/routes';
import { adminSessionCookie, GUEST_INVITE_FOR, startFakeAuth } from '../e2e/support/sessions';

const [baseURL, outFile] = process.argv.slice(2);
if (!baseURL || !outFile) throw new Error('usage: prepare.ts <baseURL> <out.tsv>');
const origin = new URL(baseURL).origin;
// It writes to the server's database: loopback servers only, never a shared one.
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))
  throw new Error(`loopback only, got ${origin}`);

/** Booking open for every invite (as E2E global-setup: the seed's open dates are in the future). */
const OPEN_AT = '2026-01-01T08:00:00Z';
/** The picker screen = the first bookable picker dish on the menu (as tests/e2e/support/screens.ts). */
const PICKER_DISH = DISHES.find((d) => d.flow === 'picker' && isBookable(d))?.slug;
if (!PICKER_DISH) throw new Error('no bookable picker dish in src/content');
/** A dates screen = the first bookable dates dish (as tests/e2e/support/screens.ts). */
const DATES_DISH = DISHES.find((d) => d.flow === 'dates' && isBookable(d))?.slug;
if (!DATES_DISH) throw new Error('no bookable dates dish in src/content');

async function openBooking(): Promise<void> {
  const auth = await startFakeAuth();
  try {
    const admin = adminSessionCookie();
    const res = await fetch(`${origin}/api/admin/settings`, {
      method: 'PATCH',
      headers: { origin, cookie: `${admin.name}=${admin.value}`, 'content-type': 'application/json' },
      body: JSON.stringify({ personalOpenAt: OPEN_AT, generalOpenAt: OPEN_AT }),
    });
    if (!res.ok) throw new Error(`opening booking answered ${res.status} ${await res.text()}`);
  } finally {
    await new Promise((resolve) => auth.close(resolve));
  }
}

/** The seeded guest's twj_invite cookie, from their real invite link. */
async function guestCookie(): Promise<string> {
  const res = await fetch(`${origin}/?for=${GUEST_INVITE_FOR}`, { redirect: 'manual' });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .find((c) => c.startsWith('twj_invite='));
  if (res.status !== 303 || !cookie)
    throw new Error(`the invite link answered ${res.status} without twj_invite`);
  return cookie;
}

/** A plain (not stand-by) request row on the general invite, and its signed twj_req cookie. */
async function sentCookie(): Promise<string> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const email = `lighthouse-${randomUUID()}@example.com`;
    const { rows } = await db.query<{ id: string }>(
      `with g as (insert into guest (email) values ($1) returning id)
       insert into request (client_key, guest_id, invite_id, contact_name, contact_email, dish, mode, counts_toward,
                            status)
       select $2, g.id, (select id from invite where token_secret = 'g3hx8q2v'), 'Sam Rivera', $1,
              'the-flat-white', 'slots', 'weekly_cap', 'requested'::request_status
         from g returning id`,
      [email, randomUUID()],
    );
    const secret = process.env.SESSION_SIGNING_SECRET;
    if (!secret) throw new Error('SESSION_SIGNING_SECRET is not set');
    return `twj_req=${signCookie('req', rows[0]!.id, 7200, secret)}`;
  } finally {
    await db.end();
  }
}

/** The page answers 200 (no redirect) and, when given, shows `mustContain`. */
async function check(path: string, cookie: string, mustContain?: string): Promise<void> {
  const res = await fetch(`${origin}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  const body = await res.text();
  if (res.status !== 200) throw new Error(`${path} answered ${res.status}`);
  if (mustContain && !body.includes(mustContain)) throw new Error(`${path} does not show "${mustContain}"`);
}

await openBooking();
const guest = await guestCookie();
const sent = await sentCookie();
const targets: [page: string, path: string, cookie: string, mustContain?: string][] = [
  ['/', ROUTES.home, ''],
  ['/menu', ROUTES.menu, ''],
  [`/book/${PICKER_DISH}`, `/book/${PICKER_DISH}`, guest],
  [`/book/${DATES_DISH}`, `/book/${DATES_DISH}`, guest],
  ['/sent (After Send)', ROUTES.sent, sent, AFTER_SEND.stamp],
];
for (const [, path, cookie, mustContain] of targets) await check(path, cookie, mustContain);
writeFileSync(
  outFile,
  targets.map(([page, path, cookie]) => `${page}\t${origin}${path}\t${cookie}\n`).join(''),
);
console.log(`prepare: ${targets.length} pages ready`);
