// T3.10.01-.03 against the real schema with in-memory buckets: AC1 (a valid zip), AC2 (consented only), AC3 (BOM),
// AC4 (email opt-in), AC6 (24 h purge), spam suspects and sealed plans never exported, one export at a time.
// AC5 (400 MB) runs when TWJ_BIG_EXPORT=1 (a local/staging check; it writes ~400 MB to /tmp).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool, q, withTx } from '@/lib/db';
import { createRequestTx } from '@/features/requests/create';
import { RequestBody } from '@/features/requests/schema';
import { runExport } from '@/features/export/run';
import { EXPORT_MAX_BYTES } from '@/features/export/limits';
import { BUCKET_LIMITS } from '../../ops/bucket-limits';
import { exportStories } from '@/features/export/build';
import { removeRequests } from '../fixtures/requests-db';
import { createMemoryStore, type MemoryStore } from '@/lib/adapters/mock/object-store';
import { createMemoryExportStore, type MemoryExportStore } from '@/lib/adapters/mock/export-store';
import type { ExportStore } from '@/lib/adapters/exports';

const mem = vi.hoisted(() => ({ exports: null as unknown as MemoryExportStore }));
vi.mock('@/lib/adapters/exports', async (orig) => ({
  ...(await orig<typeof import('@/lib/adapters/exports')>()),
  exportStore: () => mem.exports,
}));

let photos: MemoryStore;
let inviteId = '';
let slotId = '';
const CANARY = `SEALED-CANARY-${randomUUID()}`;
const NOW_EXPORT = new Date('2027-07-01T18:00:00Z');
// pr50-verify N3: a private /tmp for this file, so the stale-zip sweep can't touch a sibling worktree's live zip.
const prevTmp = process.env.TMPDIR; // pr60-verify N-H: restored afterwards
const TMP = mkdtempSync(path.join(tmpdir(), 'twj-export-int-'));
process.env.TMPDIR = TMP; // the unzip scratch dirs land here too, and go with it
beforeAll(async () => {
  inviteId = (await q<{ id: string }>(`select id from invite where kind = 'general'`))[0]!.id;
  slotId = (await q<{ id: string }>(`select id from slot where date = '2027-05-13' limit 1`))[0]!.id;
});
beforeEach(async () => {
  photos = createMemoryStore();
  mem.exports = createMemoryExportStore();
  await q(`delete from export_job`);
});
afterAll(async () => {
  await pool().end();
  rmSync(TMP, { recursive: true, force: true });
  if (prevTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = prevTmp;
});

async function newRequest(name: string, isTest = false): Promise<string> {
  const body = RequestBody.parse({
    clientKey: randomUUID(),
    dish: 'the-long-lunch',
    name,
    email: `${name.toLowerCase()}+${randomUUID().slice(0, 6)}@example.com`,
    crew: 1,
    slotIds: [slotId],
  });
  const a = {
    body,
    inviteId,
    isTest,
    spam: false,
    mode: 'slots' as const,
    status: 'requested' as const,
    countsToward: 'weekly_cap' as const,
    bigCrew: false,
    dishName: 'The Long Lunch',
  };
  const id = (await withTx((c) => createRequestTx(c, a))).requestId;
  await q(`update request set surprise_plan_sealed = $2 where id = $1`, [id, CANARY]);
  return id;
}
async function story(o: {
  requestId?: string;
  inviteId?: string;
  source?: string;
  body?: string | null;
  consent: boolean;
  spam?: boolean;
  fromEmail?: string;
  fromName?: string;
  photos?: number;
}) {
  const id = (
    await q<{ id: string }>(
      `insert into story (source, request_id, body, consent, consent_source, spam_suspect, from_email, from_name,
                          invite_id)
       values ($1::story_source, $2, $3, $4, case when $4 then 'tickbox'::consent_source end, $5, $6, $7, $8)
       returning id`,
      [
        o.source ?? (o.requestId ? 'after_send' : o.inviteId ? 'story_page' : 'email_in'),
        o.requestId ?? null,
        o.body === undefined ? 'We went to the Long Lunch, "and it rained", then sun.' : o.body,
        o.consent,
        o.spam ?? false,
        o.fromEmail ?? null,
        o.fromName ?? null,
        o.inviteId ?? null,
      ],
    )
  )[0]!.id;
  for (let i = 0; i < (o.photos ?? 0); i++) {
    const pid = randomUUID();
    await q(
      `insert into photo (id, story_id, storage_path, width, height, bytes) values ($1, $2, $3, 10, 10, 3)`,
      [pid, id, `final/${pid}.jpg`],
    );
    photos.put(`final/${pid}.jpg`, Buffer.from(`jpeg-${id}-${i}`), 'image/jpeg');
  }
  return id;
}

/** AC1: python's zipfile (the same format checks as macOS/Windows' unzip) validates every CRC. */
function unzip(bytes: Buffer): Record<string, string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'twj-export-test-'));
  const f = path.join(dir, 'x.zip');
  writeFileSync(f, bytes);
  const out = execFileSync('python3', [
    '-c',
    'import zipfile,sys,json,base64\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(json.dumps({i.filename: base64.b64encode(z.read(i)).decode() for i in z.infolist()}))',
    f,
  ]);
  return Object.fromEntries(
    Object.entries(JSON.parse(out.toString()) as Record<string, string>).map(([k, v]) => [
      k,
      Buffer.from(v, 'base64').toString('latin1'),
    ]),
  );
}
const zipOf = (jobId: string) => mem.exports.objects.get(`zips/${jobId}.zip`)!.bytes;
const csvRows = (files: Record<string, string>) =>
  Buffer.from(files['stories.csv']!, 'latin1').toString('utf8').slice(1).split('\r\n');

describe('POST /api/admin/export: runExport (T3.10.01)', () => {
  it('consented only by default: consented stories and their photos, no email, BOM, a valid zip (AC1-AC4)', async () => {
    const r1 = await newRequest('Pia');
    const yes = await story({ requestId: r1, consent: true, photos: 2 });
    const no = await story({ requestId: await newRequest('Noor'), consent: false, photos: 1 });
    const emailed = await story({
      consent: true,
      fromEmail: 'aunt@example.com',
      fromName: 'Aunt Bea',
      photos: 1,
    });
    const out = await runExport(
      { consentedOnly: true, includeEmail: false },
      { photos, exports: mem.exports },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const files = unzip(zipOf(out.jobId));
    expect(Buffer.from(files['stories.csv']!, 'latin1').subarray(0, 3)).toEqual(
      Buffer.from([0xef, 0xbb, 0xbf]),
    );
    const rows = csvRows(files);
    expect(rows[0]).toBe('id,source,name,dish,date,body,consent,consent_source,photos');
    const line = (id: string) => rows.find((r) => r.startsWith(id));
    expect(line(yes)).toBe(
      `${yes},after_send,Pia,The Long Lunch,${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })},"We went to the Long Lunch, ""and it rained"", then sun.",true,tickbox,${yes}-1.jpg ${yes}-2.jpg`,
    );
    expect(line(emailed)).toContain(',email_in,Aunt Bea,,');
    expect(line(no)).toBeUndefined();
    expect(files[`photos/${yes}-1.jpg`]).toBe(`jpeg-${yes}-0`);
    expect(files[`photos/${yes}-2.jpg`]).toBe(`jpeg-${yes}-1`);
    expect(Object.keys(files).some((f) => f.includes(no))).toBe(false);
    expect(rows.join('\n')).not.toContain('aunt@example.com');
    const job = (
      await q<{ status: string; storage_path: string; consented_only: boolean }>(
        `select status, storage_path, consented_only from export_job where id = $1`,
        [out.jobId],
      )
    )[0]!;
    expect(job).toEqual({ status: 'done', storage_path: `zips/${out.jobId}.zip`, consented_only: true });
    expect(out.url).toMatch(
      new RegExp(
        `^memory://read/zips/${out.jobId}\\.zip\\?ttl=600&download=time-with-jon-stories-\\d{4}-\\d{2}-\\d{2}\\.zip$`,
      ),
    );
    expect(existsSync(path.join(tmpdir(), `twj-export-${out.jobId}.zip`))).toBe(false); // /tmp cleaned
  });

  it('all + email: non-consented rows too, the email column last; never a sealed plan, never a spam suspect', async () => {
    const r = await newRequest('Sam');
    const no = await story({ requestId: r, consent: false });
    const emailed = await story({ consent: true, fromEmail: 'aunt@example.com', fromName: 'Aunt Bea' });
    const spamStory = await story({ consent: true, spam: true, photos: 1 });
    const spamReq = await newRequest('Spammy');
    await q(`update request set spam_suspect = true where id = $1`, [spamReq]);
    const fromSpamReq = await story({ requestId: spamReq, consent: true });
    const empty = await story({ requestId: await newRequest('Quiet'), consent: true, body: null });
    const out = await runExport(
      { consentedOnly: false, includeEmail: true },
      { photos, exports: mem.exports },
    );
    if (!out.ok) throw new Error(out.code);
    const files = unzip(zipOf(out.jobId));
    const rows = csvRows(files);
    expect(rows[0]).toBe('id,source,name,dish,date,body,consent,consent_source,photos,email');
    expect(rows.find((l) => l.startsWith(no))).toMatch(/,false,,,sam\+\w+@example\.com$/);
    expect(rows.find((l) => l.startsWith(emailed))).toMatch(/,aunt@example\.com$/);
    for (const id of [spamStory, fromSpamReq, empty])
      expect(rows.find((l) => l.startsWith(id))).toBeUndefined();
    expect(zipOf(out.jobId).toString('latin1')).not.toContain('SEALED-CANARY');
    expect(Object.values(files).join('')).not.toContain(CANARY);
  });

  it("pr50 F1: a test request's consented story and its photo never reach the zip", async () => {
    const real = await story({ requestId: await newRequest('Real'), consent: true, photos: 1 });
    const test = await story({ requestId: await newRequest('Dry', true), consent: true, photos: 1 });
    const out = await runExport(
      { consentedOnly: false, includeEmail: false },
      { photos, exports: mem.exports },
    );
    if (!out.ok) throw new Error(out.code);
    const files = unzip(zipOf(out.jobId));
    expect(csvRows(files).find((l) => l.startsWith(real))).toBeDefined();
    expect(files[`photos/${real}-1.jpg`]).toBeDefined();
    expect(csvRows(files).find((l) => l.startsWith(test))).toBeUndefined();
    expect(files[`photos/${test}-1.jpg`]).toBeUndefined();
  });

  it('pr43 N1: a story page saved through a test invite, and its photo, never reach the zip', async () => {
    const realInvite = (
      await q<{ id: string }>(
        `insert into invite (kind, token_secret, name_slug, display_name, is_test)
         values ('personal', $1, $2, 'Real', false) returning id`,
        [
          randomUUID()
            .replace(/[^a-hjkmnp-tv-z0-9]/g, '')
            .slice(0, 8)
            .padEnd(8, 'a'),
          `real-${randomUUID().slice(0, 8)}`,
        ],
      )
    )[0]!.id;
    const real = await story({ inviteId: realInvite, consent: true, photos: 1 });
    const test = await story({ inviteId, consent: true, photos: 1 }); // the seed's general invite is is_test
    const out = await runExport(
      { consentedOnly: false, includeEmail: false },
      { photos, exports: mem.exports },
    );
    if (!out.ok) throw new Error(out.code);
    const files = unzip(zipOf(out.jobId));
    expect(csvRows(files).find((l) => l.startsWith(real))).toBeDefined();
    expect(files[`photos/${real}-1.jpg`]).toBeDefined();
    expect(csvRows(files).find((l) => l.startsWith(test))).toBeUndefined();
    expect(files[`photos/${test}-1.jpg`]).toBeUndefined();
    await q(`delete from story where invite_id = $1`, [realInvite]);
    await q(`delete from invite where id = $1`, [realInvite]);
  });

  it("a joined guest's story is dated by the host's time together, not the day the story came in", async () => {
    const host = await newRequest('Hostie');
    const joined = await newRequest('Joiner');
    await q(
      `update request set status = 'done', locked_slot_id = $2, locked_starts_at = '2027-05-13T19:00:00Z',
              locked_ends_at = '2027-05-13T21:00:00Z' where id = $1`,
      [host, slotId],
    );
    await q(`update request set status = 'done', joined_to_request_id = $2 where id = $1`, [joined, host]);
    const id = await story({ requestId: joined, consent: true });
    try {
      const out = await exportStories({ consentedOnly: true, includeEmail: false });
      expect(out.find((r) => r.id === id)?.date).toBe('2027-05-13');
    } finally {
      // A finished joined row has no range of its own: left behind, other files' "free slot" queries see it
      // overlap everything.
      await q(`delete from story where id = $1`, [id]);
      await removeRequests([joined, host]);
    }
  });

  it('ENG-05: a story on a cancelled booking is dated by the day it came in, not the time that never happened', async () => {
    const r = await newRequest('Cancelly');
    await q(
      `update request set status = 'cancelled', cancelled_by = 'guest', locked_slot_id = $2,
              locked_starts_at = '2027-05-27T19:00:00Z', locked_ends_at = '2027-05-27T21:00:00Z' where id = $1`,
      [r, slotId],
    );
    const id = await story({ requestId: r, consent: true });
    const [{ came }] = (await q<{ came: string }>(
      `select to_char((created_at at time zone 'America/Vancouver')::date, 'YYYY-MM-DD') as came from story where id = $1`,
      [id],
    )) as [{ came: string }];
    try {
      const out = await exportStories({ consentedOnly: true, includeEmail: false });
      expect(out.find((x) => x.id === id)?.date).toBe(came);
    } finally {
      await q(`delete from story where id = $1`, [id]);
      await removeRequests([r]);
    }
  });

  it('a missing photo object is left out of the zip and the CSV', async () => {
    const id = await story({ consent: true, photos: 2 });
    const first = (
      await q<{ storage_path: string }>(
        `select storage_path from photo where story_id = $1 order by created_at, id limit 1`,
        [id],
      )
    )[0]!;
    photos.objects.delete(first.storage_path);
    const out = await runExport(
      { consentedOnly: true, includeEmail: false },
      { photos, exports: mem.exports },
    );
    if (!out.ok) throw new Error(out.code);
    const files = unzip(zipOf(out.jobId));
    expect(csvRows(files).find((l) => l.startsWith(id))).toMatch(new RegExp(`,${id}-1\\.jpg$`));
    expect(files[`photos/${id}-2.jpg`]).toBeUndefined();
  });

  it('one export at a time; a running job older than 10 minutes no longer blocks', async () => {
    await q(`insert into export_job (status) values ('running')`);
    expect(
      await runExport({ consentedOnly: true, includeEmail: false }, { photos, exports: mem.exports }),
    ).toEqual({ ok: false, code: 'busy' });
    await q(`update export_job set created_at = now() - interval '11 minutes'`);
    expect(
      (await runExport({ consentedOnly: true, includeEmail: false }, { photos, exports: mem.exports })).ok,
    ).toBe(true);
  });

  it('a zip one byte over the cap is refused before the upload; one exactly at the cap still goes', async () => {
    await story({ consent: true, photos: 2 });
    const opts = { consentedOnly: true, includeEmail: false };
    const first = await runExport(opts, { photos, exports: mem.exports }, NOW_EXPORT);
    expect(first.ok).toBe(true);
    const bytes = (first as { bytes: number }).bytes;
    // the same content again, at a cap one byte under its size: refused, failed, nothing uploaded, no file left
    mem.exports = createMemoryExportStore();
    await q(`delete from export_job`);
    const over = await runExport(opts, { photos, exports: mem.exports }, NOW_EXPORT, bytes - 1);
    expect(over).toEqual({ ok: false, code: 'too_large', bytes, maxBytes: bytes - 1 });
    expect(mem.exports.objects.size).toBe(0);
    const [job] = await q<{ id: string; status: string }>(`select id, status from export_job`);
    expect(job!.status).toBe('failed');
    expect(existsSync(path.join(tmpdir(), `twj-export-${job!.id}.zip`))).toBe(false);
    // at exactly its size: uploaded (the cap is the largest zip allowed)
    const at = await runExport(opts, { photos, exports: mem.exports }, NOW_EXPORT, bytes);
    expect(at).toMatchObject({ ok: true, bytes });
    expect(mem.exports.objects.size).toBe(1);
    // the default cap is the exports bucket's own limit
    expect(EXPORT_MAX_BYTES).toBe(BUCKET_LIMITS.exports.fileSizeLimit);
  });

  it('a failed upload marks the job failed and removes the local file', async () => {
    const failing: ExportStore = {
      ...mem.exports,
      uploadFile: async () => Promise.reject(new Error('storage down')),
    };
    await expect(
      runExport({ consentedOnly: true, includeEmail: false }, { photos, exports: failing }),
    ).rejects.toThrow('storage down');
    const [job] = await q<{ id: string; status: string }>(`select id, status from export_job`);
    expect(job!.status).toBe('failed');
    expect(existsSync(path.join(tmpdir(), `twj-export-${job!.id}.zip`))).toBe(false);
  });
});

describe('pr50 F3/F4: a failed or killed export leaves nothing behind', () => {
  /** Open file descriptors on an export zip (a leaked write stream shows up here even after the rm). */
  const zipFds = () =>
    readdirSync('/proc/self/fd').filter((fd) => {
      try {
        return readlinkSync(`/proc/self/fd/${fd}`).includes('twj-export-');
      } catch {
        return false;
      }
    });
  async function expectCleanFailure(broken: MemoryStore, message: RegExp) {
    await story({ consent: true, photos: 2 });
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      await expect(
        runExport({ consentedOnly: true, includeEmail: false }, { photos: broken, exports: mem.exports }),
      ).rejects.toThrow(message);
      await new Promise((r) => setTimeout(r, 50)); // let a stray rejection or a lingering stream surface
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect(zipFds()).toEqual([]);
    const [job] = await q<{ id: string; status: string }>(`select id, status from export_job`);
    expect(job!.status).toBe('failed');
    expect(existsSync(path.join(tmpdir(), `twj-export-${job!.id}.zip`))).toBe(false);
  }

  it('a photo download that throws: job failed, no file, no open stream, no unhandled rejection', async () => {
    await expectCleanFailure(
      { ...photos, download: async () => Promise.reject(new Error('storage 500')) },
      /storage 500/,
    );
  });
  it('an archive error mid-loop rejects (never hangs), with the same clean-up', async () => {
    // archiver refuses a non-Buffer entry by emitting 'error' from inside append()
    await expectCleanFailure(
      { ...photos, download: async () => 42 as unknown as Buffer },
      /buffer|stream|string/i,
    );
  });

  it('a zip left in /tmp by a killed export is removed by the next one (after it takes the slot)', async () => {
    const stale = path.join(tmpdir(), `twj-export-${randomUUID()}.zip`);
    const other = path.join(tmpdir(), `twj-other-${randomUUID()}.zip`);
    writeFileSync(stale, 'x');
    writeFileSync(other, 'x');
    try {
      await q(`insert into export_job (status) values ('running')`);
      await runExport({ consentedOnly: true, includeEmail: false }, { photos, exports: mem.exports });
      expect(existsSync(stale)).toBe(true); // busy: this call never held the slot, so it touched nothing
      await q(`delete from export_job`);
      expect(
        (await runExport({ consentedOnly: true, includeEmail: false }, { photos, exports: mem.exports })).ok,
      ).toBe(true);
      expect(existsSync(stale)).toBe(false);
      expect(existsSync(other)).toBe(true);
    } finally {
      rmSync(other, { force: true });
      rmSync(stale, { force: true });
    }
  });
});

describe('the export purge (T3.10.02, AC6)', () => {
  it('deletes zips older than 24 h, keeps newer ones, and closes a dead running job', async () => {
    const { runTick } = await import('@/features/jobs');
    const now = new Date();
    mem.exports.put('zips/old.zip', Buffer.from('x'), new Date(now.getTime() - 25 * 3600_000));
    mem.exports.put('zips/new.zip', Buffer.from('x'), new Date(now.getTime() - 23 * 3600_000));
    const [dead] = await q<{ id: string }>(
      `insert into export_job (status, created_at) values ('running', now() - interval '11 minutes') returning id`,
    );
    const [live] = await q<{ id: string }>(`insert into export_job (status) values ('running') returning id`);
    expect((await runTick(now)).ran).toContain('purge-exports');
    expect([...mem.exports.objects.keys()]).toEqual(['zips/new.zip']);
    const status = async (id: string) =>
      (await q<{ status: string }>(`select status from export_job where id = $1`, [id]))[0]!.status;
    expect(await status(dead!.id)).toBe('failed');
    expect(await status(live!.id)).toBe('running');
  });
});

describe.runIf(process.env.TWJ_BIG_EXPORT === '1')('a 400 MB export (T3.10.03 AC5)', () => {
  it('completes, streaming from disk', async () => {
    const photo = Buffer.alloc(2 * 1024 * 1024, 7); // 2 MB each, stored uncompressed
    const big = createMemoryStore();
    big.download = async () => photo;
    for (let i = 0; i < 100; i++) await story({ consent: true, photos: 2 });
    let uploaded = 0;
    const counting: ExportStore = {
      ...mem.exports,
      uploadFile: async (_p, file, bytes) => {
        uploaded = (await stat(file)).size;
        expect(uploaded).toBe(bytes);
      },
    };
    const t0 = Date.now();
    const out = await runExport(
      { consentedOnly: true, includeEmail: false },
      { photos: big, exports: counting },
    );
    if (!out.ok) throw new Error(out.code);
    expect(out.photos).toBeGreaterThanOrEqual(200);
    expect(uploaded).toBeGreaterThan(400 * 1024 * 1024);
    console.log(
      `400 MB export: ${(uploaded / 1048576).toFixed(0)} MB, ${out.photos} photos, ${Date.now() - t0} ms`,
    );
    expect((await readdir(tmpdir())).some((f) => f.startsWith(`twj-export-${out.jobId}`))).toBe(false);
  }, 300_000);
});
