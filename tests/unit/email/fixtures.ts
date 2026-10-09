// T3.2.U2: one realistic var set per template (the shapes the senders build), shared by the HTML tests. The guest
// emails' times read as the site writes them, with "Vancouver time" (QA C, EML-01: "Thu Oct 1 · noon–2 pm Vancouver
// time"); Jon's E12 has the bare time (T3.2 M7); E2 has no time. The digest's lines start "- " as its senders write them.
import { E4C_LEAD, E5B_PARTS, fill, type TemplateId } from '@/content/emails';

export const SITE = 'https://timewithjon.com';
const TOKEN_URL = (kind: string) => `${SITE}/r/${kind}/tok_3f9a2b7c`;
const REQ = `${SITE}/admin/requests/0f6c1f4e-1111-4222-8333-444455556666`;

export const VARS: Record<TemplateId, Record<string, string | number>> = {
  E1: {
    dish: 'The Long Lunch',
    times: 'Thu Oct 1 · noon–2 pm Vancouver time\nSat Oct 3 · 7 pm Vancouver time',
  },
  E2: { name: 'Sam', dish: 'The Long Lunch', summary: 'Crew 2. 2 times.', adminLink: REQ },
  E3: { name: 'Sam', dish: 'The Long Lunch', adminLink: REQ },
  E4: {
    dish: 'The Long Lunch',
    day: 'Thu Oct 1',
    when: 'Thu Oct 1 · noon–2 pm Vancouver time',
    manageLink: TOKEN_URL('manage'),
  },
  E4c: {
    dish: 'The Long Lunch',
    lead: fill(E4C_LEAD.REQUEST, { dish: 'The Long Lunch', when: 'Thu Oct 1 · noon–2 pm Vancouver time' }),
  },
  E5: {
    dish: 'The Long Lunch',
    lead: 'That one went. ',
    times: 'Fri Oct 2 · noon–2 pm Vancouver time\nSun Oct 4 · 11 am–1 pm Vancouver time',
    takeLink: TOKEN_URL('take'),
  },
  E5b: {
    dish: 'The Long Lunch',
    openTimes: E5B_PARTS.withTimes(
      'Fri Oct 2 · noon–2 pm Vancouver time\nSun Oct 4 · 11 am–1 pm Vancouver time',
    ),
    takeLink: TOKEN_URL('take'),
  },
  E5j: { dish: 'The Long Lunch' },
  E6: { week: 'Oct 5' },
  E7: { weekday: 'Friday', when: 'Fri Oct 2 · noon–2 pm Vancouver time', takeLink: TOKEN_URL('take') },
  E8: { length: 'three nights', manageLink: TOKEN_URL('manage') },
  E9: { menuLink: TOKEN_URL('menu') },
  E10: { pickLink: TOKEN_URL('pick') },
  E11: {},
  E12: {
    name: 'Sam',
    dish: 'The Long Lunch',
    when: 'Thu Oct 1 · noon–2 pm',
    standby: 'Alex, Kim',
    adminLink: REQ,
  },
  E13: {
    count: 2,
    lines: '- Sam, The Long Lunch: A night on the ridge\n- Kim: The lunch that ran long',
    adminLink: `${SITE}/admin/stories`,
  },
  E14: { adminLink: `${SITE}/admin/settings` },
  E16: { name: 'Sam', dish: 'The Long Lunch', adminLink: REQ },
  E17: {},
};
export const LINKS = (id: TemplateId) =>
  Object.entries(VARS[id])
    .filter(([k]) => /Link$/.test(k))
    .map(([, v]) => String(v));
export const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
