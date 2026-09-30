// src/content/ui/tag.ts — lane U2 copy for S12b, the printable wine tag (/tag), that isn't in src/content yet. Every
// line is word for word from the signed v2.2 pack (G1, Jon decisions 46-47), s12b-wine-tag-design-{mobile,desktop}.
// The words on the tag itself are WINE_TAG (src/content/site.ts), the one source.
import { WINE_TAG } from '../site';

export const TAG_UI = {
  back: 'Sent', // PACK v2.2 s12b (the header back link "‹ Sent" -> S11, changelog 45/47a)
  title: 'The tag', // PACK v2.2 s12b
  intro: 'Four to a page. Cut on the dashed lines, punch the hole, tie it on.', // PACK v2.2 s12b
  print: 'Print', // PACK v2.2 s12b
  printAlt: 'Or save it as a PDF from the print window.', // PACK v2.2 s12b
  sheetLabel: 'A Letter page with four tags, front side, and dashed cut lines', // PACK v2.2 s12b (the sheet's alt)
  // PACK v2.2 s12b: the sheet's text description, built from the tag's own words so the two never drift
  words: `Each tag reads “${WINE_TAG.forJon}”, then “${WINE_TAG.openOn}” and “${WINE_TAG.from}”, each with a line to write on, then “${WINE_TAG.noDate}”`,
} as const;
