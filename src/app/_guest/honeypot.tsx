// src/app/_guest/honeypot.tsx — the AD-9 honeypot field shared by the booking and story forms. For bots only (QA L2):
// off-screen and visibility: hidden (.hp: no person sees, reads or copies "Leave this empty"), aria-hidden, out of
// the tab order and never autofilled. A bot that fills it still posts it, and the request is kept as spam.
import { STORY_FORM } from '@/content/ui/guest-after';

export function HoneypotField(p: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="hp" aria-hidden="true">
      <label htmlFor={p.id}>{STORY_FORM.honeypot}</label>
      <input
        id={p.id}
        name="website"
        tabIndex={-1}
        autoComplete="off"
        value={p.value}
        onChange={(e) => p.onChange(e.currentTarget.value)}
      />
    </div>
  );
}
