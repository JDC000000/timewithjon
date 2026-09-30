// src/features/email/headers.ts — header hygiene shared by every mailer path. Pure.
/** Any line break (CR, LF, NEL, U+2028, U+2029) becomes one space: a header value is always one line. */
export function flattenHeader(value: string): string {
  return value.replace(/[\r\n\u0085\u2028\u2029]+/g, ' ');
}
