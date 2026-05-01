# Phase 99 — Email Channel Polish

## Goal

After this phase: auto-responder emails (vacation replies, mailer-daemon, list-mail) are detected on inbound and either suppressed or marked correctly so they don't trigger SLA timers or notifications. Inbound attachments persist and render. Outbound MIME includes attachments. Per-address signature is wired into the envelope builder. CC/BCC works on outbound. Failed messages can be retried.

## Why last

The phase 3a/3b/3c plumbing left these as TODOs because they weren't blocking. They're refinements. They each deserve discrete attention because they touch the email envelope and inbound parser.

## Atlas behavior

### Auto-responder detection

- Atlas detects via header heuristics: `Auto-Submitted`, `Precedence: bulk|junk|list`, `X-Autoreply`, `From: mailer-daemon@`, `Return-Path: <>`.
- Detected auto-responses are stored but not surfaced in the inbox row UI; they don't reset read state, fire notifications, or pause SLA.

### Inbound attachments

- Atlas: mailparser exposes `attachments[]`; backend persists each to S3 + creates an attachment row.
- File: `webapp/web/conversation/` (inbound flow).

### Outbound attachments (MIME multipart)

- Atlas: when an outbound has attachments, the envelope is `multipart/mixed` with `multipart/alternative` (text+html) as one part and each attachment as a base64 part.

### Per-address signature

- Atlas: per-mailbox signature appended on outbound when set.
- We already have the column on `emailAddress.signature`; the envelope builder currently uses `emailChannel.signature` only.

### Reply CC

- Atlas: composer has CC/BCC fields; on reply, populates from prior message's recipients.
- Stored on outbound message metadata, included in MIME.

### Failed message retry

- Atlas: failed message → "Send Again" button calls a retry endpoint that re-creates outbound row + dispatches.

## Schema delta

### `message.ts` extensions

```ts
ccAddresses: jsonb("cc_addresses").$type<EmailRecipient[]>().notNull().default([]),
bccAddresses: jsonb("bcc_addresses").$type<EmailRecipient[]>().notNull().default([]),
inReplyToMessageID: uuid("in_reply_to_message_id").references(() => message.id, { onDelete: "set null" }),
```

`EmailRecipient = { name?: string; address: string }`.

### `inbound_message_raw` extensions

```ts
isAutoResponder: boolean("is_auto_responder").notNull().default(false),
autoResponderReason: text("auto_responder_reason"), // which heuristic matched
```

### `outbound_message` extensions

```ts
retryOfOutboundMessageID: uuid("retry_of_outbound_message_id").references(() => outboundMessage.id, { onDelete: "set null" }),
retryAttempt: integer("retry_attempt").notNull().default(0),
```

## Logic changes

### Auto-responder detection

`apps/api/src/inbound/auto-responder.ts` (new):

```ts
export function detectAutoResponder(headers: Record<string, string>, fromAddress: string): {
  isAuto: boolean;
  reason?: string;
} {
  const autoSubmitted = headers["auto-submitted"]?.toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return { isAuto: true, reason: "auto-submitted" };

  const precedence = headers["precedence"]?.toLowerCase();
  if (precedence && ["bulk","junk","list"].includes(precedence)) return { isAuto: true, reason: `precedence:${precedence}` };

  if (headers["x-autoreply"]) return { isAuto: true, reason: "x-autoreply" };
  if (headers["x-autorespond"]) return { isAuto: true, reason: "x-autorespond" };
  if (headers["x-auto-response-suppress"]) return { isAuto: true, reason: "x-auto-response-suppress" };

  // Empty Return-Path indicates bounce/system mail
  const returnPath = headers["return-path"]?.trim();
  if (returnPath === "<>" || returnPath === "") return { isAuto: true, reason: "empty-return-path" };

  // mailer-daemon style senders
  const local = fromAddress.split("@")[0]?.toLowerCase() ?? "";
  if (["mailer-daemon", "postmaster", "no-reply", "noreply", "do-not-reply", "donotreply"].includes(local)) {
    return { isAuto: true, reason: `system-sender:${local}` };
  }

  return { isAuto: false };
}
```

Apply in `apps/api/src/inngest/functions/route-inbound-message.ts` after parsing:

- Set `inboundMessageRaw.isAutoResponder` + `autoResponderReason`.
- If auto-responder AND we're about to thread into an existing ticket: still create the message (so audit trail is complete) but skip:
  - Read-state invalidation
  - SLA timer dispatch
  - Notification dispatches to assignee
- Mark the resulting `message` row with `authorType = "system"` instead of `"customer"` so timeline display can dim it.

### Inbound attachments

In `route-inbound-message.ts`:

- `parsed.attachments[]` from mailparser.
- For each: upload to S3 with key `attachments/inbound/<workspaceID>/<messageID>/<filename>`, create `attachment` row.
- Keep raw blob too (already stored in `inboundMessageRaw.rawBlobS3Key`).
- File-type allow-list / size-limit at parse time (max 25 MB per attachment, 50 MB total per message). Reject excess gracefully — store as `inboundMessageRaw.skipReason`.

### Outbound MIME with attachments

`apps/api/src/email/envelope.ts`:

- New helper `buildMultipartMixed(parts: MimePart[], boundary: string)`.
- When `message.attachments.length > 0`:
  - Outer multipart/mixed.
  - First part: existing multipart/alternative (text + html).
  - Each attachment: `Content-Type: <mime>; name="<filename>"`, `Content-Transfer-Encoding: base64`, `Content-Disposition: attachment; filename="<filename>"`, body base64-encoded.
- Stream from S3 via signed GET; base64 encode in memory (limit 25 MB).
- Inline images (referenced via `cid:`) → `Content-Disposition: inline` + `Content-ID: <cid>`.

### Per-address signature

In `envelope.ts`, prefer `emailAddress.signature` over `emailChannel.signature` when set. Fall back to channel default.

### CC/BCC

- Composer accepts CC/BCC inputs.
- Mutator `message.send` accepts `ccAddresses[]`, `bccAddresses[]`.
- Server post-commit + envelope builder include them in headers (CC visible in MIME, BCC delivered without header).

### Reply CC pre-fill

- When opening composer for reply, pre-fill CC from the latest inbound message's CC addresses (excluding our own addresses).
- "Reply all" button explicitly includes them; "Reply" excludes.

### Failed message retry

- New mutator `message.retry({ messageID })`:
  - Reads the existing message + its outbound row.
  - Creates new outbound row with `retryOfOutboundMessageID`, `retryAttempt = N+1`.
  - Dispatches `delivery/message.requested` with new key `msg-retry-<outboundID>-<retryAttempt>`.
- UI: failed message in thread shows "Retry" button. Sidebar email-metadata block also surfaces retry.

## Tickets

### T-9901 — Auto-responder detection

**Atlas ref:** Atlas auto-responder header checks.

**Plan:**
- New `apps/api/src/inbound/auto-responder.ts` with `detectAutoResponder` per spec.
- Wire into `route-inbound-message.ts` between parse and thread.
- Schema: `isAutoResponder`, `autoResponderReason` on `inboundMessageRaw`.
- When detected: still create message + `authorType = "system"`; skip read invalidation, SLA timer dispatch, assignment notification.

**Acceptance:**
- Vacation reply detected → no notifications fire, SLA timer not reset.
- Detection log lists the matching heuristic.
- Genuine human reply not falsely flagged.

**Deps:** none.

---

### T-9902 — Inbound attachments persistence

**Plan:**
- In `route-inbound-message.ts`, for each `parsed.attachments[]`:
  - Validate size + mime allow-list.
  - Upload to S3.
  - Create `attachment` row linked to message.
- Update `ticket.hasAttachments` (Phase 80 column) to true.
- Update conversation thread to render inbound attachments identically to outbound.

**Acceptance:**
- Inbound with PDF + image: both attached and downloadable.
- Inbound exceeding 25 MB rejected with clear `skipReason`.
- `hasAttachments` flips correctly.

**Deps:** Phase 80 (T-8001 for `hasAttachments`).

---

### T-9903 — Outbound attachments MIME

**Plan:**
- Update `envelope.ts` to support multipart/mixed.
- Stream from S3 via signed GET.
- Base64 encode + chunk per RFC 5322 (76 char lines).
- Test: send email with one PDF + one PNG, receive in Mailpit, verify both present and decode correctly.

**Acceptance:**
- Mailpit delivery shows both attachments on the message.
- File size correct (no base64 over-/under-encoding).
- Inline image referenced via `cid:` renders inline.

**Deps:** none.

---

### T-9904 — Per-address signature wiring

**Plan:**
- In `envelope.ts`, when building From: + signature, prefer `emailAddress.signature` if set.
- Update settings UI (`/settings/channels/email/addresses`) signature editor to actually persist and preview.

**Acceptance:**
- Outbound sent from `support@` includes per-address signature; from `comms@` includes its own; default falls back to channel.

**Deps:** none.

---

### T-9905 — CC + BCC fields on outbound

**Plan:**
- Migration: `ccAddresses`, `bccAddresses` on `message`.
- Composer UI: collapsible CC/BCC fields, chip input.
- Mutator `message.send` accepts arrays; envelope builder includes CC in headers, sends to BCC without header.
- Validation: comma-separated, RFC 5321 address parsing.

**Acceptance:**
- Reply with CC shows CC in delivered email; thread on customer side includes CCs in headers.
- BCC delivered, not visible in headers.
- Empty arrays = no header.

**Deps:** none.

---

### T-9906 — Reply / Reply-all CC pre-fill

**Plan:**
- Composer "Reply" button: open empty CC.
- Composer "Reply all" button: pre-fill CC from latest inbound's `cc` + `to` (minus our own addresses + the customer's primary).
- Toggle visible only when latest inbound has CCs.

**Acceptance:**
- Reply all to a 3-recipient inbound includes the other 2 in CC.
- Reply only goes to primary customer.

**Deps:** T-9905.

---

### T-9907 — Inbound CC capture

**Plan:**
- During inbound parse, persist CC addresses on the resulting `message` row.
- Update conversation thread display to show "to John, cc Sarah, Bob" line under inbound message header.

**Acceptance:**
- 3-recipient inbound shows all three in metadata.
- Reply-all uses these.

**Deps:** T-9905.

---

### T-9908 — Failed message retry

**Plan:**
- Migration: `retryOfOutboundMessageID`, `retryAttempt` on `outboundMessage`.
- Mutator `message.retry({ messageID })` per spec.
- UI: "Retry" button on failed message in thread + in sidebar email-metadata block.
- Retry attempt cap (e.g., 5) — beyond which only manual retry, never automatic.

**Acceptance:**
- Click retry on a bounced message → new outbound row + Inngest dispatch.
- Successful retry updates UI to show "delivered (retry 1)".
- Idempotent if same key dispatched twice.

**Deps:** none.

---

### T-9909 — In-reply-to linkage on stored messages

**Plan:**
- Migration: `inReplyToMessageID` on `message`.
- Set on inbound: lookup by RFC `In-Reply-To` against existing messages.
- Set on outbound: most-recent prior agent or customer message.
- Conversation thread: indent replies under their parent (subtle — 1 level only).

**Acceptance:**
- Thread visually shows reply chains.
- `In-Reply-To` header on outbound matches stored linkage.

**Deps:** none.

---

### T-9910 — Inline images in outbound

**Plan:**
- When agent pastes/embeds an image in Tiptap, store it as attachment + reference via `cid:` in HTML.
- Envelope builder handles inline parts.

**Acceptance:**
- Pasted screenshot in composer → received email shows the image inline (not as attachment).

**Deps:** T-9903.

---

## Definition of done for Phase 99

- Auto-responders detected and de-noised.
- Inbound attachments persist + render.
- Outbound includes attachments + per-address signature + CC/BCC.
- Reply-all logic correct.
- Failed messages retryable.
- Inline images work.
- Type-check + Biome clean; manual end-to-end test via Mailpit covering all flows.
