# Phase 70 — Read State + Notifications + Activity Timeline

## Goal

After this phase: every conversation knows which agents have seen its latest message; the inbox row visually distinguishes unread; a notifications center surfaces mentions, assignments, and SLA breaches; and the conversation page renders an activity timeline (assignments, status, priority, tag, custom-field changes) interleaved with messages.

## Why now

Read/unread is a daily-use scanning aid. Notifications are the second half of mentions (which were wired in Phase 60). The activity timeline is the same kind of feed Phase 20 built for customers, applied to a conversation — it leans on the `auditEvent` rows every prior phase has been writing.

## Atlas behavior

### Read state

- **Storage:** `conversations.read_by` is `ARRAY(UUID)` (agent IDs who have read the latest activity).
- **Reset trigger:** any new inbound message or any `unread_mentions` update clears `read_by` (or removes specific agents).
- **Mark read API:** opening a conversation appends `agent_id` to `read_by`.
- **UI:** unread rows render bold; rendering distinct in `jsapp/src/components/conversations/conversation-list-item/ConversationListItem.tsx`.
- **Mark mentions read** (separate from row read): `POST /conversations/mark_mentions_read/{conversationId}` (already covered in Phase 60).

### Notifications

- **Backend module:** `webapp/web/notifications/`.
- **Frontend:** `jsapp/src/app/notificator/`.
- **Triggers:** assignment, mention, SLA breach (Phase 95), new message, internal note.
- **Notification record:** `id`, `agent_id`, `kind`, `payload`, `conversation_id?`, `read_at?`, `created_at`.
- **Channels:** in-app badge, browser notification (if granted), email (per user setting).
- **Center UI:** dropdown panel listing recent notifications with click-through, "Mark all read", filters by kind.

### Activity timeline (per conversation)

- Atlas: `webapp/web/conversation/` activities table tracks every state change.
- Frontend renders interleaved with messages in the conversation thread.
- Activity types: assigned, unassigned, status changed, priority changed, snoozed, reopened, tag added, tag removed, custom field changed, merged, customer switched.
- Display: small grey bar in the thread with actor name, action, optional value diff, timestamp.

### Read-state edge cases

- New inbound message clears `read_by` entirely.
- Outbound (agent reply) does not clear `read_by` — agents who already saw the thread remain "read".
- Internal note clears only for *other* agents (the author stays read).

## Schema delta

### `ticket.ts` extensions

```ts
readByUserIDs: jsonb("read_by_user_ids").$type<string[]>().notNull().default([]),
```

We avoid a `read_by` join table because reads are super-frequent and the array fits the access pattern (always read whole-set, write whole-set per ticket).

### `notification.ts` (new — bare-bones table introduced in Phase 60 fleshed out here)

```ts
export const notificationKindEnum = pgEnum("notification_kind", [
  "mention",
  "assignment",
  "sla_warning",
  "sla_breach",
  "new_inbound",
]);

export const notification = pgTable("notification", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceID: uuid("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  recipientUserID: uuid("recipient_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: notificationKindEnum("kind").notNull(),
  ticketID: uuid("ticket_id").references(() => ticket.id, { onDelete: "cascade" }),
  messageID: uuid("message_id").references(() => message.id, { onDelete: "cascade" }),
  actorUserID: uuid("actor_user_id").references(() => user.id, { onDelete: "set null" }),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt,
}, (t) => [
  index("notification_recipient_idx").on(t.recipientUserID, t.readAt, t.createdAt),
  index("notification_workspace_idx").on(t.workspaceID, t.createdAt),
  index("notification_ticket_idx").on(t.ticketID),
]);
```

### `auditEvent` taxonomy

We've been writing audit events with free-form `kind` strings. Lock down the email-relevant taxonomy as a constant object in `packages/core/src/audit-kinds.ts`:

```ts
export const AuditKinds = {
  TicketCreated: "ticket.created",
  TicketAssigned: "ticket.assigned",
  TicketUnassigned: "ticket.unassigned",
  TicketStatusChanged: "ticket.status_changed",
  TicketPriorityChanged: "ticket.priority_changed",
  TicketSnoozed: "ticket.snoozed",
  TicketReopened: "ticket.reopened",
  TicketClosed: "ticket.closed",
  TicketTagAdded: "ticket.tag_added",
  TicketTagRemoved: "ticket.tag_removed",
  TicketTagsReplaced: "ticket.tags_replaced",
  TicketFieldSet: "ticket.field_set",
  TicketFieldCleared: "ticket.field_cleared",
  TicketDeleted: "ticket.deleted",
  TicketRestored: "ticket.restored",
  TicketMerged: "ticket.merged",
  TicketCustomerSwitched: "ticket.customer_switched",
  CustomerNoteCreated: "customer.note_created",
  CustomerNoteUpdated: "customer.note_updated",
  CustomerNoteDeleted: "customer.note_deleted",
  CustomerTagAdded: "customer.tag_added",
  CustomerTagRemoved: "customer.tag_removed",
  CustomerFieldSet: "customer.field_set",
  CustomerFieldCleared: "customer.field_cleared",
  ViewCreated: "view.created",
  ViewUpdated: "view.updated",
  ViewArchived: "view.archived",
  ViewReordered: "view.reordered",
  BulkCompleted: "bulk.completed",
} as const;
```

This becomes the single source of truth for the activity-timeline renderer.

## Zero queries

```ts
notificationsForMe: () =>
  applyWorkspaceScope(z.query.notification)
    .where("recipientUserID", "=", AUTH.sub)
    .related("ticket", q => q.related("customer"))
    .related("actor")
    .orderBy("createdAt", "desc").orderBy("id", "desc"),

unreadNotificationCount: () =>
  applyWorkspaceScope(z.query.notification)
    .where("recipientUserID", "=", AUTH.sub)
    .where("readAt", "IS", null),
  // count via .length client-side

ticketActivity: ({ ticketID }) =>
  applyWorkspaceScope(z.query.auditEvent)
    .where("payload->>ticketID", "=", ticketID)
    // Note: JSONB path query — verify Zero supports this; if not, denormalize ticketID column on auditEvent
    .related("actor")
    .orderBy("createdAt", "asc").orderBy("id", "asc"),
```

**Schema bump:** `auditEvent` likely needs a denormalized `ticketID` column for efficient querying (JSONB path filtering on Zero is not great). Add it as part of T-7005:

```ts
ticketID: uuid("ticket_id").references(() => ticket.id, { onDelete: "cascade" }),
customerID: uuid("customer_id").references(() => customer.id, { onDelete: "set null" }),
// indexes:
index("audit_ticket_idx").on(t.workspaceID, t.ticketID, t.createdAt),
index("audit_customer_idx").on(t.workspaceID, t.customerID, t.createdAt),
```

Backfill from `payload`.

## Mutators

### Read state

- `ticket.markReadByMe({ ticketID })` — appends `AUTH.sub` to `readByUserIDs` if not present. Idempotent.
- Auto-fired on conversation open (debounced 1 s after view starts).

### Notifications

- `notification.markRead({ id })` — sets `readAt = now`.
- `notification.markAllRead({ ticketID? })` — bulk mark; if `ticketID` supplied, only that ticket's; else all of mine.

Notifications are *written* by Inngest functions, not by client mutators (client never creates notifications).

### Updates to existing mutators

- `message.send` (when from customer-side via inbound or agent-side reply):
  - On customer message inbound: clear `readByUserIDs = []` (everyone unread again).
  - On agent reply: do not clear (reply is from the team).
  - On internal note: remove all members *except* the author from `readByUserIDs`.
- `ticket.assign`: if assignee changes, dispatch `notifications/assignment.created` to the new assignee.

## Inngest functions

### `notifications/assignment.created`

`apps/api/src/inngest/functions/dispatch-assignment-notification.ts`:

- Trigger: server post-commit on `ticket.assign`.
- Idempotency key: `assign-<ticketID>-<newAssigneeID>-<commitTimestamp>`.
- Writes notification row with kind `assignment`.
- Skips if assignee is the actor (you don't get notified for self-assigning).

### `notifications/mention.created` (already exists from Phase 60)

Extend to set the right metadata fields the notification panel needs.

### `notifications/inbound.received` (deferred to Phase 95-ish)

For "new inbound on assigned ticket" — disable by default; user opt-in.

## UI surfaces

### Inbox row unread visual

- Bold customer name + bold subject when `!readByUserIDs.includes(currentUserID)`.
- Subtle accent dot left of avatar on unread.
- Read state updates row appearance live.

### Conversation page activity timeline

- Renders `ticketActivity()` interleaved with messages by `createdAt`.
- Each activity row: 1-line, grey bar, `<actor> <verb> <object> · <timestamp>`.
- Verb dictionary (rendered by audit `kind`):
  - `ticket.assigned` → "assigned to {assigneeName}"
  - `ticket.unassigned` → "unassigned"
  - `ticket.status_changed` → "changed status to {status}"
  - `ticket.priority_changed` → "set priority to {priority}"
  - `ticket.tag_added` → "added tag {label}"
  - `ticket.tag_removed` → "removed tag {label}"
  - `ticket.field_set` → "set {fieldName} to {value}"
  - `ticket.merged` → "merged into #{shortID}"
  - `ticket.customer_switched` → "switched customer to {newCustomer}"
- Group consecutive same-actor same-kind events within a 30 s window into a single row ("changed status 3 times, last to Resolved").

### Notifications center

- Topbar bell icon with badge (unread count from `unreadNotificationCount`).
- Click → panel: tabs All / Unread / Mentions, filter by kind, sorted by createdAt desc.
- Each row: actor avatar + 1-line summary + ticket reference + timestamp. Click → navigate to ticket and `notification.markRead`.
- Footer: "Mark all read".
- Browser notification permission ask: gentle prompt on first mention received (after granted, fire `Notification` API on each new in-app notification).

## Tickets

### T-7001 — Read state column + mutator

**Atlas ref:** `conversations.read_by` ARRAY(UUID).

**Plan:**
- Migration: `readByUserIDs` JSONB array on ticket (default `[]`).
- Mirror in Zero schema.
- `ticket.markReadByMe` mutator — append-if-absent semantics (idempotent).
- Update `inboxOpen` and other queries' relateds to include `readByUserIDs` (it's already on ticket so just exposed).

**Acceptance:** mutator round-trips; multiple agents tracked independently; cross-window updates.

**Deps:** none.

---

### T-7002 — Read-state hooks for inbox + conversation

**Plan:**
- `useMarkReadOnView(ticketID)` — fires `ticket.markReadByMe` after the conversation has been mounted ≥ 1 s.
- Inbound message arrival should clear the array — this happens in T-7003.
- Internal notes from another agent clear array sans-author — also T-7003.

**Acceptance:**
- Open conversation → after 1 s, row in inbox no longer shows unread for me.
- Other agents still see it unread until they open it.

**Deps:** T-7001.

---

### T-7003 — Read state invalidation rules

**Plan:**
- Update `message.send` mutator:
  - If `authorType === "customer"` and not internal → `ticket.readByUserIDs = []`.
  - If `authorType === "agent"` and `isInternal === false` → no change.
  - If `authorType === "agent"` and `isInternal === true` → remove every member except author from array.
- Update inbound routing in `apps/api/src/inngest/functions/route-inbound-message.ts` to clear `readByUserIDs` when threading into existing ticket.

**Acceptance:**
- Customer reply unboldens nothing for anyone (everyone marked unread).
- Internal note authored by Bob: Bob stays read, others go unread.
- Agent reply: no change to read state.

**Deps:** T-7001.

---

### T-7004 — Inbox row unread styling

**Atlas ref:** `ConversationListItem.tsx` row styling.

**Plan:**
- In inbox row, compare `readByUserIDs` against `AUTH.sub`; if absent → bold customer / subject.
- Small accent dot (left of avatar, 6 px) on unread rows.
- Animate state change subtly (200 ms fade).

**Acceptance:** visual delineation crisp; no shifting layout when toggling.

**Deps:** T-7003.

---

### T-7005 — Audit event denormalization

**Plan:**
- Migration: add `ticketID`, `customerID` columns to `auditEvent`. Backfill from existing `payload`.
- Update every existing mutator that emits audit to also set the column.
- Add the `AuditKinds` constants object.

**Acceptance:**
- Existing audit rows backfilled to ≥ 99% (any unbackfillable rows logged).
- New mutators set columns directly.
- Query `ticketActivity({ticketID})` returns events in <50 ms over 100 events.

**Deps:** none (parallel with read state work).

---

### T-7006 — Activity timeline renderer

**Atlas ref:** Atlas's conversation activity rows.

**Plan:**
- New component `apps/web/src/components/conversation/activity-row.tsx`.
- Verb dictionary keyed off `AuditKinds`.
- In conversation thread (`inbox.t.$ticketId.tsx`), interleave messages and activity by `createdAt`.
- Group consecutive same-actor same-kind in 30 s window: collapse into single row with summary.
- Date dividers between days.

**Acceptance:**
- Assigning, then changing priority, then closing, then reopening shows 4 distinct rows.
- 5 status changes within 30 s shows 1 row "changed status 5 times, last to Resolved".
- Renders correctly when only audit, no messages, exist.

**Deps:** T-7005.

---

### T-7007 — Notification table + Zero mirror

**Plan:**
- Migration per spec.
- Zero mirror.
- Queries: `notificationsForMe`, `unreadNotificationCount`.

**Acceptance:** migration, mirror, queries operational.

**Deps:** none.

---

### T-7008 — Assignment notification Inngest pipeline

**Atlas ref:** Atlas's assignment notification.

**Plan:**
- Server post-commit on `ticket.assign` dispatches `notifications/assignment.created`.
- Listener writes notification row.
- Self-assign skipped.

**Acceptance:**
- Assigning Bob to ticket → Bob's row in `notificationsForMe` updates within 1 s.
- Self-assigning self → no notification.

**Deps:** T-7007.

---

### T-7009 — `notification.markRead` and `markAllRead` mutators

**Plan:** straightforward; auth check `recipientUserID === AUTH.sub`.

**Acceptance:** marking individual / all live across windows.

**Deps:** T-7007.

---

### T-7010 — Notifications center UI

**Atlas ref:** `jsapp/src/app/notificator/`.

**Plan:**
- Bell icon in topbar (`apps/web/src/components/topbar.tsx` — add if not present).
- Badge with `unreadNotificationCount`.
- Dropdown panel: tabs All / Unread / Mentions.
- Per-row layout: actor avatar, 1-line summary (kind-driven), ticket short ref, timestamp.
- Click row → navigate to ticket + `notification.markRead({ id })`.
- "Mark all read" footer button.

**Acceptance:**
- Mention from Phase 60 surfaces here within 1 s of send.
- Click jumps to conversation; row marked read.
- Empty state copy when no notifications.

**Deps:** T-7009 + Phase 60 (T-6006).

---

### T-7011 — Browser notification permission + push

**Plan:**
- On first `notification` row created for the user where `kind === "mention"` (or assignment), prompt for browser notification permission via gentle UI banner.
- After granted: fire `new Notification(title, body)` on each new in-app notification (subscribe via Zero).
- Per-kind toggle in `/settings/notifications` (deferred — ship the data model only this phase).

**Acceptance:**
- Permission prompt appears once after first notification.
- Granted state persists.
- Browser notifications fire on mention + assignment.
- Click on browser notification focuses tab + navigates.

**Deps:** T-7010.

---

### T-7012 — Cmd+K commands for notifications

**Plan:**
- `notifications.open` ($mod+;) — toggle center panel.
- `notifications.mark_all_read`.

**Acceptance:** registered, hotkeys discoverable in help modal.

**Deps:** T-7010, Phase 30.

---

## Definition of done for Phase 70

- Read state visualized in inbox; correctly invalidated by inbound and internal notes.
- Activity timeline renders all audit kinds with proper verbs.
- Notifications center shows mentions and assignments live.
- Browser notification permission flow works.
- Type-check + Biome clean; design review on row appearance + activity rows + notification panel.
