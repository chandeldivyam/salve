# Phase 90 — Snooze Auto-wake + Scheduled Send + Merge + Switch Customer

## Goal

After this phase: a snoozed ticket automatically wakes back to the inbox at its scheduled time. Composing a reply lets the agent schedule the send for later. Merging two conversations consolidates messages and audit trail. Switching the customer on a conversation reassigns it to a different person without losing thread.

## Why now

These four are time-and-consolidation power features that depend on Inngest scheduling primitives (already used for delivery) and on the bulk + activity infrastructure from earlier phases. They aren't blocking anyone but they round out the helpdesk to feature-parity with Atlas.

## Atlas behavior

### Snooze auto-wake

- Atlas: `conversations.snoozed_until` is set; a background scheduler periodically checks for `snoozed_until <= now()` and flips status back to `OPEN`.
- Per `webapp/web/conversation/`.
- Atlas's reliance on a poller is the gap our Inngest-driven design closes (see `~/.claude/plans/...` for our anti-poller stance).

### Scheduled send

- Atlas message has `schedule_status` enum: `SCHEDULED (1) | QUEUED_TO_DISPATCH (2) | DISPATCHED (3)`.
- Composer UI: pick relative ("In 1 hour") or absolute datetime.
- Endpoints: `PATCH /conversation/scheduled-message`, `POST /conversation/discard-scheduled-message` (`webapp/web/conversation/apis.py` + `TicketActions.patchScheduledMessage`).
- Composer shows "Scheduled for [date]" with edit/discard.

### Merge

- Atlas: `conversations.destination_conversation_id` UUID FK.
- Endpoint: `POST /conversation/merge-conversations` (sourceId, destinationId).
- After merge: source ticket is "redirected" to destination; messages from source preserved on source but UI navigates to destination.
- Modal: `jsapp/src/components/conversations/vitals/merge-conversations/mergeConversations.tsx`.

### Switch customer

- Reassigns conversation to a different customer. All messages stay; just the `customer_id` changes.
- Use case: agent realizes a conversation was misattributed (forwarded, address typo, multi-account user).
- Atlas exposes via menu + cmd+K command.

## Schema delta

### Snooze

`ticket.snoozedUntil` was added in Phase 50 (T-5007). Nothing more.

### Scheduled send

```ts
// message.ts extension
scheduledFor: timestamp("scheduled_for", { withTimezone: true }), // null = immediate
scheduleStatus: pgEnum("message_schedule_status", ["scheduled", "queued", "dispatched"])("schedule_status"),
// dispatched on send
```

### Merge

```ts
// ticket.ts extension
mergedIntoTicketID: uuid("merged_into_ticket_id").references(() => ticket.id, { onDelete: "set null" }),
mergedAt: timestamp("merged_at", { withTimezone: true }),
mergedByID: uuid("merged_by_id").references(() => user.id),
```

Merge does NOT move message rows. Instead, when fetching a conversation's thread, we union messages from `ticketByID(id)` and any tickets with `mergedIntoTicketID === id`. This is cheap with Zero relateds.

### Switch customer

No schema change needed — `ticket.customerID` is already mutable; we just need a mutator.

## Inngest functions

### Snooze auto-wake

`apps/api/src/inngest/functions/snooze-wake.ts`:

- Triggered by `ticket/snooze.scheduled` event with `step.sleepUntil(snoozedUntil)`.
- Server post-commit on `ticket.snooze` and `bulk.snooze` dispatches the event with idempotency key `snooze-wake-<ticketID>-<snoozedUntilEpoch>`.
- After sleep: re-read ticket; if status still `snoozed` AND `snoozedUntil` unchanged → flip status to `open`, clear `snoozedUntil`, audit `ticket.unsnoozed`.
- Skip wake if status changed (manual reopen) or `snoozedUntil` updated (re-snoozed).

### Scheduled send dispatch

`apps/api/src/inngest/functions/scheduled-message-dispatch.ts`:

- Trigger: `message/send.scheduled` event with `step.sleepUntil(scheduledFor)`.
- Server post-commit on `message.scheduleSend` mutator dispatches event, idempotency `scheduled-msg-<messageID>`.
- After sleep: re-read message. If still `scheduled` AND `scheduledFor` unchanged → set status `queued`, then dispatch existing `delivery/message.requested` (the same hook that powers immediate sends). Update `dispatched`.
- Cancellation: `message.cancelScheduledSend` mutator sets status to neither — deletes message row entirely. Idempotency check inside Inngest skips on missing row.

## Mutators

### Snooze (existing) — extend

- `ticket.snooze({ id, until })` — already exists. Add Inngest dispatch.
- `bulk.snooze({ id, ticketIDs[], until })` — Phase 50, also dispatch per ticket.

### Scheduled send

`packages/mutators/src/scheduled-mutators.ts`:

- `message.scheduleSend({ id, ticketID, emailAddressID?, bodyHtml, bodyText, isInternal?, attachments?, mentionedAgentIDs?, scheduledFor })`
  - Like `message.send` but stores `scheduleStatus = "scheduled"` and `scheduledFor`. Does NOT create outbound row yet.
  - Server post-commit dispatches `message/send.scheduled`.
- `message.editScheduledSend({ id, bodyHtml?, bodyText?, scheduledFor? })` — only allowed while still `scheduled`. Re-dispatches Inngest event with new sleep target (idempotency key includes `scheduledFor`, so a fresh function run overrides).
- `message.cancelScheduledSend({ id })` — deletes the message row. Audit `message.scheduled_send_canceled`.

### Merge

`packages/mutators/src/merge-mutators.ts`:

- `ticket.merge({ sourceID, destinationID })`
  - Both must be in same workspace.
  - Source can't already be merged.
  - Source can't be the destination.
  - Updates source: `mergedIntoTicketID = destinationID`, `mergedAt`, `mergedByID = AUTH.sub`, status = `closed`.
  - Audit on both: `ticket.merged` (source: with `destinationID`; destination: with `sourceID, sourceShortID, sourceTitle`).
  - On destination: also bump `updatedAt`.
- `ticket.unmerge({ ticketID })` — clears merged columns + reopens. Audit `ticket.unmerged`.

### Switch customer

- `ticket.switchCustomer({ ticketID, customerID })` — verify customer in workspace.
- Updates `ticket.customerID`, audit `ticket.customer_switched` payload `{oldCustomerID, oldCustomerEmail, newCustomerID, newCustomerEmail}`.
- If new customer has different email: optionally also update reply-plus token salt? — No, our reply tokens are HMAC over `(workspaceID, ticketID, expiry)`, not customer-bound. No-op.

## UI surfaces

### Snooze picker (existing)

- Confirm picker has presets: 1h, 4h, Tomorrow 9am, Mon 9am, Custom.
- Existing flow already calls `ticket.snooze`. Just confirm Inngest dispatch fires.

### Scheduled send

- Composer "Send" button is a split-button. Right caret opens menu: "Send now (Cmd+Enter)", "Send later…".
- "Send later…" opens datetime picker. On confirm → `message.scheduleSend`.
- After scheduling: composer collapses to a "Scheduled for {date} · Edit · Discard" banner.
- Edit reopens composer pre-filled with the scheduled message; saving calls `editScheduledSend`.
- Discard calls `cancelScheduledSend`.

### Merge modal

- Trigger: conversation 3-dot menu "Merge conversation…" or `Cmd+M`.
- Modal: search by ticket short ID, customer email, or subject (uses `/api/search`).
- Confirmation step: "Merge #123 'Refund question' into #456 'Payment failed'? This closes #123. You can unmerge later."

### Merged-source banner

- When opening a merged source conversation, show a banner at top: "Merged into #456 · View destination". Click navigates.
- Source thread still visible (read-only — composer disabled).

### Destination merged-from indicator

- In the activity timeline of destination, show "Merged from #123 'Refund question' (3 messages)" expandable to view source thread inline.

### Switch customer modal

- Trigger: conversation 3-dot menu or `Cmd+Shift+S`.
- Modal: customer picker — combobox over `customers` (search by email/name) + "Create new customer" if no match.
- Confirmation: "Move this conversation from {old} to {new}?".

## Tickets

### T-9001 — Snooze auto-wake Inngest pipeline

**Atlas ref:** Atlas's poller-based `snoozed_until` check (we replace with Inngest sleepUntil).

**Plan:**
- New Inngest function `snooze-wake.ts` per spec.
- Server post-commit hook on `ticket.snooze` and `bulk.snooze` dispatches `ticket/snooze.scheduled` with `data: {ticketID, snoozedUntil}` and idempotency key.
- Listener uses `step.sleepUntil(data.snoozedUntil)` then re-reads + flips.
- Audit `ticket.unsnoozed` on success.
- Re-snooze cancels prior wake by virtue of new idempotency key (different `snoozedUntilEpoch`).

**Acceptance:**
- Snooze a ticket for 2 minutes. Two minutes later it appears in the open inbox without page refresh.
- Re-snoozing extends correctly.
- Manual reopen before wake → wake function exits cleanly.

**Deps:** Phase 50 (snoozedUntil column).

---

### T-9002 — Scheduled message schema + mutator

**Plan:**
- Migration adds `scheduledFor`, `scheduleStatus` to `message`.
- `message.scheduleSend` mutator.
- Server-side validation: `scheduledFor` must be ≥ now + 1 minute and ≤ now + 60 days.
- Audit `message.scheduled`.

**Acceptance:**
- Scheduling a message creates a message row with status `scheduled` but no outbound.
- Composer shows the scheduled banner.
- Past datetime rejected.

**Deps:** none.

---

### T-9003 — Scheduled message dispatch Inngest pipeline

**Plan:**
- `scheduled-message-dispatch.ts`: sleepUntil + re-read + dispatch existing delivery flow.
- Edit + cancel flows.

**Acceptance:**
- Schedule for 90 s; at T+90 the message becomes `dispatched`, outbound row created, email sent.
- Cancel before dispatch removes message row; sleep listener exits.
- Edit shifts datetime; new sleep window honored.

**Deps:** T-9002.

---

### T-9004 — Composer scheduled-send UI

**Atlas ref:** `composer.scheduling`.

**Plan:**
- Split-button send.
- Datetime picker popover.
- Scheduled banner replaces composer body until edit/discard.
- Cmd+K command `composer.schedule_send`.

**Acceptance:**
- Schedule from composer; banner shows correct relative + absolute time.
- Edit reopens; discard cleans up.
- Multiple scheduled messages on same ticket render as multiple banners (rare but supported).

**Deps:** T-9002.

---

### T-9005 — Merge schema + mutator

**Atlas ref:** `webapp/web/conversation/apis.py:merge-conversations`.

**Plan:**
- Migration adds `mergedIntoTicketID`, `mergedAt`, `mergedByID` to `ticket`.
- `ticket.merge` mutator with checks per spec.
- Audit on both source and destination.
- Update `ticketByID` query to expose `mergedIntoTicketID` related.

**Acceptance:**
- Merge two tickets; source closed + linked, destination shows audit row.
- Cycles prevented (A→B then B→A returns error).
- Cross-workspace merge rejected.

**Deps:** none.

---

### T-9006 — Conversation thread merge-aware rendering

**Plan:**
- When loading a destination ticket, also subscribe to messages from any ticket where `mergedIntoTicketID = destinationID`.
- Render merged-from messages with a header "Merged from #N" and a subtle indent.
- Source ticket page shows banner "Merged into #M · View destination".
- Composer disabled on merged-source.

**Acceptance:**
- Destination thread shows messages from both with clear demarcation.
- Source page banner navigates to destination.
- Composer correctly disabled on source.

**Deps:** T-9005.

---

### T-9007 — Merge modal

**Atlas ref:** `mergeConversations.tsx`.

**Plan:**
- Modal triggered from 3-dot menu and `Cmd+M`.
- Search-driven destination picker via `/api/search`.
- Filter out: current ticket itself, already-merged tickets.
- Confirmation step shows source/destination side-by-side.

**Acceptance:**
- Search returns relevant destinations.
- Confirm fires `ticket.merge`.
- Cancel exits modal cleanly.

**Deps:** T-9005, Phase 30 (search).

---

### T-9008 — Switch customer mutator + modal

**Atlas ref:** Atlas "Switch customer".

**Plan:**
- `ticket.switchCustomer` mutator per spec.
- Modal: customer combobox over `applyWorkspaceScope(z.query.customer)` with text filter; "Create new customer" if no match (calls `customer.create` first).
- Audit `ticket.customer_switched`.

**Acceptance:**
- Existing customer pick: customer changes, all messages preserved, sidebar reflects.
- New customer: created, then assigned.
- Cross-workspace customer rejected.

**Deps:** none.

---

### T-9009 — Cmd+K commands

**Plan:**
- `ticket.merge` ($mod+m).
- `ticket.switch_customer` ($mod+shift+s).
- `composer.schedule_send` (no default hotkey, palette-only).
- `ticket.unmerge` (palette-only).
- `message.cancel_scheduled` (palette-only when scheduled message present).

**Acceptance:** all hotkeys function in correct contexts; help modal lists.

**Deps:** T-9004, T-9007, T-9008, Phase 30.

---

### T-9010 — Activity timeline kinds for new actions

**Plan:**
- Extend `AuditKinds` with `TicketUnsnoozed`, `TicketUnmerged`, `MessageScheduled`, `MessageScheduledSendCanceled`, `MessageScheduledSendDispatched`.
- Add verb dictionary entries in `activity-row.tsx`.

**Acceptance:** these audit kinds render proper verbs in activity timeline.

**Deps:** Phase 70 (T-7006).

---

## Definition of done for Phase 90

- Snoozed tickets auto-wake at scheduled time.
- Scheduled send round-trips: schedule, edit, cancel, dispatch.
- Merge consolidates threads with clear UX on both sides; unmerge restores.
- Switch customer reassigns ticket cleanly.
- All Cmd+K commands wired.
- Activity timeline accurately reflects all new actions.
- Type-check + Biome clean; design review on composer scheduled state, merge modal, merged-thread rendering.
