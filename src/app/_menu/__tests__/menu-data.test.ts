// src/app/_menu/__tests__/menu-data.test.ts — /menu applies release times for a valid invite (PR #92 review F2, M7).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERRORS, FLOW } from '@/content';
import type { InviteSession } from '@/features/invites/session';
import { loadMenuGate } from '../menu-data';

const { getInviteSession, loadSettings } = vi.hoisted(() => ({
  getInviteSession: vi.fn(),
  loadSettings: vi.fn(),
}));
vi.mock('@/features/invites/session', () => ({ getInviteSession }));
vi.mock('@/lib/settings', () => ({ loadSettings }));

const NOW = new Date('2026-06-01T12:00:00Z');
const OPENS = new Date('2026-06-15T12:00:00Z');
const valid = { state: 'valid', invite: { kind: 'personal' } } as unknown as InviteSession;

describe('loadMenuGate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a valid invite before its release time gets the "opens on" note, not Book', async () => {
    getInviteSession.mockResolvedValue(valid);
    loadSettings.mockResolvedValue({ personal_open_at: OPENS, general_open_at: OPENS });
    await expect(loadMenuGate(NOW)).resolves.toEqual({ kind: 'note', text: FLOW.opensOn('June 15') });
    expect(loadSettings).toHaveBeenCalledOnce();
  });

  it('a valid invite after its release time gets Book', async () => {
    getInviteSession.mockResolvedValue(valid);
    loadSettings.mockResolvedValue({ personal_open_at: NOW, general_open_at: NOW });
    await expect(loadMenuGate(NOW)).resolves.toEqual({ kind: 'book' });
  });

  it('a stale session gets the stale line and never loads the settings', async () => {
    getInviteSession.mockResolvedValue({ state: 'stale' });
    await expect(loadMenuGate(NOW)).resolves.toEqual({ kind: 'note', text: ERRORS.stale });
    expect(loadSettings).not.toHaveBeenCalled();
  });
});
