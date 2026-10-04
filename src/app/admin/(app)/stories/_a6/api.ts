// src/app/admin/(app)/stories/_a6/api.ts — T2.9.U1 / T3.7.U1: the browser side of A6. Thin JSON calls to the admin
// routes (T2.9.01 consent, T3.7.02 email-in, T3.7.03 photos through the T3.6 pipeline). Every route checks
// requireAdmin + Origin itself; nothing secret lives here.

const STORIES = '/api/admin/stories';

async function json(
  method: string,
  url: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; data: unknown }> {
  try {
    const res = await fetch(url, {
      method,
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'content-type': 'application/json', ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

/** Jon's consent toggle (consent_source = 'jon'). */
export async function setConsent(storyId: string, consent: boolean): Promise<boolean> {
  const { status } = await json('PATCH', `${STORIES}/${storyId}`, { consent });
  return status === 200;
}

/**
 * A6 "Add emailed story": the new story's id (null on any refusal) and the status. `idempotencyKey` is reused when
 * Jon retries the same story, so a lost 201 never makes a duplicate (pr82-review F5); 409 = the key was already used
 * for another payload (pr83-review M1).
 */
export async function addEmailedStory(
  s: { fromName: string; fromEmail: string; body: string; consent: boolean },
  idempotencyKey: string,
): Promise<{ id: string | null; status: number }> {
  const { status, data } = await json('POST', `${STORIES}/email-in`, s, {
    'idempotency-key': idempotencyKey,
  });
  const id = (data as { storyId?: unknown } | null)?.storyId;
  return { id: status === 201 && typeof id === 'string' ? id : null, status };
}

/**
 * One photo: sign -> the browser's own PUT to the signed URL -> finalise. 'skipped' = the prototype stores no photos
 * (the sign route answers { mock: true }); 'failed' = any step refused.
 */
export async function uploadPhoto(storyId: string, file: File): Promise<'ok' | 'skipped' | 'failed'> {
  const signed = await json('POST', `${STORIES}/${storyId}/photos/sign`, {});
  const s = signed.data as { mock?: boolean; uploadId?: string; signedUrl?: string } | null;
  if (signed.status === 200 && s?.mock) return 'skipped';
  if (signed.status !== 200 || !s?.uploadId || !s.signedUrl) return 'failed';
  try {
    const put = await fetch(s.signedUrl, {
      method: 'PUT',
      headers: { 'content-type': file.type || 'application/octet-stream', 'x-upsert': 'false' },
      body: file,
    });
    if (!put.ok) return 'failed';
  } catch {
    return 'failed';
  }
  const fin = await json('POST', `${STORIES}/${storyId}/photos/finalise`, { photoUploadId: s.uploadId });
  return fin.status === 200 || fin.status === 202 ? 'ok' : 'failed';
}

/** A6 "Not spam" / "Delete" on a spam-suspect story (T2.9.04 routes): the status and the refusal code. */
export async function storySpam(
  storyId: string,
  action: 'not-spam' | 'delete',
): Promise<{ status: number; code: string | null }> {
  const { status, data } =
    action === 'not-spam'
      ? await json('POST', `${STORIES}/${storyId}/not-spam`)
      : await json('DELETE', `${STORIES}/${storyId}/spam`);
  const code = (data as { code?: unknown } | null)?.code;
  return { status, code: typeof code === 'string' ? code : null };
}

/** What Export hands the browser: the signed link (staging, production) or the zip itself (the prototype). */
export type ExportDownload = { kind: 'link'; url: string } | { kind: 'file'; blob: Blob; name: string };

const EXPORT_FALLBACK_NAME = 'time-with-jon-stories.zip';

/** The file name in an `attachment; filename="…"` header. */
export function attachmentName(disposition: string | null): string {
  return /filename="([^"]+)"/.exec(disposition ?? '')?.[1] ?? EXPORT_FALLBACK_NAME;
}

/**
 * A6 Export (T3.10.U1): POST /api/admin/export with its defaults (consented stories only, no emails). A JSON
 * { url } answer is the 10-minute signed link; an application/zip answer is the file. null on any refusal (409 =
 * an export is already running) or a network error.
 */
export async function exportStories(): Promise<ExportDownload | null> {
  try {
    const res = await fetch('/api/admin/export', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) return null;
    if (res.headers.get('content-type')?.startsWith('application/zip')) {
      return {
        kind: 'file',
        blob: await res.blob(),
        name: attachmentName(res.headers.get('content-disposition')),
      };
    }
    const url = ((await res.json().catch(() => null)) as { url?: unknown } | null)?.url;
    return typeof url === 'string' && url.startsWith('https://') ? { kind: 'link', url } : null;
  } catch {
    return null;
  }
}
