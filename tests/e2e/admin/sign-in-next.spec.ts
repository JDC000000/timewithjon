// EML-11: a signed-out tap on an email's "Open the request" comes back to that request after sign-in. Signed out, the
// request page sends the browser to sign-in carrying ?next=; signed in, the sign-in page follows a safe next and
// refuses an outside or protocol-relative one (the inbox instead). The code step's own redirect is a DOM test
// (src/app/admin/sign-in/SignInNext.dom.test.tsx).
import { expect, test } from '../support/fixtures';
import { signInAs } from '../support/sessions';

const ID = '11111111-1111-4111-8111-111111111111';
const NEXT = `/admin/requests/${ID}`;

test('signed out: the request page goes to sign-in with ?next= that page', async ({ page }) => {
  await page.goto(NEXT);
  await expect(page).toHaveURL(`/admin/sign-in?next=${encodeURIComponent(NEXT)}`);
});

test('signed in: sign-in follows a safe next, and never an outside one', async ({
  page,
  request,
  baseURL,
}) => {
  await signInAs(page.context(), 'admin', baseURL!);
  const cookies = await page.context().cookies();
  const headers = { cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') };
  const go = async (next: string) =>
    (
      await request.get(`/admin/sign-in?next=${encodeURIComponent(next)}`, { headers, maxRedirects: 0 })
    ).headers()['location'];
  expect(await go(NEXT)).toMatch(new RegExp(`${NEXT}$`));
  for (const evil of ['//evil.example', 'https://evil.example/admin', '/\\evil.example', '/menu'])
    expect(await go(evil), evil).toMatch(/\/admin$/);
});
