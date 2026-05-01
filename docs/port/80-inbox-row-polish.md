# Phase 80 — Inbox Row Polish

## Goal

After this phase: an inbox row is information-dense the way Atlas's is. The "snippet" is the latest *customer* message, not the ticket title. A direction badge shows whether we're waiting on the customer or vice versa. Channel icon, attachment icon, account logo (if present) all surface. Agents can toggle which fields appear via a display-settings popover. Sort options expand and persist per view.

## Why now

Row polish is a "1% wins compounding" investment. It makes the inbox glanceable. It depends on tags (10), custom fields (10), bulk select (50) for room budgeting, and the audit/activity pipeline (70) for the direction badge.

## Atlas behavior

### Row anatomy (`jsapp/src/components/conversations/conversation-list-item/ConversationListItem.tsx:106-250+`)

Top to bottom, left to right:

1. **Checkbox** (Phase 50).
2. **Customer avatar** with optional **visitor / VIP / verified badge**.
3. **Customer name** + small account name/logo if B2B.
4. **Channel icon** (envelope for email, etc.). Multi-channel: stacked icons.
5. **Subject** (1-line, truncated).
6. **Snippet of latest customer message** (1 line, lighter color). Atlas's deliberate choice: this is the *customer* message, regardless of who replied last — frames the agent's work as "what is the customer asking?".
7. **Direction indicator**: an arrow or pill — "Inbound" (latest is from customer) or "Outbound" (we replied last). Tells agent if they're waiting on the customer or the customer's waiting on them.
8. **Tag pills** (subset, with `+N` overflow).
9. **Attachment icon** if any message in the thread has attachments.
10. **Custom field display** (admin-configurable subset).
11. **Priority badge**.
12. **Status badge** (or hidden in default view since the view is filtered by status).
13. **Assignee avatar** + name on hover.
14. **SLA badge** (Phase 95).
15. **Created date / last message date** (relative); tooltip on hover.

### Display settings popover

- Atlas: `jsapp/src/app/inbox/display-settings/DisplaySettingsPopover.tsx`.
- Toggles: which fields appear in row (custom fields, tags, account, SLA, etc.).
- Tab orientation: horizontal vs vertical.
- View modes: Active Ticket Only / Inbox + Active Ticket / Full Timeline.
- Persisted per-agent in localStorage.

### Sort persistence

- Atlas stores sort preference per-inbox-id in localStorage.
- Default sort: last message timestamp DESC.
- Other sort axes: created DESC, priority DESC, customer name ASC, assignee.

### Optimistic update pattern

- Per Atlas: status / priority / assignment updates appear *immediately* in row before server confirms. Zero gives this for free; we just need to make sure the row recomputes from the live ticket row.

## Schema delta

### Display preferences (per-agent, per-workspace)

Three options:

1. **localStorage only** — fast, no Zero subscription, no cross-device sync. Default.
2. **`agent_preferences` table** — JSONB blob keyed by `(workspaceID, userID)`.
3. **Hybrid** — localStorage default, sync to server on change.

**Decision:** **localStorage only** for this phase. Cross-device sync deferred. Not worth a Zero subscription per agent.

### Snippet helpers

To render the latest *customer* message in the row efficiently, the existing `inboxOpen()` query needs to return the latest customer-message body alongside the ticket. Options:

1. Subscribe to `messages` per ticket and find the latest (Zero handles this). Adds N message subscriptions on a 100-ticket inbox = 100 subs.
2. Denormalize on `ticket`: `latestCustomerMessageSnippet`, `latestCustomerMessageAt`. Update via post-commit hook on every customer-side `message.send`.

**Decision:** **option 2** for performance. Add columns:

```ts
latestCustomerMessageSnippet: text("latest_customer_message_snippet"),
latestCustomerMessageAt: timestamp("latest_customer_message_at", { withTimezone: true }),
latestMessageDirection: pgEnum("message_direction", ["inbound", "outbound"])("latest_message_direction"),
hasAttachments: boolean("has_attachments").notNull().default(false),
```

Backfill on migration; maintain via existing post-commit hook in `apps/api/src/server-mutators.ts`.

## Mutators

No new mutators. Existing `message.send` server post-commit gets a "snippet update" step.

## UI surfaces

### `apps/web/src/components/inbox-row.tsx` (rewrite)

Extracted from `inbox-list.tsx`. Two-row layout:

- **Top row:** checkbox · avatar (+badge) · name · channel icon · subject (truncated) · tag pills · meta (priority, attachment icon, assignee avatar) · time.
- **Bottom row:** snippet (italic, lighter, 1-line truncate) · direction pill on right.

Variants:
- Compact (1-row mode in display settings).
- Default (2-row).
- Comfortable (2-row + custom fields footer).

### Direction pill

- "Inbound" = down-arrow + customer color.
- "Outbound" = up-arrow + agent color.
- Tooltip: "Last message: customer · 4h ago" or "Last message: you · 2m ago".

### Display settings popover

`apps/web/src/components/inbox-display-settings.tsx`:

- Trigger: gear icon on tab strip right.
- Sections:
  - **Density** — Compact / Default / Comfortable.
  - **Show in row** — checkboxes for: Account, Tags, Custom fields (per-field), Attachment icon, SLA badge, Direction pill, Priority badge, Status badge (when not implied by view).
  - **Sort** — picker matching `ViewSort` shape.
- Persist to localStorage `inbox.display:{viewID}`.

### Sort picker

- Options: Last message DESC/ASC, Created DESC/ASC, Priority DESC, Customer A→Z, Assignee A→Z, Custom field (per-field).
- Per-view persistence (localStorage).
- Apply via Zero query `.orderBy()` chain at composition time.

## Tickets

### T-8001 — Denormalized snippet + direction columns

**Atlas ref:** snippet rendering in `ConversationListItem.tsx`.

**Plan:**
- Migration: add `latestCustomerMessageSnippet`, `latestCustomerMessageAt`, `latestMessageDirection`, `hasAttachments` to `ticket`.
- Backfill: SQL — for each ticket, find latest customer message and stamp.
- Mirror in Zero schema.
- Update `apps/api/src/server-mutators.ts` `message.send` hook:
  - On customer-author message: update ticket snippet + at + direction = inbound + hasAttachments aggregate.
  - On agent-author non-internal message: direction = outbound (snippet unchanged).
  - Internal note: no change.
- Update `route-inbound-message.ts` to also stamp on inbound ingest.

**Acceptance:**
- Existing tickets backfilled correctly.
- New customer message updates snippet + direction within 200 ms.
- Internal notes don't change snippet.

**Deps:** none.

---

### T-8002 — Row component rewrite (snippet + direction)

**Atlas ref:** `ConversationListItem.tsx`.

**Plan:**
- Extract `inbox-row.tsx`.
- 2-row layout per spec.
- Snippet rendered from `latestCustomerMessageSnippet` (truncated, italic, lighter color via theme token).
- Direction pill on right of snippet.
- Tooltip with relative + absolute time.
- Empty snippet (no customer message yet on a draft ticket) → fallback to subject.

**Acceptance:**
- All 4 default views render with snippet + direction.
- Tag pills + priority + assignee preserved.
- Width responsive: snippet truncates instead of wrapping.

**Deps:** T-8001.

---

### T-8003 — Channel icon + attachment icon

**Plan:**
- Add channel icon next to subject. For email: envelope; for future channels: respective icon.
- Pull from `ticket.channelID` → `channel.kind`. Add `.related("channel")` to `inboxOpen()`.
- Attachment icon: paperclip, shown when `hasAttachments` true.
- Tooltips on both.

**Acceptance:**
- Email tickets show envelope; tickets with attachments show paperclip; both icons sized 14 px and aligned to subject baseline.

**Deps:** T-8002.

---

### T-8004 — Visitor / verified / VIP avatar badges

**Atlas ref:** Atlas's badge overlays on customer avatars.

**Plan:**
- Customer schema bump: add `verifiedAt`, `vip` boolean (default false). Migration + Zero mirror.
- Avatar component renders a small badge in lower-right of avatar:
  - Verified: blue check.
  - VIP: gold star.
  - Visitor: grey "V" if no `verifiedAt`.
- Mutators: `customer.markVerified`, `customer.toggleVip` (admin-only).

**Acceptance:**
- All three badge states render distinct.
- Admins can toggle VIP from customer profile.
- Visitor badge only shows for unverified customers (typical: never replied beyond signup).

**Deps:** none.

---

### T-8005 — Display settings popover

**Atlas ref:** `DisplaySettingsPopover.tsx`.

**Plan:**
- Component `apps/web/src/components/inbox-display-settings.tsx`.
- Gear icon trigger on tab strip right (right of "+ tab").
- Local-storage backed: `inbox.display:{viewID}` → `{density, fields, sort}`.
- Inbox row reads settings and conditionally renders.
- Sort picker triggers re-query (`ticketsForView` accepts `sort` arg, applies `orderBy`).

**Acceptance:**
- Toggling "Show tags" hides tag pills live across all rows.
- Density change updates row height.
- Sort persists across reloads.
- Per-view scoping: changing density on "All" doesn't change "Mine".

**Deps:** T-8002, Phase 40 (T-4005).

---

### T-8006 — Sort picker + per-view persistence

**Atlas ref:** Atlas's sort picker (Ctrl+S).

**Plan:**
- Sort menu in display popover; also accessible via `[` (or some short hotkey — register in Phase 30 framework).
- Sort axes: Last message DESC/ASC, Created DESC/ASC, Priority DESC, Subject A→Z, Customer A→Z, Assignee A→Z.
- Custom field axes shown for active ticket-category fields.
- Underlying: pass `sort` through to `ticketsForView({sort})`. The query helper composes `.orderBy()` calls.

**Acceptance:**
- All sort axes work for the four built-in views.
- Per-view persistence.
- Tiebreakers (always `id` last) keep order stable.

**Deps:** T-8005, Phase 40.

---

### T-8007 — Custom field display in row

**Plan:**
- For fields admin-configured to show in row, render compact value to the right of tags.
- Display variants per type:
  - text → truncated 20 char.
  - number / decimal → right-aligned numeric.
  - boolean → check / x.
  - date → relative.
  - list / multi_select → first option name + `+N`.
  - entity refs → name only.
- Configurable in T-8005 popover (per-field on/off).

**Acceptance:**
- Admin-active field shows in row when toggled on.
- Type-specific renderers correct.
- Empty value renders blank, not literal "null".

**Deps:** T-8005, Phase 10 (T-1010).

---

### T-8008 — Conversation sidebar shell

**Atlas ref:** `jsapp/src/components/conversations/vitals/sidebar/sidebar-infopane.tsx`.

**Plan:**
- New component `apps/web/src/components/conversation-sidebar.tsx`.
- Right rail in `inbox.t.$ticketId.tsx`. Toggle open/closed.
- Sections (collapsible):
  - **Status / Priority / Assignee** (move from header here; header keeps title only).
  - **Customer card** (avatar, name, email, copy-email, link to profile, custom fields).
  - **Tags** (Phase 10 widget).
  - **Custom fields** (Phase 10 widget).
  - **Related conversations** (Phase 20 widget).
  - **Activity** (Phase 70 widget — duplicate of inline timeline, collapsed by default).
  - **Email metadata** — domain, address, last delivery status.
- Sidebar width: 360 px collapsed (just icons), 480 px expanded.
- Persist open/closed in localStorage.

**Acceptance:**
- All Phase 10–70 widgets render in correct sections.
- Toggling open/closed smooth (CSS transition).
- Conversation thread reflows.
- Mobile: sidebar overlays the thread.

**Deps:** Phase 10 (widgets), Phase 20 (related), Phase 70 (activity).

---

### T-8009 — Sidebar email metadata block

**Plan:**
- Inside sidebar, render:
  - Channel (icon + name).
  - From email address (last outbound from-address).
  - Customer's email + alternate emails.
  - Last delivery status (queued / sent / delivered / bounced + retry button if failed).
  - Reply-plus token expiry status (info tooltip).
- Pulls from `outboundMessagesByTicket()` and `emailAddress` relations.

**Acceptance:**
- Each field renders correctly.
- Failed message → "Retry" calls a re-dispatch (defer retry mutator to Phase 99 — for this phase, just show the button disabled with "Coming soon").

**Deps:** T-8008.

---

### T-8010 — Inline subject edit

**Atlas ref:** "Edit Subject" pencil affordance.

**Plan:**
- Conversation header title becomes click-to-edit.
- Inline input with Enter to save (`ticket.update({ id, title })`), Esc to cancel.
- Pencil icon visible on hover.

**Acceptance:**
- Click title → input.
- Enter saves, Esc cancels.
- Optimistic update; row in inbox reflects new title within 1 s.

**Deps:** none.

---

### T-8011 — Hover state + active row visual

**Plan:**
- Inbox row hover: subtle bg tint, show checkbox + actions.
- Active row (currently open conversation): brighter bg + accent left border.
- Selected row (Phase 50 multi-select): different accent.

**Acceptance:**
- All three states visually distinct.
- Hover doesn't fight selected/active visually.

**Deps:** Phase 50 (T-5003).

---

## Definition of done for Phase 80

- Inbox row renders snippet, direction, channel icon, attachment icon, badges, custom fields per spec.
- Display-settings popover toggles fields and density live.
- Sort picker persists per view.
- Conversation sidebar shell hosts all Phase 10–70 widgets in clean layout.
- Inline subject edit works.
- Type-check + Biome clean; design review on inbox at 3 densities + sidebar at 2 widths.
