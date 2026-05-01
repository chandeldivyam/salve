# Phase 20 — Customer Profile + Timeline

## Goal

After this phase: clicking a customer's name (anywhere they appear) opens `/customers/:id` showing their full timeline — every conversation, every persistent note an agent has left, and every product event we've ingested — all interleaved chronologically. Conversation sidebar gains a "Related conversations" block.

## Why second

Customer context is the most-cited gap in Atlas-vs-opendesk reviews. The timeline is also the spec for the eventual SDK ingestion (`custom_events`), so doing it now sets the data model that the widget and SDK will write into.

## Atlas behavior

### Profile route

- Path: `/customer-timeline/{customerId}`.
- Frontend root: `jsapp/src/app/customer-timeline/CustomerTimelineRoot.tsx`.
- Sections: `jsapp/src/app/customer-timeline/sections/`.
- Item types: `jsapp/src/app/customer-timeline/items/`.
- Data layer: `jsapp/src/app/customer-timeline/data-management/`.
- Backing store: `jsapp/src/stores/ticketing/controllers/TimelineCollection.tsx` (paginated, item-typed).

### Profile card

- **Avatar** — photo or initials.
- **Name** — full name fallback to email.
- **Contact** — primary email (clickable copy), phone numbers (primary + alternates), location.
- **Account** — name + logo (B2B, deferred).
- **Status badges** — Verified, Visitor, VIP.
- **Custom fields** — every active customer-category field (Tier, Industry, Region).
- **Metadata** — created date, last login, total conversations, completed sessions, time spent.
- **Default senders** — which email addresses have ever been used.
- **Alternate identities** — Slack, Discord, etc.
- File: `jsapp/src/models/customer.ts:115-300+`.

### Timeline interleaving

- **Conversations** — every ticket the customer has, with most-recent message preview.
- **Activity** — assignment changes, status changes, tag changes (sourced from `webapp/web/conversation_activities`).
- **Custom events** — product/SDK events. Backend module: `webapp/web/custom_events/`.
- **Customer notes** — persistent agent-authored notes. Backend: `webapp/web/customer_notes/`. Frontend: shown distinct from internal-message notes (different entity).
- **Session recordings** — embedded player. **Out of scope** (recording widget arrives separately).

### Customer notes (Atlas)

- Polymorphic: `customer_notes.object_type` + `object_id` lets a note attach to a customer or a ticket. We'll keep the polymorphism.
- Columns: `id`, `company_id`, `object_type`, `object_id`, `text`, `created_by`, timestamps.
- CRUD via `webapp/web/customer_notes/apis.py`.
- Render: rich text, edit / delete (creator only), pinned-to-top option.

### Custom events (Atlas)

- Schema: `webapp/web/custom_events/models.py`.
- Sources: SDK ingestion, server-side webhooks, Zapier.
- Each event: `id`, `company_id`, `customer_id`, `event_name`, `properties` (JSONB), `occurred_at`.
- Display: icon + event name + key properties + timestamp.

### Related conversations widget (in conversation sidebar)

- Atlas component lives in the customer card on the conversation right rail.
- Lists open + recent-closed tickets for the same customer with status pills.
- Click → switches the inbox detail pane to that ticket (same workspace).

## Schema delta

### `customer_note.ts` (new)

```ts
export const customerNoteObjectTypeEnum = pgEnum("customer_note_object_type", ["customer", "ticket"]);

export const customerNote = pgTable("customer_note", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceID: uuid("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  objectType: customerNoteObjectTypeEnum("object_type").notNull(),
  objectID: uuid("object_id").notNull(),
  customerID: uuid("customer_id").notNull().references(() => customer.id, { onDelete: "cascade" }),
  // ^^ denormalized: even when attached to a ticket, the customer on that ticket is the timeline target
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
  source: text("source").notNull().default("api"), // api | sdk | webhook | manual
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("custom_event_customer_idx").on(t.customerID, t.occurredAt),
  index("custom_event_workspace_idx").on(t.workspaceID, t.occurredAt),
  index("custom_event_name_idx").on(t.workspaceID, t.eventName),
]);
```

### `customer.ts` extensions

Add columns for profile metadata:

```ts
firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
phone: text("phone"),
location: text("location"),
metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
```

## Zero queries

```ts
customerByID: ({ id }) =>
  applyWorkspaceScope(z.query.customer)
    .where("id", "=", id)
    .related("tags", q => q.related("tag", t => t.related("group")))
    .related("customFieldValues", q => q.related("field"))
    .one(),

customerTickets: ({ customerID }) =>
  applyWorkspaceScope(z.query.ticket)
    .where("customerID", "=", customerID)
    .related("assignee")
    .orderBy("updatedAt", "desc").orderBy("id", "desc"),

customerNotes: ({ customerID }) =>
  applyWorkspaceScope(z.query.customerNote)
    .where("customerID", "=", customerID)
    .where("deletedAt", "IS", null)
    .related("createdBy")
    .orderBy("pinned", "desc")
    .orderBy("createdAt", "desc").orderBy("id", "desc"),

customerEvents: ({ customerID }) =>
  applyWorkspaceScope(z.query.customEvent)
    .where("customerID", "=", customerID)
    .orderBy("occurredAt", "desc").orderBy("id", "desc"),

relatedTickets: ({ customerID, excludeTicketID }) =>
  applyWorkspaceScope(z.query.ticket)
    .where("customerID", "=", customerID)
    .where("id", "!=", excludeTicketID)
    .where("status", "IN", ["open", "in_progress", "snoozed", "resolved"]) // exclude closed by default
    .orderBy("updatedAt", "desc").orderBy("id", "desc"),
```

## Mutators

`packages/mutators/src/customer-mutators.ts` (new):

- `customer.update({ id, name?, displayName?, phone?, location?, metadata? })` — admin-only fields excluded.
- `customer.merge({ sourceID, targetID })` — merges two customer rows (out of scope this phase, schema-only stub).
- `customerNote.create({ id, objectType, objectID, customerID, bodyHtml, bodyText })`
- `customerNote.update({ id, bodyHtml, bodyText })` — sets `editedAt`.
- `customerNote.delete({ id })` — soft delete, `deletedAt`.
- `customerNote.togglePin({ id })`.

`custom-event` mutators are deferred — events arrive via API/SDK and write directly through Hono server endpoints, not Zero mutators (events are append-only and high volume).

## UI surfaces

### Route `apps/web/src/routes/app/customers.$customerId.tsx`

- Two-column layout: left rail = profile card; right rail = timeline feed.
- Profile card sections: avatar/name/email block, copy-email button, contact info, tags pill cluster, custom fields block (T-1010 widget reused), counters (open conversations, total conversations, first/last seen, recent custom events count).
- Timeline feed: virtualized list, item types rendered by switch.
- Header has "Back" affordance and "Open new conversation" CTA.

### Customer link affordances

- Make customer email in inbox row clickable → routes to profile.
- Make customer in conversation header clickable → profile.

### Sidebar — Related conversations block

- New component `apps/web/src/components/conversation/related-conversations.tsx`.
- 5 most-recent tickets for the same customer (excluding current).
- Each row: shortID, title, status pill, age. Click → navigate.

## Tickets

### T-2001 — Customer schema extensions + Zero mirror

**Atlas ref:** `jsapp/src/models/customer.ts:15-81` (TCustomerFields shape).

**Plan:**
- Add `firstSeenAt`, `lastSeenAt`, `phone`, `location`, `metadata` to `customer` table.
- Backfill `firstSeenAt = createdAt` for existing rows.
- Mirror in Zero schema.
- Add to `apps/web/src/components/inbox-list.tsx` to use `firstSeenAt` if displayed (deferred to Phase 80).

**Acceptance:**
- Migration applies; existing customers have backfilled `firstSeenAt`.
- Zero exposes the new columns.

**Deps:** none.

---

### T-2002 — `customerByID` query + customer profile route shell

**Atlas ref:** `jsapp/src/app/customer-timeline/CustomerTimelineRoot.tsx`.

**Plan:**
- Route file `apps/web/src/routes/app/customers.$customerId.tsx` (TanStack Router file-based route).
- Add `customerByID` Zero query with relateds for tags + custom field values.
- Render profile card on the left: avatar, name, email, copy-email, phone, location, first-seen.
- Right column: timeline placeholder ("Coming up: full timeline").
- Wire customer email click in inbox row + conversation header to navigate here.

**Acceptance:**
- `/app/customers/:id` renders for any customer in the workspace.
- 404 for cross-workspace IDs.
- Profile card live-updates when another window edits the customer.

**Deps:** T-2001.

---

### T-2003 — Customer notes table + mutators

**Atlas ref:** `webapp/web/customer_notes/`.

**Plan:**
- Drizzle migration for `customer_note` (per schema delta).
- Zero mirror.
- Mutators: create / update / delete / togglePin.
- Audit events: `customer.note_created`, `customer.note_updated`, `customer.note_deleted`. Payload: `{noteID, snippet}`.
- Re-use Tiptap editor from composer for note authoring.

**Acceptance:**
- Notes are workspace-scoped, soft-deletable, pinnable.
- Edit-after-create updates `editedAt` and shows "edited" suffix in UI (built in T-2005).
- Cross-workspace queries return empty.

**Deps:** T-2002.

---

### T-2004 — Custom events table + ingestion endpoint

**Atlas ref:** `webapp/web/custom_events/`.

**Plan:**
- Drizzle migration for `custom_event` table.
- Zero mirror (read-only from client).
- Hono endpoint `POST /api/customers/:customerID/events` accepting `{eventName, properties, occurredAt?, source?}`. Workspace inferred from auth context. Source defaults to `api`.
- Validation: eventName non-empty, properties depth ≤ 4, total payload ≤ 16 KB.
- Idempotency optional (caller can pass `idempotencyKey`; we hash to `(workspace, customer, eventName, occurredAt, hash)`).
- No mutator — events are append-only, written via Hono only.

**Acceptance:**
- `curl POST /api/customers/X/events` ingests an event, appears in `customerEvents()` query within 500 ms.
- Cross-workspace customer ID rejected with 404.
- Invalid payload rejected with 400 + descriptive error.

**Deps:** T-2002.

---

### T-2005 — Timeline feed component

**Atlas ref:** `jsapp/src/app/customer-timeline/sections/`, `items/`.

**Plan:**
- Component `apps/web/src/components/customer/timeline-feed.tsx`.
- Subscribes to three queries: `customerTickets`, `customerNotes`, `customerEvents`.
- Merge into a single sorted feed by descending timestamp:
  - Ticket → use `updatedAt`
  - Note → `pinned` rows always first, then `createdAt`
  - Event → `occurredAt`
- Item types:
  - `<ConversationItem>` — short header (`#shortID`, status pill, title), 1-line snippet of latest message, timestamp.
  - `<NoteItem>` — pinned/edited indicator, body, edit/delete on hover (creator only), timestamp.
  - `<EventItem>` — icon (default), event name, properties as `key: value` chips, timestamp.
- Virtualized via `@tanstack/react-virtual`.
- Date dividers between days.

**Acceptance:**
- Mixed feed with 5 conversations + 3 notes + 10 events renders in correct chronological order.
- Pinned notes always at top, then chronological.
- Clicking conversation item navigates to its inbox detail.
- Empty state copy: "No history yet for {name}."

**Deps:** T-2003, T-2004.

---

### T-2006 — Customer-side custom fields block (mount in profile)

**Atlas ref:** `jsapp/src/components/customers/`.

**Plan:**
- Reuse the component built in T-1010 with `entity: "customer"`.
- Mount in profile card under contact info.

**Acceptance:**
- Setting a customer custom field optimistically updates and persists.
- Conditional visibility works for customer-category fields.

**Deps:** T-1010, T-2002.

---

### T-2007 — Add note from conversation panel

**Atlas ref:** `jsapp/src/components/conversations/vitals/sidebar/sidebar-infopane.tsx` (notes block).

**Plan:**
- Inline mini-editor on conversation page: "Add note about this customer".
- Calls `customerNote.create({ objectType: "customer", objectID: customerID, customerID })`.
- Below: list latest 3 notes for this customer; "see all in profile" link.
- Notes attached to the *ticket* (`objectType: "ticket"`) deferred to Phase 70 (activity timeline integration).

**Acceptance:**
- Adding a note in conversation surfaces in customer profile within 1 s.
- Inline list shows latest 3 with timestamp + pin indicator.

**Deps:** T-2003.

---

### T-2008 — Related conversations widget

**Atlas ref:** the related-conversations card in `jsapp/src/components/conversations/vitals/sidebar/`.

**Plan:**
- New component `apps/web/src/components/conversation/related-conversations.tsx`.
- Subscribe to `relatedTickets({ customerID, excludeTicketID })`.
- Show 5 most recent. Render: status pill, `#shortID`, title (truncated), age relative ("2h", "3d").
- "View all" link → `/app/customers/:customerID`.
- Mount in conversation sidebar (right rail). The sidebar shell itself arrives in Phase 80 — for now, mount under the existing assignee dropdown in the header.

**Acceptance:**
- Two open conversations for same customer cross-link in <1 s.
- Empty state ("This is their only conversation") on lone tickets.
- Closed-conversation toggle works (default hides closed).

**Deps:** T-2002.

---

### T-2009 — Customer counters and last-seen on profile

**Atlas ref:** customer model metadata fields.

**Plan:**
- Profile card right-edge counters: total open conversations, total conversations all-time, first contact (date), last contact (relative).
- Compute totals client-side from `customerTickets()` + `customerEvents()`.
- "Last contact" = max(latest message createdAt, latest event occurredAt).

**Acceptance:**
- Numbers update live as new events / tickets arrive.
- "First contact" stable on `firstSeenAt`.

**Deps:** T-2005.

---

### T-2010 — Add navigation links

**Plan:**
- Inbox row: customer email becomes a `<Link to="/app/customers/$id">` (clicking the email-only region; the row body still navigates to ticket).
- Conversation header: customer name/email clickable.
- New top-level nav item "Customers" linking to a customers list page (deferred — show empty placeholder for now or skip until Phase 50 when bulk select makes a list page useful).

**Acceptance:**
- Clicking customer email anywhere navigates to profile.
- Right-click → open in new tab works (uses real `<a>` under TanStack Router).
- Existing row click for opening ticket still works.

**Deps:** T-2002.

---

## Definition of done for Phase 20

- All ten tickets shipped.
- `/app/customers/:id` renders profile + interleaved timeline.
- Notes round-trip; events ingest via Hono.
- Conversation sidebar shows related conversations live.
- Two-window propagation tested.
- Migration applied, replication caught up, audit events logged for note ops.
