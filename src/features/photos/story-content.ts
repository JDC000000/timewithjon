// src/features/photos/story-content.ts — which stories Jon sees. A story with no words and no photo (a story page
// opened for a photo that never arrived, an After-Send story opened by a sign) is kept out of his lists and counts.

/** SQL condition on a `story` aliased `s`: it has a non-blank body or at least one finalised photo. */
export const STORY_HAS_CONTENT = `(btrim(coalesce(s.body, '')) <> ''
  or exists (select 1 from photo p where p.story_id = s.id))`;
