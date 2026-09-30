// T4.2.01a H1 (defence in depth): even if someone turns tracing on, spans leave with no secret, email, IP or cookie.
import { expect, it } from 'vitest';
import { CANARIES, initCapturing, sendTraffic } from '../fixtures/sentry-envelope';

it('with tracing forced on, beforeSendSpan + the DSC scrubber strip every canary from spans and headers', async () => {
  const envelopes = initCapturing({ tracesSampler: () => 1 });
  await sendTraffic();
  const all = envelopes.join('\n');
  expect(all).toMatch(/"type":"span"/); // spans really were serialised
  expect(all).toContain('Mozilla/5.0'); // an allowlisted header survives
  for (const canary of CANARIES) expect(all).not.toContain(canary);
});
