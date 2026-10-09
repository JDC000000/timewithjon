// src/features/email/templates/E5b.tsx — T3.2.U2: E5b "Another time" after Jon's cancel (guest). {openTimes} is
// E5B_PARTS.withTimes(times) or E5B_PARTS.noTimes (T2.5.02); with times, the same parts are drawn with the times
// as a list (one item each, as E5). An empty {takeLink} (no offer) draws no link.
import { EMAIL_COPY, E5B_PARTS, GUEST_BUTTON } from '@/content/emails';
import { Mail } from './Mail';

const CUT = '\u0000';
/** The frame around the times: plural for several, singular for one (Q6). */
const FRAMES = [`${CUT}\n${CUT}`, CUT].map((t) => {
  const s = E5B_PARTS.withTimes(t);
  return [s.slice(0, s.indexOf(CUT)), s.slice(s.lastIndexOf(CUT) + 1)] as const;
});

export function E5b({ vars }: { vars: Record<string, string | number> }) {
  const open = String(vars.openTimes ?? '');
  for (const [pre, post] of FRAMES) {
    if (open.length > pre.length + post.length && open.startsWith(pre) && open.endsWith(post)) {
      const times = open.slice(pre.length, open.length - post.length);
      const copy = EMAIL_COPY.E5b.body.replace('{openTimes}', `${pre}{times}${post}`);
      return (
        <Mail id="E5b" vars={{ ...vars, times }} copy={copy} lists={['times']} button={GUEST_BUTTON.E5b} />
      );
    }
  }
  return <Mail id="E5b" vars={vars} button={GUEST_BUTTON.E5b} />;
}
