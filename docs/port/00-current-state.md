# Current state — what already exists in salve

Snapshot as of slice 3.5 (commit `6bb8c90`). Use this as the "do not rebuild" reference when scoping new tickets.

## Schema (Drizzle source of truth — `packages/db/src/schema/`)

### Domain tables (`domain.ts`)
- `workspace` (mapped to better-auth `organization`)
- `customer` — email, name, displayName, avatarUrl, alternateEmails (JSONB array). Unique `(workspace_id, email)`. Lines 51–74.
- `ticket` — title, description, status enum (`open|in_progress|snoozed|resolved|closed`), priority enum (`low|normal|high|urgent`), shortID (per-workspace incrementing via Postgres trigger), customerID, assigneeID, timestamps, createdByID, closedByID. Indexes: inbox `(workspace, status, updatedAt)`, assignee `(workspace, assignee, status)`, shortID unique. Lines 76–114.
- `message` — authorType enum (`customer|agent|system`), authorUserID, authorCustomerID, bodyHtml, bodyText, isInternal. Index `(ticket, createdAt)`. Lines 116–139.
- `attachment` — s3Key, filename, mimeType, sizeBytes, messageID FK. Lines 141–160.
- `auditEvent` — free-form `kind`, JSONB payload, actorId. Lines 162–181.
- `outbox` — Phase 2b legacy, no runtime use. Lines 183–204.

### Email tables (`email.ts`)
- `channel` — polymorphic kind (`email|chat|whatsapp|sms|instagram|facebook|api_webhook`), name, isDefault, JSONB config, soft-delete. Lines 70–93.
- `sendingDomain` — DKIM tokens, mail-from subdomain, dnsStatus + dmarcStatus enums, SES identity ARN. Lines 98–125.
- `emailChannel` — sendingDomainID, fromName, signature, defaultPriority, threadingPrefs JSONB, newTicketAfterClosedDays. Lines 127–147.
- `emailAddress` — localPart, fullAddress (globally unique), canSend / canReceive / isDefault, defaultTeamID (Phase 4 placeholder), per-address signature, label. Lines 149–185.
- `outboundMessage` — status enum, providerMessageID, providerMeta, messageID + ticketID FK. Unique on messageID. Lines 187–224.
- `inboundMessageRaw` — raw S3 blob ref, processed/skipped states, headers, envelope-to, authResults JSONB. Lines 226–285.
- `inboundRoutingRule` — sender + subject patterns, assign team / agent, set priority, eval order. Lines 287–327.
- `suppression` — bounce / complaint / manual / unsubscribe target. Lines 329–349.
- `webhookEvent` — SES bounce/complaint payloads. Lines 351–369.
- `customerChannelIdentity` — per-channel external identifier (e.g., WhatsApp phone). Lines 371–399.

## Live queries (`packages/zero-schema/src/queries.ts`)

| Query | Args | Returns | Auth |
|---|---|---|---|
| `ticketByID` | `{id}` | one ticket + customer + assignee + messages (+ attachments + outbound + inbound) | workspace-scoped via `applyTicketRead` |
| `inboxOpen` | – | open/in_progress/snoozed tickets, ordered updatedAt DESC, id DESC | workspace-scoped |
| `myTickets` | – | tickets where assignee = auth.sub | workspace-scoped, empty if no auth |
| `ticketCountByStatus` | – | raw rows for client-side count grouping | workspace-scoped |
| `workspaceMembers` | – | better-auth member + user join | workspace-scoped |
| `sendingDomains` / `sendingDomainByID` | – / `{id}` | domains list / one | workspace-scoped |
| `sendableEmailAddresses` / `receivableEmailAddresses` | – | addresses with canSend / canReceive | workspace-scoped |
| `inboundRoutingRules` | – | rules in eval order | workspace-scoped |
| `suppressions` | – | suppression list | workspace-scoped |
| `outboundMessagesByTicket` / `inboundMessagesByTicket` | `{id}` | delivery rows / raw inbound rows | workspace-scoped |

## Mutators (`packages/mutators/src/index.ts`)

- `ticket.create` — also upserts customer via `findOrCreateCustomerByEmail`. Lines 157–205.
- `ticket.update` — title / description / priority. Lines 207–234.
- `ticket.assign` — verifies assignee is in workspace `member` table. Lines 236–277.
- `ticket.snooze` — sets status to `snoozed` with `until` epoch_ms in audit payload. Lines 279–299.
- `ticket.close` / `ticket.reopen` — closedAt + closedByID stamping. Lines 301–346.
- `message.send` — creates message + attachment rows, bumps ticket.updatedAt, stamps firstResponseAt on first agent reply. Server post-commit (`apps/api/src/server-mutators.ts:45-92`) inserts `outboundMessage` row + dispatches `delivery/message.requested` Inngest event with key `msg-req-<messageID>`. Lines 350–414.

## Inbox UX (`apps/web/src/components/inbox-list.tsx`)

- Hardcoded view tabs: `all | unassigned | mine | resolved` (lines 64–69).
- Client-side text match on title + customer email + customer name (lines 84–104).
- Sort: updatedAt DESC, id DESC (Zero query).
- Hotkeys bound on list container: `j` / `k` / arrows / Enter / `e` (close). Lines 121–162.
- Virtualized via `@tanstack/react-virtual`, full dataset in memory. Lines 114–119.
- No bulk select, no command palette, no custom views.

## Conversation view (`apps/web/src/routes/app/inbox.t.$ticketId.tsx`)

- Header: customer email, ticket #shortID, title.
- Status / Priority / Assignee dropdowns inline in header.
- 3-dot menu: snooze 24h, close, open in new tab.
- Thread: ordered oldest → newest, attachments, SPF/DKIM/DMARC badges per inbound, delivery badge per outbound.
- Tiptap composer: HTML + text, drag-drop S3 upload via `/api/files/presign`, isInternal toggle, sendable email-address picker.

## Settings (already shipped)

- `/app/settings/channels/email` — tabbed.
- `/app/settings/channels/email/domains` — add/verify, DKIM rows, DMARC status.
- `/app/settings/channels/email/addresses` — local part + full address, canSend / canReceive, label, per-address signature.
- `/app/settings/channels/email/routing` — rules with sender/subject patterns, assignment, priority.
- `/app/settings/channels/email/suppressions` — list + manual entries.

## UX primitives (`apps/web/src/components/`)

- `feedback-toasts.tsx` + `lib/feedback.ts` — toast emitter.
- `route-feedback.tsx` — inline route loading / error.
- `theme-switcher.tsx` — light/dark.
- Zero hooks via `lib/zero.ts` (`useZero`, `useQuery`).

## Email subsystem (`apps/api/src/email/`, `apps/api/src/inngest/`)

- `envelope.ts` — RFC 5322 builder: From, To, Subject (multi-pass Re:/Fwd: stripping in 20+ langs), Message-ID, In-Reply-To, References (capped at 30), List-Id, List-Unsubscribe + RFC 8058 One-Click, X-Workspace-ID, X-Ticket-ID, Feedback-ID, multipart/alternative.
- `reply-token.ts` — HMAC-SHA256 reply-plus tokens with 12-char base64url sig (~72 bits), 90-day TTL, timing-safe verify.
- `inngest/functions/route-inbound-message.ts` — mailparser parses S3 blob, normalizes, threads via 6-layer logic, creates message + ticket rows.

## Phases delivered

- 0 monorepo scaffold
- 1 auth + workspace bootstrap
- 2a domain schema + Zero sync
- 2b zbugs-aligned mutators
- 2c inbox + ticket detail + composer + S3 attachments
- 3a polymorphic outbound delivery + email channel/domain/address settings + reply-plus tokens
- 3 (3.5 slice) inbound routing logic + email settings polish + dev-gate + signature + DNS post-verify

## Known gaps the port plan covers

Tags, custom fields, customer profile / timeline, custom inbox views, cmd+K, drafts, canned responses, mentions, read/unread, notifications, activity timeline, inbox row polish (snippet, direction badge, attachment icon), bulk actions, soft delete, snooze auto-wake, scheduled send, merge, SLA, teams, shifts, auto-responder detection, attachment MIME, per-address signature wiring.
