// Every place the test suites start the prototype server (E2E, Lighthouse, route tests) passes a keep-alive well past
// Node's 5 s agent idle timeout. Started with -H 127.0.0.1, the server's ?for= rewrite is proxied back to itself
// over HTTP (Next sees "localhost" as another origin); with the default 5 s keep-alive on both ends the two timers
// race and a reused socket is reset ("Failed to proxy … read ECONNRESET": the T2.6 AC3 privacy E2E red on main
// 2b81516). playwright.config.ts explains it in full.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
/** Node's http agent keeps an idle socket 5 s (http.globalAgent, keepAlive since Node 19). */
const AGENT_IDLE_MS = 5_000;

describe('test servers keep sockets longer than the proxy agent', () => {
  it.each([
    ['tests/lighthouse/run.sh', /pnpm start -H 127\.0\.0\.1 -p "\$PORT" --keepAliveTimeout (\d+)/],
    ['scripts/test-route.sh', /pnpm start -H 127\.0\.0\.1 -p "\$PORT" --keepAliveTimeout (\d+)/],
  ])('%s starts the server with --keepAliveTimeout over 5 s', (file, re) => {
    const m = re.exec(read(file));
    expect(m, `${file}: pnpm start … --keepAliveTimeout`).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(2 * AGENT_IDLE_MS);
  });

  it('playwright.config.ts starts the E2E server with it', () => {
    const config = read('playwright.config.ts');
    expect(config).toContain(
      '`pnpm start -H 127.0.0.1 -p ${port} --keepAliveTimeout ${TEST_SERVER_KEEP_ALIVE_MS}`',
    );
    const ms = /const TEST_SERVER_KEEP_ALIVE_MS = ([\d_]+);/.exec(config);
    expect(Number(ms![1]!.replaceAll('_', ''))).toBeGreaterThan(2 * AGENT_IDLE_MS);
  });

  it('no other test server start is left without it', () => {
    const starts = ['playwright.config.ts', 'tests/lighthouse/run.sh', 'scripts/test-route.sh']
      .flatMap((f) =>
        read(f)
          .split('\n')
          .map((line) => [f, line] as const),
      )
      .filter(([, line]) => /pnpm start -H 127\.0\.0\.1/.test(line) && !line.trimStart().startsWith('#'));
    expect(starts.length).toBe(3);
    expect(starts.filter(([, line]) => !line.includes('--keepAliveTimeout'))).toEqual([]);
  });
});
