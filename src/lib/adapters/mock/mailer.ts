// src/lib/adapters/mock/mailer.ts — writes to dev_outbox; nothing leaves the building.
import 'server-only';
import { randomUUID } from 'node:crypto';
import { q } from '@/lib/db';
import type { Mailer } from '../types';

export const mockMailer: Mailer = {
  async send(e) {
    await q(
      `insert into dev_outbox (template, to_email, subject, text_body, html_body) values ($1,$2,$3,$4,$5)`,
      [e.template, e.to, e.subject, e.text, e.html ?? null],
    );
    return { id: `mock-${randomUUID()}` };
  },
};
