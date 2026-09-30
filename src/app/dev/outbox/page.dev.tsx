// src/app/dev/outbox/page.dev.tsx — internal tool, deliberately unstyled (not blueprint-scoped). Prototype build only.
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { DEV_COOKIE, devCookieOk, settingsArePrototype } from '@/features/dev/guard';

export const dynamic = 'force-dynamic';
// T1.10.10: access only via the twj_dev cookie from POST /dev/login. A ?pass= is ignored (review L4).
export default async function Outbox() {
  if (!devCookieOk((await cookies()).get(DEV_COOKIE)?.value)) notFound();
  if (!(await settingsArePrototype())) notFound();
  const rows = await q<{
    id: string;
    template: string;
    to_email: string;
    subject: string;
    text_body: string;
    created_at: Date;
  }>(
    `select id, template, to_email, subject, text_body, created_at from dev_outbox order by created_at desc limit 100`,
  );
  return (
    <main>
      <h1>/dev/outbox ({rows.length})</h1>
      {rows.map((r) => (
        <article key={r.id}>
          <h2>
            {r.template} · {r.subject}
          </h2>
          <p>
            to {r.to_email} · {r.created_at.toISOString()}
          </p>
          <pre>{r.text_body}</pre>
        </article>
      ))}
    </main>
  );
}
