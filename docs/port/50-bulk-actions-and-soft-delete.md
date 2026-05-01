# Phase 50 — Bulk Actions + Soft Delete

## Goal

After this phase: agents can select multiple inbox rows (click, shift-click range, select-all) and apply actions in bulk — assign, change status/priority, add/replace tags, snooze, delete. Tickets soft-delete to an "Archived" view with a "Restore" affordance. Bulk operations are atomic-ish (single Inngest event drives N changes) and emit one combined audit event per ticket.

## Why now

Bulk multi-select is universally cited as the highest-leverage productivity feature in helpdesks (process 20 conversations in 3 clicks instead of 20). It depends on tags (Phase 10) and the view system (Phase 40) for the "select all in current view" semantic.

## Atlas behavior

### Selection model

- File: `jsapp/src/app/inbox/index.tsx:101-113` (`dispatchFocus` with shift support) and `jsapp/src/app/inbox/index.tsx:134-135` (`selectedConversationsIds` state).
- Per-row checkbox: `jsapp/src/components/conversations/conversation-list-item/ConversationListItem.tsx:164-176`.
- Header checkbox: select-all visible.
- Shift+click: extends selection from last clicked to current row (range).
- Cmd/Ctrl+click: toggles single row.
- Selection cleared on view change.
- Selection survives sort changes within same view.

### Bulk endpoints (Atlas)

- `POST /conversation/assign` — `{conversationIds[], agent_id}`
- `POST /conversation/unassign` — `{conversationIds[]}`
- `POST /conversation/assign-team` — `{conversationIds[], team_id}`
- `POST /conversation/add-tags` — `{conversationIds[], tagIds[]}`
- `POST /conversation/change-tags` — `{conversationIds[], tagIds[]}` (replaces)
- `POST /conversation/update_status` — `{conversationIds[], status}`
- `POST /conversation/update_priority` — `{conversationIds[], priority}`
- `POST /conversation/snooze` — `{conversationIds[], time, newStatus?}`
- `POST /conversation/update_custom_fields` — `{conversationIds[], updates}`
- `POST /conversation/delete-multi` — `{conversationIds[]}`

### Soft delete + Archived view

- Atlas: `conversations.deleted` boolean. When true, conversation hidden from regular views, surfaces in "Archived" inbox.
- Restore: setting `deleted = false`.
- "Archived" inbox: `jsapp/src/app/inbox/` includes a built-in `archived` filter.

### Bulk action toolbar

- Appears as floating toolbar at top of inbox when selection > 0.
- Buttons: Assign, Tag, Snooze, Status, Priority, Delete, ⋯ (more).
- Count badge: "23 selected".
- Clear button (X) on the left.
- Hotkeys: Cmd+A select all in view, Esc clear.

## Schema delta

### `ticket.ts` extensions

```ts
deletedAt: timestamp("deleted_at", { withTimezone: true }),
deletedByID: uuid("deleted_by_id").references(() => user.id),
```

Drop or amend the existing inbox index to honor `deletedAt IS NULL` for the standard views; add a new partial index for Archived:

```sql
CREATE INDEX ticket_archived_idx ON ticket (workspace_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;
```

### Built-in view defs (client-only)

Add to the built-ins list in Phase 40's tab strip:

- `archived` — filter `{ field: "deletedAt", operator: "nempty" }`. All other built-ins implicitly add `deletedAt empty`.

## Zero queries

Update `inboxOpen`, `myTickets`, etc., to add `.where("deletedAt", "IS", null)`. Add a new query for archived:

```ts
archivedTickets: () =>
  applyWorkspaceScope(z.query.ticket)
    .where("deletedAt", "IS NOT", null)
    .related("customer").related("assignee")
    .orderBy("deletedAt", "desc").orderBy("id", "desc"),
```

## Mutators

Two strategies for bulk:

1. **Client fans out single mutators** in a `Promise.all`. Pros: no schema/server work, plays nicely with Zero optimistic updates per row. Cons: N round-trips of telemetry; partial-failure ergonomics tricky.
2. **One bulk mutator** that takes `{ticketIDs[], op, args}`. Server iterates rows, emits one `auditEvent` per ticket but a single `bulk.completed` event. Inngest dispatches one `bulk/applied` event for downstream listeners.

**Decision:** **option 2 for state changes (status, priority, assign, snooze, delete)**, **option 1 for additive (add/remove tag)**. Reason: state changes benefit from single-server-pass auth + audit + Inngest. Tag attaches are append-only and Zero handles them well row-by-row.

`packages/mutators/src/bulk-mutators.ts` (new):

- `bulk.assign({ id, ticketIDs[], assigneeID | null })`
- `bulk.setStatus({ id, ticketIDs[], status })`
- `bulk.setPriority({ id, ticketIDs[], priority })`
- `bulk.snooze({ id, ticketIDs[], until })`
- `bulk.delete({ id, ticketIDs[] })`
- `bulk.restore({ id, ticketIDs[] })`
- `bulk.replaceTagsOnTickets({ id, ticketIDs[], tagIDs[] })` — sets exactly this set on each ticket

Each mutator:
- Reads ticket rows in workspace.
- For each row: applies change, emits per-ticket audit (`ticket.bulk_assigned`, etc., payload includes `bulkOpID`).
- Emits one summary `auditEvent.kind = "bulk.completed"` with `{op, count, bulkOpID}`.

Server post-commit hook dispatches `bulk/applied` Inngest event with `idempotencyKey: bulk-<bulkOpID>`. Downstream listeners (notifications, SLA timers) can react.

## UI surfaces

### Selection state

- New zustand-or-context store `apps/web/src/lib/inbox-selection.ts`:
  - `Set<ticketID>` selected.
  - `lastFocusID` for shift-click anchoring.
  - `clear()`, `toggle(id)`, `range(to)`, `selectAll(idsInView)`.
- Selection is *not* persisted across view changes (Atlas semantics).

### Inbox row checkbox

- New leading column on `inbox-list.tsx` row.
- Visible always (per design choice; Atlas hides it but reveals on hover for unselected rows — we mirror).
- Click / shift-click / cmd-click handled by selection store.

### Bulk toolbar

- New `apps/web/src/components/inbox-bulk-toolbar.tsx`.
- Renders only when selection > 0.
- Slots: count + Clear, Assign, Tag, Status, Priority, Snooze, Delete, More.
- Each opens a sub-popover backed by the same picker patterns as the conversation header.
- Loading state during bulk apply (disable buttons, show spinner).

### Archived view

- Built-in tab `Archived`. Hidden by default; toggled in tab settings? **Decision:** always shown but at the end with a muted icon.
- Restore button on each archived row.

## Tickets

### T-5001 — Soft delete columns + archived view query

**Atlas ref:** `conversations.deleted` flag.

**Plan:**
- Migration: add `deletedAt`, `deletedByID` to `ticket`.
- New partial index for archived.
- Update existing Zero queries (`inboxOpen`, `myTickets`, `ticketByID`) with `.where("deletedAt", "IS", null)`.
- Add `archivedTickets()` query.

**Acceptance:**
- Migration applies, replication catches up.
- Existing inbox views automatically exclude soft-deleted.
- New archived query returns soft-deleted rows.

**Deps:** none.

---

### T-5002 — `bulk.delete` and `bulk.restore` mutators

**Atlas ref:** `POST /conversation/delete-multi`.

**Plan:**
- Mutators per spec.
- Audit: `ticket.bulk_deleted` per row + `bulk.completed` summary.
- Single ticket delete also flows through `bulk.delete([id])` for consistency.

**Acceptance:**
- Deleting 5 tickets removes them from all standard views in <500 ms.
- `archivedTickets()` shows them with `deletedAt` populated.
- Restore moves them back to inbox.

**Deps:** T-5001.

---

### T-5003 — Selection store + row checkboxes

**Atlas ref:** `jsapp/src/app/inbox/index.tsx:101-113`.

**Plan:**
- `apps/web/src/lib/inbox-selection.ts` — zustand store.
- Add leading checkbox to inbox row in `inbox-list.tsx`.
- Click semantics:
  - Plain click → toggle this row only (clears others).
  - Cmd/Ctrl+click → toggle without clearing.
  - Shift+click → select range from `lastFocusID` to this row.
- Selection visual: row gets accent left-border and tinted bg.
- Selection clears on view change (subscribe to URL `?view` param).

**Acceptance:**
- All click semantics behave identically to macOS Finder list.
- Keyboard: `x` toggles current focused row's selection.
- Esc clears selection.

**Deps:** none.

---

### T-5004 — Bulk action toolbar

**Atlas ref:** Atlas's floating bulk toolbar at top of inbox.

**Plan:**
- `inbox-bulk-toolbar.tsx`.
- Renders above the list when `selectionStore.size > 0`.
- Layout: `[X] {count} selected` on left; action buttons in middle; "More" on right.
- Each action button opens a popover identical to the conversation-page picker (status, priority, assignee, tag, snooze).
- Calls the matching `bulk.*` mutator.
- After action: clear selection (configurable — for tag adds, keep selection so agent can chain).

**Acceptance:**
- Toolbar appears smoothly on first selection.
- Bulk assign of 50 tickets completes in <1 s and refreshes rows.
- Toolbar disappears on Esc / clear.

**Deps:** T-5003 + T-5005 + T-5006 + T-5007 + T-5008.

---

### T-5005 — `bulk.assign` mutator

**Plan:**
- Validates assignee membership in workspace (mirror `ticket.assign`).
- Audit per row + summary.

**Acceptance:** as per general bulk acceptance.

**Deps:** T-5001.

---

### T-5006 — `bulk.setStatus`, `bulk.setPriority` mutators

**Plan:** simple iteration; assert valid enum values.

**Acceptance:**
- Setting "in_progress" on 30 tickets in different starting states succeeds atomically.
- Invalid status rejected.

**Deps:** T-5001.

---

### T-5007 — `bulk.snooze` mutator

**Plan:**
- Sets status to `snoozed`, stamps `snoozedUntil` (this column doesn't exist yet — add to `ticket`).
- Audit kind `ticket.bulk_snoozed` payload `{until, bulkOpID}`.
- Inngest dispatch for auto-wake comes in Phase 90.

**Schema bump (do here, not in 90):**

```ts
snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
```

Existing single `ticket.snooze` mutator already exists — refactor to also write `snoozedUntil`.

**Acceptance:**
- Snooze 10 tickets to "tomorrow 9 AM" all stamp the same time.
- Auto-wake wired in Phase 90.

**Deps:** T-5001.

---

### T-5008 — `bulk.replaceTagsOnTickets` mutator

**Plan:**
- For each ticket: delete current `ticketTag` rows, insert new ones in single transaction.
- Audit: `ticket.bulk_tags_replaced` per row.
- Note: the related `tag.attachToTicket` from Phase 10 stays for single-row use.

**Acceptance:**
- Bulk-replace 20 tickets to `{billing}` removes all existing tags and adds billing.
- Two windows reconcile within 1 s.

**Deps:** T-5001, Phase 10 (T-1002).

---

### T-5009 — Archived view tab

**Atlas ref:** Atlas's Archived inbox.

**Plan:**
- Add `archived` to built-in views in `inbox-tabs.tsx` (Phase 40 component).
- Query: `archivedTickets()`.
- Row variant: muted, with "Restore" pill button calling `bulk.restore([id])`.
- Empty state: "Nothing archived yet."

**Acceptance:**
- Soft-deleted ticket appears here within 1 s.
- Restore moves it back; it leaves Archived live.

**Deps:** T-5002, Phase 40 (T-4003).

---

### T-5010 — Cmd+K bulk commands + keyboard shortcuts

**Atlas ref:** Atlas hotkeys.

**Plan:**
- Register:
  - `bulk.select_all` — Cmd+A in inbox context.
  - `bulk.clear_selection` — Esc when selection > 0.
  - `bulk.assign`, `bulk.set_status`, `bulk.set_priority`, `bulk.snooze`, `bulk.delete`, `bulk.tag` — only enabled when selection > 0; open the same picker as toolbar buttons.
- Help modal shows them.

**Acceptance:**
- Selecting 5 + pressing Cmd+P opens priority picker, applies to all 5.
- Cmd+A selects all rows in current view.
- All commands disabled when selection = 0.

**Deps:** T-5004, Phase 30.

---

### T-5011 — Confirmation for destructive bulk actions

**Plan:**
- `bulk.delete` of more than 5 rows shows a confirmation modal: "Delete 23 conversations? You can restore them from Archived."
- Toast after success with "Undo" button (5 s window) calling `bulk.restore`.
- No confirmation for status/priority/tag — those are easily reversible.

**Acceptance:**
- Confirm modal blocks destructive op until confirmed.
- Undo toast restores all 23 in one call.

**Deps:** T-5002.

---

## Definition of done for Phase 50

- Selection model works with all click variants and keyboard.
- Five bulk mutators ship: assign, setStatus, setPriority, snooze, delete (+ tag replace).
- Soft delete + Archived view work; Restore lives.
- Cmd+K commands wired.
- Type-check + Biome clean; design review on toolbar appearance + bulk modal flows.
