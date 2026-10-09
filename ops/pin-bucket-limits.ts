// ops/pin-bucket-limits.ts — sets each Storage bucket's size limit, MIME list and privacy to ops/bucket-limits.ts on a
// hosted project (staging or production), then reads them back. Operator only; the app never runs it.
// Dry run (prints what would change):
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… (from your secret store) pnpm -s tsx ops/pin-bucket-limits.ts
// Apply, then check: the same with --apply. Exit code 1 if any bucket still differs.
import { createClient } from '@supabase/supabase-js';
import { BUCKET_LIMITS, type BucketLimits } from './bucket-limits';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const apply = process.argv.includes('--apply');
const storage = createClient(url, key, { auth: { persistSession: false } }).storage;

interface Current {
  public: boolean;
  file_size_limit?: number | null;
  allowed_mime_types?: string[] | null;
}

function differences(have: Current, want: BucketLimits): string[] {
  const out: string[] = [];
  if (have.public !== want.public) out.push(`public ${have.public} -> ${want.public}`);
  if ((have.file_size_limit ?? null) !== want.fileSizeLimit)
    out.push(`file_size_limit ${have.file_size_limit} -> ${want.fileSizeLimit}`);
  const haveTypes = [...(have.allowed_mime_types ?? [])].sort().join(',');
  const wantTypes = [...want.allowedMimeTypes].sort().join(',');
  if (haveTypes !== wantTypes) out.push(`allowed_mime_types [${haveTypes}] -> [${wantTypes}]`);
  return out;
}

async function read(name: string): Promise<Current> {
  const { data, error } = await storage.getBucket(name);
  if (error || !data) throw new Error(`could not read bucket ${name}: ${error?.name ?? 'missing'}`);
  return data;
}

let differing = 0;
for (const [name, want] of Object.entries(BUCKET_LIMITS)) {
  const before = differences(await read(name), want);
  if (before.length === 0) {
    console.log(`OK    ${name}: already pinned`);
    continue;
  }
  if (!apply) {
    differing++;
    console.log(`DIFF  ${name}: ${before.join('; ')} (dry run: add --apply)`);
    continue;
  }
  const { error } = await storage.updateBucket(name, {
    public: want.public,
    fileSizeLimit: want.fileSizeLimit,
    allowedMimeTypes: [...want.allowedMimeTypes],
  });
  if (error) throw new Error(`could not update bucket ${name}: ${error.name}`);
  const after = differences(await read(name), want);
  if (after.length) differing++;
  console.log(
    `${after.length ? 'FAIL' : 'SET '}  ${name}: ${after.length ? after.join('; ') : before.join('; ')}`,
  );
}
process.exitCode = differing ? 1 : 0;
