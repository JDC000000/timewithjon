// T4.2.01a H1 + M1: with the SHIPPED options, what leaves the SDK has no secret, email, IP or cookie, and no span.
import * as Sentry from '@sentry/nextjs';
import { expect, it } from 'vitest';
import { CANARIES, initCapturing, sendTraffic } from '../fixtures/sentry-envelope';

it('errors go out scrubbed (envelope headers included); no span is sent, even for an inbound sampled trace (N1)', async () => {
  const envelopes = initCapturing();
  await sendTraffic();
  const all = envelopes.join('\n');
  expect(all).toContain('"type":"event"'); // the errors really were sent, so the check isn't vacuous
  expect(all).not.toContain('"type":"span"');
  for (const canary of CANARIES) expect(all).not.toContain(canary);
  expect(all).toContain('"environment":"prototype"'); // T0.1.16: the mode, not NODE_ENV
});

it('N2: the beforeEnvelope hook on the real client keeps only known DSC keys and scrubs an inherited transaction', () => {
  // A frozen DSC from inbound baggage can skip createDsc on the Next server path (seen live by the reviewer).
  const envelope: [Record<string, unknown>, unknown[]] = [
    {
      trace: {
        trace_id: 't',
        public_key: 'public',
        transaction: 'GET /?for=bag-k7q2m9xp',
        evil: 'bag-k7q2m9xp',
      },
    },
    [],
  ];
  Sentry.getClient()!.emit('beforeEnvelope', envelope as never);
  expect(envelope[0].trace).toEqual({ trace_id: 't', public_key: 'public', transaction: 'GET /' });
});
