// src/features/jobs/jobs/offer-expiry.ts — T2.4.09: stand-by offers past their 48 hours are released and their
// requests go back to Needs a reply (§6). No email.
import { expireAllStandbyOffers } from '@/features/requests/standby';
import { registerJob } from '../registry';

registerJob({
  name: 'offer-expiry',
  async run(now, deadline) {
    await expireAllStandbyOffers(now, deadline);
  },
});
