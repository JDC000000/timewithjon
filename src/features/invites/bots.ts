// src/lib/security/bots.ts — AD-11: link-preview bots never count as opens.
const PREVIEW_BOTS =
  /(facebookexternalhit|facebot|twitterbot|slackbot|slack-imgproxy|whatsapp|telegrambot|discordbot|linkedinbot|skypeuripreview|applebot|iMessage|com\.apple\.messages|googlebot|bingbot|embedly|outlook|microsoftpreview|preview)/i;
export function isPreviewBot(userAgent: string | null | undefined, method = 'GET'): boolean {
  if (method.toUpperCase() === 'HEAD') return true;
  if (!userAgent) return true;
  return PREVIEW_BOTS.test(userAgent);
}
