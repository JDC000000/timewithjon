// src/lib/adapters/mock/delivery-status.ts — Resend's test addresses, answered locally (T3.13.03).
import type { DeliveryStatusSource } from '../resend/status';

export const mockDeliveryStatus: DeliveryStatusSource = {
  async status(_providerId, to) {
    const local = to.toLowerCase().split('@')[0] ?? '';
    if (local.startsWith('bounced')) return 'bounced';
    if (local.startsWith('complained')) return 'complained';
    return 'delivered';
  },
};
