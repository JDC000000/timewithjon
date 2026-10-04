// src/features/admin/invites.ts — T2.6.01/.02: Jon's invite service for A5 (TSD T2.6, §6 `invite`, C2).
// Create a personal invite (hoped-for list), revoke any link, rotate the general link, list them all with open
// counts and request status, and the Copy link / Copy text data. No AI suggestions anywhere. Server-only; every
// caller has passed requireAdmin().
import 'server-only';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getEnv } from '@/config/env';
import { INVITE_TEXT } from '@/content';
import { dishBySlug, isBookable } from '@/content/menu-helpers';
import type { RequestStatus } from '@/features/availability/types';
import { OurThings } from '@/features/invites/our-things';
import { generateInviteSecret } from '@/features/invites/tokens';
import { q, withTx } from '@/lib/db';
import { ENDED } from './inbox';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME_MAX = 60;
const SLUG_MAX = 40;
const SECRET_TRIES = 3;
/** Control, zero-width and bidi characters: the name goes into the copy text's first line and prefill_name. */
const BAD_NAME_CHAR = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/u;

/** "Dave O'Brien" → "dave-o-brien"; "Zoë" → "zoe". Empty (e.g. all emoji) → "friend". */
export function slugFromName(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
  return s || 'friend';
}

export const CreateInviteBody = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(NAME_MAX)
    .refine((s) => !BAD_NAME_CHAR.test(s), 'bad_character'),
  slug: z.string().regex(SLUG).max(SLUG_MAX).optional(), // defaults to slugFromName(name)
  ourThings: OurThings.default([]),
  pickedDish: z
    .string()
    .nullable()
    .default(null)
    .refine((d) => d === null || (dishBySlug(d) !== undefined && isBookable(dishBySlug(d)!)), 'not_bookable'),
  prefillEmail: z.email().max(254).nullable().default(null),
  hopedFor: z.boolean().default(true),
  isTest: z.boolean().default(false),
});
export type CreateInviteInput = z.infer<typeof CreateInviteBody>;

interface InviteRow {
  id: string;
  kind: 'personal' | 'general';
  is_test: boolean;
  token_secret: string;
  name_slug: string;
  display_name: string | null;
  our_things: string[];
  picked_dish: string | null;
  prefill_email: string | null;
  hoped_for: boolean;
  revoked_at: Date | null;
  first_opened_at: Date | null;
  open_count: number;
  created_at: Date;
}
const COLS = `i.id, i.kind, i.is_test, i.token_secret, i.name_slug, i.display_name, i.our_things, i.picked_dish,
  i.prefill_email::text as prefill_email, i.hoped_for, i.revoked_at, i.first_opened_at, i.open_count, i.created_at`;

/** The link a guest opens: `{site}/?for={slug}-{secret}` (C2). */
export function inviteLink(inv: Pick<InviteRow, 'name_slug' | 'token_secret'>): string {
  return `${getEnv().NEXT_PUBLIC_SITE_URL}/?for=${inv.name_slug}-${inv.token_secret}`;
}

/**
 * Copy text (creative v1.4 §6.7). The link line drops the scheme ("timewithjon.com/?for=…"). The open text keeps
 * the full general link, not the bare domain: the bare domain carries no invite, so it would land on S16.
 */
export function inviteText(
  inv: Pick<InviteRow, 'kind' | 'display_name' | 'name_slug'>,
  link: string,
): string {
  const linkLine = link.replace(/^https?:\/\//, '');
  if (inv.kind === 'general') return `${INVITE_TEXT.openBody}\n${linkLine}`;
  const name = inv.display_name ?? inv.name_slug;
  return `${name}. ${INVITE_TEXT.personalOwnLine}\n${INVITE_TEXT.personalBody}\n${linkLine}`;
}

export interface InviteListItem {
  id: string;
  kind: 'personal' | 'general';
  isTest: boolean;
  name: string | null;
  slug: string;
  ourThings: string[];
  pickedDish: string | null;
  /** The picked dish exists but is no longer bookable (A5 shows a warning). */
  dishNotBookable: boolean;
  prefillEmail: string | null;
  hopedFor: boolean;
  revoked: boolean;
  openCount: number;
  firstOpenedAt: string | null;
  createdAt: string;
  link: string;
  text: string;
  requests: { count: number; latest: { id: string; status: RequestStatus } | null };
}

function toItem(r: InviteRow, requests: InviteListItem['requests'], now: Date): InviteListItem {
  const link = inviteLink(r);
  const dish = r.picked_dish ? dishBySlug(r.picked_dish) : undefined;
  return {
    id: r.id,
    kind: r.kind,
    isTest: r.is_test,
    name: r.display_name,
    slug: r.name_slug,
    ourThings: r.our_things,
    pickedDish: r.picked_dish,
    dishNotBookable: Boolean(r.picked_dish) && !(dish && isBookable(dish, now)),
    prefillEmail: r.prefill_email,
    hopedFor: r.hoped_for,
    revoked: r.revoked_at !== null,
    openCount: r.open_count,
    firstOpenedAt: r.first_opened_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
    link,
    text: inviteText(r, link),
    requests,
  };
}

const NO_REQUESTS = { count: 0, latest: null };

/** Inserts with a fresh secret; a secret collision (40 bits) retries with a new one. */
async function insertInvite(
  c: PoolClient,
  values: (secret: string) => unknown[],
  sql: string,
): Promise<InviteRow> {
  for (let attempt = 1; ; attempt++) {
    await c.query('savepoint invite_insert');
    try {
      const { rows } = await c.query<InviteRow>(sql, values(generateInviteSecret()));
      await c.query('release savepoint invite_insert');
      return rows[0]!;
    } catch (e) {
      await c.query('rollback to savepoint invite_insert');
      const clash = (e as { code?: string; constraint?: string }).constraint === 'invite_token_secret_key';
      if (!clash || attempt >= SECRET_TRIES) throw e;
    }
  }
}

/** In its own transaction, or with `db` inside the caller's (the CSV import writes every row in one). */
export async function createInvite(
  input: CreateInviteInput,
  now = new Date(),
  db?: PoolClient,
): Promise<InviteListItem> {
  const insert = (c: PoolClient) =>
    insertInvite(
      c,
      (secret) => [
        secret,
        input.slug ?? slugFromName(input.name),
        input.name,
        input.ourThings,
        input.pickedDish,
        input.prefillEmail,
        input.hopedFor,
        input.isTest,
      ],
      `insert into invite as i (kind, token_secret, name_slug, display_name, our_things, picked_dish, prefill_name,
                           prefill_email, hoped_for, is_test)
       values ('personal', $1, $2, $3, $4, $5, $3, $6, $7, $8) returning ${COLS}`,
    );
  const row = db ? await insert(db) : await withTx(insert);
  return toItem(row, NO_REQUESTS, now);
}

/** Revokes any link. Idempotent: `changed` is false when it was already revoked. */
export async function revokeInvite(id: string): Promise<{ ok: true; changed: boolean } | { ok: false }> {
  const rows = await q<{ changed: boolean }>(
    `with target as (select id, revoked_at is null as live from invite where id = $1),
          upd as (update invite set revoked_at = now() where id = $1 and revoked_at is null returning id)
     select live as changed from target`,
    [id],
  );
  return rows[0] ? { ok: true, changed: rows[0].changed } : { ok: false };
}

/**
 * Revokes the active general link and inserts a new one, in ONE transaction and in that order (the partial
 * unique index allows one active general row). An advisory lock serialises two rotations; the new link keeps
 * the old slug (and test flag). With no active general link, a new one is created as `friends`.
 */
export async function rotateGeneral(now = new Date()): Promise<InviteListItem> {
  const row = await withTx(async (c) => {
    await c.query(`select pg_advisory_xact_lock(hashtext('twj_general_invite'))`);
    const { rows: old } = await c.query<{ name_slug: string; is_test: boolean }>(
      `update invite set revoked_at = now() where kind = 'general' and revoked_at is null
       returning name_slug, is_test`,
    );
    return insertInvite(
      c,
      (secret) => [secret, old[0]?.name_slug ?? 'friends', old[0]?.is_test ?? false],
      `insert into invite as i (kind, token_secret, name_slug, is_test)
       values ('general', $1, $2, $3) returning ${COLS}`,
    );
  });
  return toItem(row, NO_REQUESTS, now);
}

/**
 * Every invite, newest first (the active general link on top), with its open count and its requests: how many,
 * and the latest one's status (spam suspects left out; a locked request that has ended reads as done, T2.8).
 */
export async function listInvites(now = new Date()): Promise<InviteListItem[]> {
  const [rows, reqs] = await Promise.all([
    q<InviteRow>(
      `select ${COLS} from invite i
        order by (i.kind = 'general' and i.revoked_at is null) desc, i.created_at desc, i.id`,
    ),
    q<{ invite_id: string; count: number; id: string; status: RequestStatus }>(
      `select distinct on (r.invite_id) r.invite_id, count(*) over (partition by r.invite_id)::int as count, r.id,
              case when r.status = 'locked' and coalesce(${ENDED}, false)
                   then 'done' else r.status::text end as status
         from request r left join request h on h.id = r.joined_to_request_id
        where not r.spam_suspect
        order by r.invite_id, r.created_at desc, r.id`,
      [now],
    ),
  ]);
  const byInvite = new Map(
    reqs.map((r) => [r.invite_id, { count: r.count, latest: { id: r.id, status: r.status } }]),
  );
  return rows.map((r) => toItem(r, byInvite.get(r.id) ?? NO_REQUESTS, now));
}
