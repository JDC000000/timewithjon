// scripts/create-invite.ts — T1.11 / T5.1: create invites from the CLI. Prints links; secrets never touch git.
// Usage: DATABASE_URL=... DATABASE_CA_CERT="$(cat supabase-ca.pem)" SITE=https://timewithjon-proto.vercel.app pnpm tsx scripts/create-invite.ts --name "Sam" --slug sam [--dish the-long-lunch] [--email sam@x.com] [--thing "the Seymour lap" --thing "Tofino again"] [--test]
import { parseArgs } from 'node:util';
import { parseDbEnv } from '../src/config/env';
import { OurThings } from '../src/features/invites/our-things';
import { createPool } from '../src/lib/db-config';
import { generateInviteSecret } from '../src/features/invites/tokens';

const { values: a } = parseArgs({
  options: {
    name: { type: 'string' },
    slug: { type: 'string' },
    dish: { type: 'string' },
    email: { type: 'string' },
    thing: { type: 'string', multiple: true },
    test: { type: 'boolean', default: false },
  },
});
if (!a.slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.slug))
  throw new Error('--slug must be lowercase letters/digits/hyphens');
const ourThings = OurThings.parse(a.thing ?? []); // 1-3 phrases, 4 words max each (TSD v1.8); throws otherwise
// Same TLS rules as the app (V2): DATABASE_SSL + DATABASE_CA_CERT, verify-full by default.
const pool = createPool(parseDbEnv(process.env), { max: 1 });
const secret = generateInviteSecret();
await pool.query(
  `insert into invite (kind, token_secret, name_slug, display_name, our_things, picked_dish, prefill_name, prefill_email, hoped_for, is_test)
   values ('personal', $1, $2, $3, $4, $5, $3, $6, true, $7)`,
  [secret, a.slug, a.name ?? null, ourThings, a.dish ?? null, a.email ?? null, a.test],
);
await pool.end();
console.log(`${process.env.SITE ?? ''}/?for=${a.slug}-${secret}`);
