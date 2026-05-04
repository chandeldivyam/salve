// Shared limits for list and timeline queries. Mirrors zbugs `shared/consts.ts`.
//
// Pagination convention: most paginated list queries use the `limit + 1`
// sentinel pattern. UI passes `limit + 1` to the server, slices the first
// `limit` for display, uses the trailing row as the "has more" signal. See
// `apps/web/src/lib/paginate.ts`.
//
// Exception: `inboxOpen` uses an absolute *growing window* (no sentinel)
// because the inbox preloads a large window for instant cold-start render.
// See `apps/web/src/components/inbox-list.tsx` for the growth logic.

// ---------- Generic list pagination ----------

/** Default page size for paginated list views (customers, etc.). */
export const PAGE = 50 as const;

/** Display ceiling for paginated lists. The query schema accepts up to
 *  `MAX_LIST_LIMIT + 1` so the `+ 1` sentinel never exceeds the cap. */
export const MAX_LIST_LIMIT = 1000 as const;

/** Query-side ceiling = display + 1 sentinel. */
export const MAX_LIST_LIMIT_QUERY = (MAX_LIST_LIMIT + 1) as 1001;

// ---------- Inbox (absolute window, no sentinel) ----------

/** Inbox initial page. Small enough to render quickly on a cold IDB. */
export const INBOX_INITIAL_PAGE = 200 as const;
/** Inbox page growth on scroll-load-more. */
export const INBOX_PAGE_GROWTH = 200 as const;
/** Hard ceiling for inbox preload window. */
export const MAX_INBOX_LIMIT = 2000 as const;

// ---------- Single-ticket timeline ----------

/** Initial visible message count in a single ticket timeline. */
export const INITIAL_TICKET_MESSAGE_LIMIT = 50 as const;
/** Anchor query window — initial + 1 sentinel for "Show earlier" detection. */
export const TICKET_ANCHOR_LIMIT = (INITIAL_TICKET_MESSAGE_LIMIT + 1) as 51;
/** Cap when "Show earlier" is expanded — large enough to cover any thread. */
export const ALL_TICKET_MESSAGE_LIMIT = 2000 as const;

// ---------- Settings / catalogue list caps ----------
//
// Tag and custom-field catalogues live for the whole workspace lifetime as
// open Zero subscriptions; an unbounded query syncs the entire catalogue on
// first paint and keeps growing. Cap at the same display ceiling as other
// lists so a workspace with thousands of tags never silently OOMs the
// client.

/** Hard cap for tag/custom-field catalogue subscriptions. */
export const SETTINGS_CATALOGUE_LIMIT = MAX_LIST_LIMIT;

// ---------- Customer-scoped queries ----------

/** Tickets shown per customer in the customer-scoped timeline. */
export const CUSTOMER_TICKET_LIMIT = 200 as const;
/** Customer-scope notes loaded for a customer profile / timeline. */
export const CUSTOMER_NOTE_LIMIT = 200 as const;
/** Custom events loaded for a customer timeline. */
export const CUSTOMER_EVENT_LIMIT = 100 as const;

// ---------- Custom views (Phase 40) ----------

/** Cap on visible saved views per agent (workspace + personal combined). */
export const VIEW_LIST_LIMIT = 200 as const;

/** Cap on per-agent view membership rows synced (mirrors VIEW_LIST_LIMIT). */
export const VIEW_MEMBER_LIST_LIMIT = 400 as const;

// ---------- Server-side query defaults ----------
// Used by `defineQuery` implementations when args.limit is omitted. Smaller
// than the user-driven defaults above because these are the server-side
// "no preference" defaults.

export const DEFAULT_CUSTOMER_EVENT_LIMIT = 50 as const;
export const DEFAULT_RELATED_TICKET_LIMIT = 5 as const;
export const DEFAULT_CUSTOMER_LIST_LIMIT = PAGE;
/** Server default for `customerTicketSummaries` when args.limit is omitted. */
export const DEFAULT_CUSTOMER_TICKET_SUMMARY_LIMIT = 10 as const;
