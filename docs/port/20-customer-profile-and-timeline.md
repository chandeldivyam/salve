# Phase 20 — Timeline (in-conversation + customer profile)

## Goal

After this phase, **every ticket detail page is a customer-anchored timeline**, not a single message thread. Open `/app/inbox/t/:ticketId` and you see:

1. The current conversation, fully expanded — messages, activity events, internal notes, all interleaved chronologically
2. **Above it:** previous conversations from the same customer, collapsed (resolution date, message count, click to expand)
3. **Below it:** newer conversations + customer events that happened after the current ticket was opened
4. **Right rail:** customer profile card (avatar, contact, custom fields, counters, persistent notes)

A second surface, `/app/customers/:id`, renders the same primitive but un-anchored — every conversation collapsed, scroll up/down through the customer's full history.

The two surfaces share one underlying component (`<TimelineFeed>`) and one data model. This is the structural change Phase 20 commits to.

---

## Why this shape

**Linear's bar:**
- One canonical stream per concept. No floating side-panel for "comments" — comments are rows in the main thread, alongside status changes, assignment flips, label updates. Closed state is calm: a quiet "Done" pill, not a banner.
- Eager where it's cheap, lazy where it scales. Issue body + recent comments load on mount; older comments are explicit ("Show older").
- Skeletons at final dimensions. Optimistic mutations, subtle reconciliation.

**Atlas's clever bit** (`/Users/divyamchandel/Documents/atlas/app`):
- The *same* `ConversationTimelineItem` component renders both inside the customer feed (collapsible card) AND on the single-ticket page (always-expanded). The customer timeline is just N copies; the ticket detail is one expanded card. The line between "conversation view" and "timeline view" is intentionally blurred (`jsapp/src/app/customer-timeline/items/conversation/ConversationTimelineItem.tsx:1-565`).
- Single-ticket page (`?fullDetail=1` equivalent → `/ticket/:id`) shows "X tickets, Y events earlier this day" above and below the conversation, without the full feed cost (`CustomerTimelineSingleTicket.tsx:1-83`).
- Activities (status, assignment, priority, tag changes) are particles in the same stream as messages, grouped into `activity-group` blocks when consecutive (`ConversationTimelineItem.tsx:278-325`).
- Right rail (`CustomerTimelineInfoPane`) is composable: customer summary + conversation card + notes + B2B account + integration cards.

**zbugs's loading model** (`/tmp/zero-mono/apps/zbugs`):
- `issueDetail` query loads `INITIAL_COMMENT_LIMIT + 1` (101) comments — the +1 is a sentinel for "older exists" without a count column (`shared/queries.ts:180-215`, `shared/consts.ts:1`).
- "Show Older" button triggers a *separate* full-fetch query, gated by `enabled: displayAllComments` (`src/pages/issue/issue-page.tsx:260-266, 703-710`).
- Virtualizer caches measured comment heights in a 2000-entry LRU (`issue-page.tsx:766`). Estimated default 200px, refined by running average.
- Scroll anchors to the **top visible comment ID**, not pixel offset, so list re-renders don't yank position (`issue-page.tsx:889-955`).
- New comments from other users below the viewport surface as a toast that scroll-jumps + highlights on click (`issue-page.tsx:1010-1090`).
- All queries share `CACHE_NAV` (10s TTL) — uniform, simple.

**Salve today** (`apps/web/src/routes/app/inbox.t.$ticketId.tsx`):
- Two-column: messages on the left, custom-fields rail on the right (320px ≥ xl).
- Message stream is messages-only. **No activity events rendered, even though `auditEvent` exists in the schema** (`packages/zero-schema/src/schema.ts:110-122`).
- No date dividers, no "load earlier" affordance — every message in the ticket loads via `ticketByID`.
- No customer profile route. Customer is a breadcrumb string in the header.
- No `customer_note` table. Internal notes are messages with `isInternal=true`.
- Inbox row links to ticket detail; the customer email is not a separate target.

The gap between today and the destination is wider than Phase 20 originally framed. This document expands the plan accordingly.

---

## The Timeline primitive

One component, two surfaces.

```
<TimelineFeed
  mode="single-ticket"     // anchored: one ticket expanded, neighbors collapsed
  | mode="customer"        // un-anchored: all collapsed, paginate both directions
  customerID
  anchorTicketID?         // present only in single-ticket mode
/>
```

### Item types (the union)

Every row in the feed is a `TimelineItem`:

| Type | Source | Timestamp | Visual shape |
|---|---|---|---|
| `conversation` | `ticket` row | `updatedAt` (placement) / `createdAt` (sort) | Collapsible card with header + (when expanded) message stream + activity stream + composer |
| `customer-note` | `customer_note` (new) attached to `customerID`, no `objectID` | `createdAt`, pinned-to-top | Yellow-quiet card with avatar + body + edit/delete on hover |
| `custom-event` | `custom_event` (new) | `occurredAt` | Single row: icon + event name + 1–3 property chips + ago |
| `day-divider` | derived | midnight boundary | "Mar 12, 2026" pill across the row |

Inside an expanded `conversation` item, a second-tier item type appears, **only ever interleaved with messages**:

| Type | Source | Timestamp | Visual shape |
|---|---|---|---|
| `message` | `message` row | `createdAt` | Bubble (existing `MessageBubble`) |
| `ticket-activity` | `audit_event` (existing, currently unused) | `createdAt` | Single muted row: icon + "Sara assigned to Liam" + ago |
| `ticket-note` | `customer_note` with `objectType='ticket'` and `objectID=ticketID` | `createdAt` | Yellow-quiet card, narrower than the conversation gutter |

This split matters: customer-level items appear only in the customer/single-ticket feed; ticket-level items appear only inside an expanded conversation card.

### Activity events we render

Mapping `audit_event.kind` → presentation. We seed Phase 20 with this list; new kinds added later just need a row in the renderer:

| Kind | Copy | Icon |
|---|---|---|
| `ticket.assigned` | "{actor} assigned to {assignee}" / "{actor} unassigned" | `UserPlus` / `UserMinus` |
| `ticket.status_changed` | "{actor} marked as {status}" — special-case `resolved` → "{actor} resolved this conversation" | `CheckCircle2` (resolved) / `Circle` (reopened) / `Inbox` (open) |
| `ticket.priority_changed` | "{actor} set priority to {priority}" | `Flag` |
| `ticket.tag_added` / `ticket.tag_removed` | "{actor} added {tag}" / "{actor} removed {tag}" | `Tag` |
| `ticket.snoozed` / `ticket.unsnoozed` | "{actor} snoozed until {when}" / "{actor} woke this up" | `BellOff` / `Bell` |
| `ticket.custom_field_changed` | "{actor} set {field} to {value}" | `Sliders` |
| `customer.note_created` | (rendered as `ticket-note` not as activity) | — |

Consecutive activities by the same actor within a 60-second window collapse into one grouped row ("Sara changed status, priority, and assigned to Liam · 2m") to match Atlas's `activity-group` behavior. The grouping is purely presentational — the underlying audit events stay one-per-action.

### Loading model (zbugs-style, two layers)

**Layer 1 — anchor ticket eager, neighbors lazy.** In single-ticket mode the anchor ticket loads with `INITIAL_MESSAGES + 1` (default 50) messages and `INITIAL_ACTIVITIES + 1` activities; "Show earlier in this conversation" requests the full set. Neighbor tickets render as collapsed headers — the `TicketSummaryRow` query is one row per ticket (no messages). Click to expand → fires the same eager-load query for that ticket.

**Layer 2 — neighbor pagination.** Above and below the anchor, render at most 5 neighbors initially (3 newer, the anchor, 2 older — biased toward "newer" to surface follow-ups). "Show earlier" / "Show later" buttons paginate by 10 at a time. Past 30, the whole feed switches to virtualized scrolling on `@tanstack/react-virtual` with the same row-anchored scroll restoration as zbugs (anchor by ticket-id, not pixel).

**No infinite scroll on first load.** Explicit "Show earlier" / "Show later" affordances. Infinite scroll only kicks in after the user has crossed 30+ items in either direction (proxy for "they're actually exploring the history"). This protects against Zero materializing thousands of rows for a customer with a 5-year history.

### Cache & TTL

- `customerByID`, `customerTickets`, `customerNotes`, `customerEvents` → `CACHE_TICKET_DETAIL` (5 min). The customer's cumulative history changes slowly.
- `ticketByID` (anchor) → `CACHE_NAV` (existing, 10s).
- `relatedTickets` (right-rail summary in any conversation, even non-anchored views) → `CACHE_NAV`.
- Activity stream (`auditEvents` for one ticket) → `CACHE_NAV` — must reflect status flips immediately.

Add `CACHE_TICKET_DETAIL = { ttl: '5m' }` to `lib/zero-cache.ts`.

---

## Open vs closed — visual treatment

The Linear principle: closed is *calm*, not loud. We're closer to that today than to a "ticket archived" banner. Specifics for each ticket state, **inside the timeline** (anchor or neighbor):

| Status | Header treatment | Card treatment | Composer | Interaction |
|---|---|---|---|---|
| `open` | Status dot pulses subtle indigo. Updated-ago in `text-fg-tertiary`. | `bg-bg-canvas`, default border. | Visible, focused on `e` shortcut. | Standard. |
| `in_progress` | Solid indigo dot. "In progress" pill at `text-[11px]`. | Same as open. | Visible. | Standard. |
| `snoozed` | Bell-off icon. "Snoozed until {date}" pill, warning-quiet. | `bg-bg-canvas`, faint amber left border (2px). | Visible but says "Reply will wake this up". | Reply auto-unsnoozes. |
| `resolved` | Check icon, success-quiet. "Resolved {ago} by {agent}" pill. | `bg-bg-canvas`, no border tint. | Hidden by default. "Reopen and reply" button below. | Composer rehydrates on click. |
| `closed` | Check icon, muted. "Closed {ago}" pill. | `bg-bg-elevated/40`, slight desaturation on avatars. | Hidden. "Reopen and reply" button. | Same as resolved but visual is calmer still. |

In **single-ticket mode**, the anchor stays expanded regardless of status; status only changes the trim (border/pill/composer). Neighbor cards above/below default-collapse if `closed` or `resolved>14d`; otherwise default-expand. (Atlas defaults all neighbors collapsed; we default-expand recent unresolved ones because most of the time the neighbor is also a follow-up the agent wants to see.)

**Resolve transition (live, on the anchor):** when the user clicks "Resolve" in the active conversation, the composer animates out (180ms ease-out, height collapse) and is replaced with the "Resolved {ago}" pill + "Reopen and reply" button. The card itself does not collapse; you're still reading it. Reopening reverses the animation and restores composer state from IndexedDB draft if present.

**Day dividers** appear between ticket-level boundaries in customer mode (between conversations dated different days) and inside expanded conversations (between messages dated different days). Format: "Mar 12" if same year, "Mar 12, 2024" otherwise. Sticky at the top of their range while scrolling, like Linear's date headers.

---

## Layout

### Single-ticket mode (`/app/inbox/t/:ticketId`)

```
┌─ Workbench tab strip ────────────────────────────────────────────────┐
│ Inbox  ·  #4827 Sara Lin – Refund question                       × … │
├─ TimelineHeader ─────────────────────────────────────────────────────┤
│ Sara Lin · sara@acme.com   [open] [normal] [Liam] [+ tag] [snooze ▾] │
├──────────────────────────────────────────────┬───────────────────────┤
│                                              │ ProfileCard           │
│  ↑ Show earlier (3)                          │  · avatar + name      │
│                                              │  · email · phone      │
│  [conversation #4811 · resolved 14d ago]    │  · custom fields      │
│  [conversation #4823 · resolved 2d ago]     │  · counters           │
│                                              │                       │
│  ─── Today ────────────────────────────────  │ Notes (2 pinned)      │
│                                              │  · "VIP — give …"     │
│  ┌─ #4827 (anchor, expanded) ─────────────┐ │  · view all           │
│  │ subject: Refund question                │ │                       │
│  │ activity: Liam assigned · 12m            │ │ Related events (3)    │
│  │ message (customer): "Hey, my refund…"   │ │  · order_completed   │
│  │ activity: Liam tagged "billing" · 8m    │ │  · login             │
│  │ message (agent): "Hi Sara, looking…"    │ │                       │
│  │ note (ticket-scoped): "Refund issued"   │ │                       │
│  │ ↑ Show earlier in this conversation (8) │ │                       │
│  │ [Composer — focused, sticky]            │ │                       │
│  └─────────────────────────────────────────┘ │                       │
│                                              │                       │
│  ↓ Show later (1)                            │                       │
│                                              │                       │
│  [event: signup_completed · yesterday]      │                       │
│                                              │                       │
└──────────────────────────────────────────────┴───────────────────────┘
```

### Customer mode (`/app/customers/:customerId`)

Same shell, no anchor. Header is the customer name (no ticket meta). Feed is fully collapsed by default — the user expands what interests them. Right rail unchanged.

### Mobile

`<lg`: profile card hides into a "Customer" sheet trigger in the header. Right rail content moves into the sheet, organized as accordions (Profile / Notes / Events). Feed itself stays full-width.

---

## Schema delta

### Lean on what exists

- **`audit_event`** is already in the schema (`packages/zero-schema/src/schema.ts:110-122`). Phase 20 wires it into the timeline; **no schema change required**, but we **do** require the API and mutators that exist today to actually emit `audit_event` rows for status/assign/priority/tag/snooze/custom-field changes. If any mutator doesn't emit one, that's the bug Phase 20 fixes (T-2003a). Today: many do, some don't — confirm during T-2003a audit.
- **`message.isInternal`** already exists. We keep ticket-scoped notes-as-messages for the composer flow (agents type into the same Tiptap, with a Lock toggle) but additionally introduce `customer_note` for *customer-scoped* notes that aren't tied to a single conversation. Atlas distinguishes these too (customer_notes.object_type = 'customer' vs 'ticket'); we mirror that.

### `customer_note.ts` (new)

```ts
export const customerNoteObjectTypeEnum = pgEnum("customer_note_object_type", ["customer", "ticket"]);

export const customerNote = pgTable("customer_note", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceID: uuid("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  objectType: customerNoteObjectTypeEnum("object_type").notNull(),
  objectID: uuid("object_id").notNull(),               // customerID or ticketID
  customerID: uuid("customer_id").notNull().references(() => customer.id, { onDelete: "cascade" }),
  // ^ denormalized so timeline-by-customer is a single index hit even for ticket-scoped notes
  bodyHtml: text("body_html").notNull(),
  bodyText: text("body_text").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  createdByID: uuid("created_by_id").notNull().references(() => user.id),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt, updatedAt,
}, (t) => [
  index("customer_note_customer_idx").on(t.customerID, t.deletedAt, t.createdAt),
  index("customer_note_object_idx").on(t.objectType, t.objectID),
]);
```

### `custom_event.ts` (new)

```ts
export const customEvent = pgTable("custom_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceID: uuid("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  customerID: uuid("customer_id").notNull().references(() => customer.id, { onDelete: "cascade" }),
  eventName: text("event_name").notNull(),
  properties: jsonb("properties").$type<Record<string, unknown>>().notNull().default({}),
  source: text("source").notNull().default("api"),     // api | sdk | webhook | manual
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  idempotencyKey: text("idempotency_key"),             // client-provided dedupe key
}, (t) => [
  index("custom_event_customer_idx").on(t.customerID, t.occurredAt),
  index("custom_event_workspace_idx").on(t.workspaceID, t.occurredAt),
  index("custom_event_name_idx").on(t.workspaceID, t.eventName),
  uniqueIndex("custom_event_idem_idx").on(t.workspaceID, t.idempotencyKey).where(sql`idempotency_key is not null`),
]);
```

### `customer.ts` extensions

```ts
firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
phone: text("phone"),
location: text("location"),
metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
```

`lastSeenAt` updates on every event ingest (debounced server-side to once per minute per customer to avoid replication amplification).

---

## Zero queries

```ts
// Customer header
customerByID: ({ id }) =>
  applyWorkspaceScope(z.query.customer)
    .where("id", "=", id)
    .related("tags", q => q.related("tag", t => t.related("group")))
    .related("customFieldValues", q => q.related("field"))
    .one(),

// Anchor ticket — full thread + activities, capped at 50 each with sentinel
ticketAnchor: ({ id, messageLimit = 51, activityLimit = 51 }) =>
  applyWorkspaceScope(z.query.ticket)
    .where("id", "=", id)
    .related("customer")
    .related("assignee")
    .related("createdBy")
    .related("tags", q => q.related("tag", t => t.related("group")))
    .related("messages", q => q
      .related("attachments")
      .related("authorUser")
      .related("authorCustomer")
      .orderBy("createdAt", "desc")
      .limit(messageLimit))
    .related("auditEvents", q => q
      .related("actor")
      .where("kind", "LIKE", "ticket.%")
      .orderBy("createdAt", "desc")
      .limit(activityLimit))
    .one(),

// Older messages / activities for one ticket — explicit fetch on "Show earlier"
ticketMessagesAll: ({ ticketID }) => …       // no limit
ticketActivitiesAll: ({ ticketID }) => …     // no limit, kind LIKE 'ticket.%'

// Neighbor tickets — header-only summaries, paginated
customerTicketSummaries: ({ customerID, before?, after?, limit = 10 }) =>
  applyWorkspaceScope(z.query.ticket)
    .where("customerID", "=", customerID)
    .related("assignee")
    .where("createdAt", before ? "<" : ">", before ?? after ?? "1970-01-01")
    .orderBy("createdAt", before ? "desc" : "asc")
    .limit(limit + 1),                        // +1 sentinel — has-more without count

// Customer notes — both scopes; ticket-scoped notes filter by ticketID at render time
customerNotes: ({ customerID }) =>
  applyWorkspaceScope(z.query.customerNote)
    .where("customerID", "=", customerID)
    .where("deletedAt", "IS", null)
    .related("createdBy")
    .orderBy("pinned", "desc")
    .orderBy("createdAt", "desc"),

// Customer events
customerEvents: ({ customerID, limit = 50 }) =>
  applyWorkspaceScope(z.query.customEvent)
    .where("customerID", "=", customerID)
    .orderBy("occurredAt", "desc")
    .limit(limit),

// Right-rail "related" — same as before, used in any conversation header
relatedTickets: ({ customerID, excludeTicketID, includeClosed = false, limit = 5 }) => …
```

The +1 sentinel pattern (zbugs) replaces explicit "has more" booleans throughout.

---

## Mutators

`packages/mutators/src/customer-mutators.ts` (new):

- `customer.update({ id, name?, displayName?, phone?, location?, metadata? })`
- `customerNote.create({ id, objectType, objectID, customerID, bodyHtml, bodyText, pinned? })`
- `customerNote.update({ id, bodyHtml, bodyText })` — sets `editedAt`
- `customerNote.delete({ id })` — soft delete
- `customerNote.togglePin({ id })`

All emit audit events (`customer.note_*`).

`custom-event` ingestion stays out of Zero — high-volume append-only writes go through Hono. SDK / webhook / Zapier all hit the same endpoint.

`packages/mutators/src/ticket-mutators.ts` (audit, may be additive):

- Confirm every mutator emits a corresponding `audit_event`. If not, add it. Specifically: `assign`, `unassign`, `setPriority`, `setStatus`, `addTag`, `removeTag`, `snooze`, `unsnooze`, `setCustomField`. Without this, the timeline activity stream is silent on history before Phase 20.

---

## Tickets

Phase 20 grows from 10 tickets to 18.

### T-2001 — Customer schema extensions + Zero mirror

(Unchanged from v1.) Add `firstSeenAt`, `lastSeenAt`, `phone`, `location`, `metadata` to `customer`. Backfill `firstSeenAt = createdAt`. Mirror in Zero. **Deps:** none.

### T-2002 — `customerByID` query + customer profile route shell

Route `apps/web/src/routes/app/customers.$customerId.tsx`. Profile card on the right rail (same component used in single-ticket mode), feed placeholder on the main column. Wire customer-email click in inbox row + conversation header to navigate here. **Deps:** T-2001.

### T-2003 — Customer notes table + mutators

Drizzle migration, Zero mirror, mutators, audit events. **Deps:** T-2002.

### T-2003a — Audit-event coverage audit (NEW)

Walk every ticket mutator and confirm it writes a corresponding `audit_event` row with the kinds enumerated in "Activity events we render" above. Add the missing emissions. Backfill is **not** attempted — the timeline starts being honest from this commit forward; older tickets show their messages but no activity history (acceptable: most users care about current and recent state).

**Acceptance:**
- Status / assign / priority / tag / snooze / custom-field mutators all emit one `audit_event` per change.
- Mutator-level integration test asserts the audit row is written in the same Zero transaction (same actorID, same workspaceID).
- Activity row appears in the timeline within 1s of the mutation.

**Deps:** none (parallelizable with T-2002).

### T-2004 — Custom events table + ingestion endpoint

Hono `POST /api/customers/:customerID/events`. Idempotency via `idempotencyKey` (unique partial index). **Deps:** T-2002.

### T-2005 — `<TimelineFeed>` shell + `<ConversationItem>` collapsible card (NEW SHAPE)

New component `apps/web/src/components/timeline/timeline-feed.tsx`. Modes: `single-ticket` (anchor expanded) and `customer` (all collapsed). Renders `<ConversationItem>` cards that:
- In collapsed state: header row only — shortID, status pill, subject, last-message snippet, "{count} messages · {ago}".
- In expanded state: header + interleaved messages + `<TicketActivityRow>` events + ticket-scoped notes + `<TicketComposer>` (if status admits replies).
- Resolve/reopen animates composer out/in (180ms height collapse).

Reuse the existing `MessageBubble`. The ticket-detail route (`inbox.t.$ticketId.tsx`) is rewritten to render `<TimelineFeed mode="single-ticket" anchorTicketID={ticketId} />`.

**Acceptance:**
- Anchor ticket renders fully expanded, composer focused.
- Two collapsed neighbors render above (older) and one below (newer if exists). Click expands.
- Status flip on the anchor animates composer, replaces with resolution pill.
- `j`/`k` move keyboard focus between items (collapsed and expanded).
- `e` opens composer focus on the anchor; `Esc` blurs.

**Deps:** T-2003, T-2003a, T-2004.

### T-2006 — `<TicketActivityRow>` component (NEW)

Renders one `audit_event` row inside an expanded conversation. Implements the kind→copy/icon table above. Implements the 60-second same-actor grouping. Mounts inside `<ConversationItem>` between messages, sorted by `createdAt`.

**Acceptance:**
- All kinds in the table render correctly with the workspace's actor name resolved.
- Three consecutive activities by the same agent within 60s collapse into one grouped row.
- Unknown kinds render a generic fallback ("Sara updated this conversation") rather than crashing.

**Deps:** T-2003a.

### T-2007 — Lazy-load model: anchor +51 / "Show earlier" full fetch

Wire `ticketAnchor` query (51 messages, 51 activities). Render the +1 sentinel as "Show earlier in this conversation ({n} more)". Click triggers the unbounded `ticketMessagesAll` + `ticketActivitiesAll` queries (gated by `enabled`). Scroll restoration anchored to the top visible message ID — port the `getScrollRestore()` pattern from zbugs (`issue-page.tsx:889-955`).

**Acceptance:**
- Conversation with 200 messages renders 50 + sentinel on first paint within 200ms (real network).
- Clicking "Show earlier" loads the rest with no scroll jump.
- Returning to the ticket within 5 minutes re-uses cache (via `CACHE_TICKET_DETAIL`).

**Deps:** T-2005.

### T-2008 — Neighbor tickets: collapsed cards above/below the anchor

Subscribe to `customerTicketSummaries` for both directions, capped at 3+2 initially. Render collapsed `<ConversationItem>`s. Click expands; expansion fires `ticketAnchor`-equivalent for that ticket (lazy). "Show earlier" / "Show later" buttons paginate by 10. After 30+ items in either direction, switch to virtualized scrolling (port zbugs's row-anchored restoration).

**Acceptance:**
- Customer with 12 prior tickets shows 3 collapsed above, 0 below by default; "Show earlier (9)" reveals the rest in batches of 10.
- Expanding a neighbor doesn't refetch the anchor.
- Virtualization kicks in at item 30; scroll position holds when new items arrive.

**Deps:** T-2007.

### T-2009 — Customer profile right rail

Component `apps/web/src/components/customer/profile-card.tsx`. Sections (top to bottom): avatar + name + email block, copy-email, phone, location, tags pill cluster, custom-fields block (T-1010 widget), counters (open conversations, total, first contact, last contact, last event), pinned notes (collapsed list), recent events (3, "see all" link).

Mounts in:
- Single-ticket mode: right rail of `<TimelineFeed>`.
- Customer mode: right rail.
- Conversation routes that *aren't* timeline-anchored (if any remain): same rail.

Below `lg`, collapses into a header sheet trigger.

**Acceptance:**
- Updates to phone/location/custom-field round-trip optimistically.
- Counters live-update as new events / tickets arrive.
- Mobile sheet works.

**Deps:** T-2002, T-2006.

### T-2010 — Add customer note from anywhere

Two affordances:
- Profile card → "+ Note" button → inline mini-Tiptap → saves as `objectType='customer'`.
- Inside an expanded conversation → composer Lock toggle now offers "Customer note" vs "Ticket note" (radio in the toolbar). Customer note saves as `objectType='customer'`; ticket note as `objectType='ticket'` (alternative to today's `isInternal=true` message).

We keep `message.isInternal=true` working for backward compat — existing internal messages render as ticket-scoped notes in the new timeline, no migration needed.

**Acceptance:**
- Customer note created from a conversation appears in profile within 1s.
- Ticket note created from a conversation appears in that conversation only, never bleeds into other tickets.
- Edit / delete / pin on hover, creator-only.
- Pinned notes float to top of profile rail's notes section.

**Deps:** T-2003, T-2009.

### T-2011 — Day dividers

Sticky `Mar 12` headers between conversations (in customer mode and between neighbors in single-ticket mode) and between messages dated different days inside an expanded conversation.

**Acceptance:**
- Day dividers correct in workspace timezone.
- Sticky behavior verified in scroll test (the divider stays at top until the next day's range scrolls in).

**Deps:** T-2005.

### T-2012 — Closed/resolved visual treatment

Implement the open/closed state table above. Compose `<ConversationItem>`'s status-driven props (border tint, header pill, composer presence). Wire the resolve/reopen animation (Framer Motion or CSS keyframes — match existing patterns in `MessageBubble`).

**Acceptance:**
- Each status renders its trim correctly.
- Resolve animation is smooth at 60fps on a 4-year-old MacBook.
- Reopen restores draft from IndexedDB if the user had one.

**Deps:** T-2005.

### T-2013 — `<TimelineHeader>` for single-ticket mode

Replace the existing conversation header (`inbox.t.$ticketId.tsx:349-486`) with `<TimelineHeader>`. Renders: customer name (clickable → `/customers/:id`), status / priority / assignee dropdowns, tags, snooze / close menu, updated-ago. Same primitives, cleaner extraction so customer-mode header can use a different variant.

**Acceptance:**
- All header dropdowns work as before.
- Customer name navigates to profile.
- No regressions in keyboard shortcuts (`s` snooze, `c` close, etc.).

**Deps:** T-2005.

### T-2014 — Toast for new messages below viewport

Port zbugs's `useShowToastForNewComment` (`issue-page.tsx:1010-1090`). When a new message arrives in the anchor or any expanded neighbor while it's offscreen, show a toast: `"{customer/agent} sent a new message"` with click-to-scroll-and-highlight.

**Acceptance:**
- Toast appears only when the new message is below the viewport AND from another actor.
- Click scrolls to the message and triggers a 1.5s indigo flash.
- No toast spam: at most one toast on screen, replaces previous.

**Deps:** T-2005.

### T-2015 — Customer email click affordances + customers list

- Inbox row: customer email clickable as a separate target (route to `/customers/:id`); row body still navigates to the ticket.
- Conversation header (now `<TimelineHeader>`): customer name clickable.
- Top-level nav: `/app/customers` placeholder list (alphabetical, search-by-email). Minimal — full list page is Phase 50.

**Acceptance:**
- Right-click → "Open in new tab" works (real `<a>` under TanStack Router).
- Existing row click for opening ticket still works.
- Customers index renders 50 most-recently-active customers, search filters live.

**Deps:** T-2002.

### T-2016 — Counters on the profile

Compute from `customerTickets` + `customerEvents`: total open, total all-time, first contact (= `firstSeenAt`), last contact (= `max(latest message createdAt, latest event occurredAt)`), event count last 30 days.

**Acceptance:**
- All five numbers reactive to mutations within 1s.
- Edge cases: customer with no tickets shows zeros, not "—".

**Deps:** T-2009.

### T-2017 — Composer behaviors in timeline context

The composer used to live one-per-route; now it lives once per *expanded* `<ConversationItem>`. Multiple conversations can be expanded at once. Behaviors:

- Only one composer is "active" (focused, sticky-bottom-on-dirty) at a time. Tab/click on another expanded conversation moves activity.
- Drafts in IndexedDB are keyed by `(workspaceID, ticketID)` already — works as-is.
- Send in any composer optimistically appends to the right conversation; the toast for new messages (T-2014) does not fire for messages the user just sent.

**Acceptance:**
- Two neighbors expanded simultaneously, typing in one does not clear the other's draft.
- Sticky-on-dirty: the active composer pins to viewport bottom while typing, releases on send.
- Esc unsticks.

**Deps:** T-2005, T-2007.

### T-2018 — Telemetry + perf budget

Add timing marks on the single-ticket route:
- `timeline.anchor.ttfb` (query open → first row resolved)
- `timeline.anchor.painted` (route mount → MessageBubble first frame)
- `timeline.neighbors.painted`

Surface in dev only. Budget: anchor painted ≤ 250ms p75 on Linear-grade hardware with primed cache, ≤ 600ms cold. Fail CI if median exceeds 1.5× budget on the seeded test customer.

**Acceptance:**
- Marks visible in dev console.
- CI script `pnpm perf:timeline` runs against seeded fixtures and asserts the budget.

**Deps:** T-2007, T-2008.

---

## Out of scope (call-outs)

- **Session recordings** — they get their own item type later (`session-cluster`), gated on the recording widget shipping. Schema reservation only.
- **Chatbot interactions, Sentry issues, Linear issues** — Atlas has dedicated item types; we'll fold them in when the integrations land.
- **Customer merge** — schema-only stub on `customer.update`. Real merge UX is a separate phase.
- **Cross-channel messaging in the timeline** — when chat / Slack channels arrive, their messages slot into the same conversation stream. The `<TimelineFeed>` data shape already accommodates this; the channel-icon adornment in `<ConversationItem>` is the only adapter.
- **Customer-level audit log** ("Sara was assigned VIP status by …") — out of scope; would require a polymorphic audit_event subject. Revisit if real demand.

## Definition of done for Phase 20

- All 18 tickets shipped.
- `/app/inbox/t/:ticketId` renders the timeline shape: above / anchor / below + profile rail.
- `/app/customers/:id` renders the customer-mode timeline.
- Activity events appear in every expanded conversation; status flips/assigns/etc. emit them going forward.
- Notes round-trip in both scopes (customer, ticket).
- Custom events ingest via Hono.
- Two-window propagation tested for: new message, status flip, neighbor expansion, customer note creation.
- Anchor-painted budget: ≤ 250ms primed, ≤ 600ms cold on the seeded fixture.
- Audit events logged for note ops and confirmed for all ticket mutators.
- Migration applied; replication caught up; no ticket regression in existing inbox flows.
