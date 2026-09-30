// src/lib/invites/release.ts — C2 release times per invite kind.
import type { SettingsRow } from '@/lib/settings';
export function opensAt(
  kind: 'personal' | 'general',
  s: Pick<SettingsRow, 'personal_open_at' | 'general_open_at'>,
): Date {
  return kind === 'personal' ? s.personal_open_at : s.general_open_at;
}
export function isReleased(
  kind: 'personal' | 'general',
  s: Pick<SettingsRow, 'personal_open_at' | 'general_open_at'>,
  now = new Date(),
): boolean {
  return now >= opensAt(kind, s);
}
