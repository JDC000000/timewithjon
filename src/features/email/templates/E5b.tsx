// src/features/email/templates/E5b.tsx — T3.2.U2: E5b "Another time" after Jon's cancel (guest). {openTimes} is
// E5B_PARTS.withTimes(times) or E5B_PARTS.noTimes (T2.5.02); with times, the same parts are drawn with the times
// as a list (one item each, as E5). An empty {takeLink} (no offer) draws no link.
import { EMAIL_COPY, E5B_PARTS, GUEST_BUTTON } from '@/content/emails';
import { Mail } from './Mail';

const CUT = '\u0000';
const [PRE, POST] = E5B_PARTS.withTimes(CUT).split(CUT) as [string, string];

export function E5b({ vars }: { vars: Record<string, string | number> }) {
  const open = String(vars.openTimes ?? '');
  if (open.length > PRE.length + POST.length && open.startsWith(PRE) && open.endsWith(POST)) {
    const times = open.slice(PRE.length, open.length - POST.length);
    const copy = EMAIL_COPY.E5b.body.replace('{openTimes}', `${PRE}{times}${POST}`);
    return (
      <Mail id="E5b" vars={{ ...vars, times }} copy={copy} lists={['times']} button={GUEST_BUTTON.E5b} />
    );
  }
  return <Mail id="E5b" vars={vars} button={GUEST_BUTTON.E5b} />;
}
