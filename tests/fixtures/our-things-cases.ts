// One case table for the "our things" rule, run against Zod (unit) AND our_things_ok() (integration),
// so the two layers can't drift (review T4.2.00 H2).
export const PHRASE_CASES: { label: string; phrase: string; ok: boolean }[] = [
  { label: '3 words', phrase: 'the Seymour lap', ok: true },
  { label: '4 words', phrase: 'a b c d', ok: true },
  { label: '5 words', phrase: 'that lunch at Earls again', ok: false },
  { label: '40 chars', phrase: 'x'.repeat(40), ok: true },
  { label: '41 chars', phrase: 'x'.repeat(41), ok: false },
  { label: '40 emoji (code points, not UTF-16 units)', phrase: '🎣'.repeat(40), ok: true },
  { label: '41 emoji', phrase: '🎣'.repeat(41), ok: false },
  { label: 'empty', phrase: '', ok: false },
  { label: 'comma', phrase: 'beers, then tacos', ok: false },
  { label: 'inner tab', phrase: 'tab\there', ok: false },
  { label: 'leading tab', phrase: '\tpad', ok: false },
  { label: 'newline', phrase: 'line\nbreak', ok: false },
  { label: 'carriage return', phrase: 'cr\rhere', ok: false },
  { label: 'NBSP-joined 5 words', phrase: 'a\u00A0b\u00A0c\u00A0d\u00A0e', ok: false },
  { label: 'leading space', phrase: ' lead', ok: false },
  { label: 'trailing space', phrase: 'trail ', ok: false },
  { label: 'double space, 2 words', phrase: 'Tofino  again', ok: true },
];

export const ARRAY_CASES: { label: string; things: string[]; ok: boolean }[] = [
  { label: 'blank {}', things: [], ok: true },
  { label: '3 phrases', things: ['a', 'b', 'c'], ok: true },
  { label: '4 phrases', things: ['a', 'b', 'c', 'd'], ok: false },
];
