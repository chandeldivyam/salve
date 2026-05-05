// UI-side constants for list views. Data-side limits live in
// `@salve/zero-schema` (see `consts.ts`).

/** Inbox row height in pixels — used by the virtualizer's `estimateSize`. */
export const INBOX_ROW_HEIGHT = 36;

/** Trigger inbox `pageLimit` growth when scrolled within N rows of the bottom. */
export const LOAD_MORE_THRESHOLD = 16;

/** Timeline neighbour fold counts (older / newer tickets shown around the anchor). */
export const TIMELINE_OLDER_VISIBLE = 2;
export const TIMELINE_NEWER_VISIBLE = 3;
