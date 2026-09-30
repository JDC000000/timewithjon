// ops/purge-storage.ts — T3.16.05 (R2-L3): after ops/purge-test-data.sql, removes the `photos` bucket's `final/`
// objects and their R2 twins that no `photo` row names any more (older than 1 h). OPERATOR ONLY, by hand; the app
// never runs it. Dry run by default (counts + orphan lists); `--apply` deletes. Every target is bound to --env
// (pr55 F1): the database's settings.env, the SAME Supabase project ref in SUPABASE_URL and DATABASE_URL, and the
// env's registered R2 bucket (src/features/photos/sweep-guard.ts). `--apply` also refuses to delete more than 50
// objects per store, or over 20% of what it listed, unless `--max-delete=N` covers the count.
// AC2's "empty Storage buckets" also needs incoming/ (the tick's purge, within 1 h 15 min) and exports (the 24 h
// export purge): wait for both before signing it off (pr55 F9).
//
//   DATABASE_URL, DATABASE_CA_CERT (as for the app), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BACKUP_BUCKET
//   pnpm -s tsx --conditions=react-server ops/purge-storage.ts --env=staging [--apply [--max-delete=N]]
//
// Verification (TSD T3.16 AC2): photoRows = finalObjects = r2Objects and no orphans; on production on Feb 24, all 0.
import { parseArgs } from 'node:util';
import { parseDbEnv } from '../src/config/env';
import { createR2Backup } from '../src/lib/adapters/r2';
import { createSupabasePhotoStore } from '../src/lib/adapters/supabase-storage';
import { createPool } from '../src/lib/db-config';
import { sweepOrphanPhotos } from '../src/features/photos/sweep';
import { checkSweepTargets } from '../src/features/photos/sweep-guard';

const { values: a } = parseArgs({
  options: {
    env: { type: 'string' },
    apply: { type: 'boolean', default: false },
    'max-delete': { type: 'string' },
  },
});
if (a.env !== 'staging' && a.env !== 'production') throw new Error('--env must be staging or production');
const env = a.env;
const maxDelete = a['max-delete'] === undefined ? undefined : Number(a['max-delete']);
if (maxDelete !== undefined && !(Number.isInteger(maxDelete) && maxDelete >= 0))
  throw new Error('--max-delete must be a whole number');
const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};

const refused = checkSweepTargets({
  env,
  databaseUrl: need('DATABASE_URL'),
  supabaseUrl: need('SUPABASE_URL'),
  r2Bucket: need('R2_BACKUP_BUCKET'),
});
if (refused) throw new Error(refused);

const pool = createPool(parseDbEnv(process.env), { max: 1 });
try {
  const { rows } = await pool.query<{ env: string }>(`select env::text as env from settings`);
  if (rows.length !== 1 || rows[0]!.env !== env)
    throw new Error(`refusing: this database's settings.env is not ${env}`);
  const result = await sweepOrphanPhotos({
    store: createSupabasePhotoStore(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY')),
    backup: createR2Backup({
      accountId: need('R2_ACCOUNT_ID'),
      accessKeyId: need('R2_ACCESS_KEY_ID'),
      secretAccessKey: need('R2_SECRET_ACCESS_KEY'),
      bucket: need('R2_BACKUP_BUCKET'),
    }),
    photoPaths: async () =>
      (await pool.query<{ storage_path: string }>(`select storage_path from photo`)).rows.map(
        (r) => r.storage_path,
      ),
    now: new Date(),
    apply: a.apply,
    maxDelete,
  });
  console.log(JSON.stringify({ env, ...result }, null, 2));
} finally {
  await pool.end();
}
