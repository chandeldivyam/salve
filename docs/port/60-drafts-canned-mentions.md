# Phase 60 — Drafts + Canned Responses + Mentions

## Goal

After this phase: composer text auto-saves as the agent types and survives refresh. A canned-response library lives at `/settings/canned-responses` with groups, searchable insertion in composer, and `{{variable}}` substitution. `@mention` autocomplete in the composer fires an Inngest-driven notification to the mentioned agent.

## Why now

These three are agent-productivity features that share UI surface (composer) and notification pathways. Doing them together avoids three composer rewrites.

## Atlas behavior

### Drafts

- **Backend model:** `webapp/web/conversation/models.py:196-207`.
- **Schema:** `id`, `agent_id`, `conversation_id`, `text`, `attachments` JSON, `channel` int, `sub_channel_id` UUID nullable, `message_type` ("message" | "note").
- **APIs:** `POST /drafts/{conversationId}/upsert`, `POST /drafts/{conversationId}/delete`, `GET /drafts`.
- **Frontend:** `jsapp/src/api/draft.ts`. Composer auto-saves after each keystroke with ~1 s debounce.
- **Recovery:** loaded once on app boot via `GET /drafts`; per-conversation when conversation opens.
- **Per-channel drafts:** different draft for Email vs Chat on same ticket — keyed by `(agent, conversation, channel, sub_channel)`.
- **Clear on send:** mutator deletes draft after successful send.

### Canned responses

- **Backend:** `webapp/web/canned/`. Models: `CannedResponseModel`, `CannedResponseGroupsModel`.
- **Group schema:** `id`, `company_id`, `label`, `color`, `archived`, timestamps.
- **Response schema:** `id`, `company_id`, `group_id`, `title`, `content` (HTML text), `created_by`, `archived`, `meta` JSONB, timestamps.
- **APIs:** `webapp/web/canned/apis.py` — CRUD.
- **Frontend admin:** `jsapp/src/app/app-config/canned-responses/canned-response-modal.tsx`, `canned-response-group-modal.tsx`.
- **Insertion in composer:** `jsapp/src/components/basic/composer/` — variables menu, search, click-to-insert.

### Variables in canned responses

- Atlas supports: `{{customer.firstName}}`, `{{customer.lastName}}`, `{{customer.email}}`, `{{customer.fullName}}`, `{{agent.firstName}}`, `{{agent.lastName}}`, `{{ticket.subject}}`, `{{ticket.number}}`, plus custom-field references.
- **Substitution moment:** at insert time, not at send time. Once inserted, the values are static text the agent can edit.

### Mentions

- **Composer:** `jsapp/src/components/basic/composer/mentions-menu.tsx`.
- **Trigger:** `@` in the composer pops a workspace-member combobox.
- **Storage:** mentions are inline in the rendered HTML as styled `<span class="mention" data-agent-id="...">@Name</span>`.
- **Read tracking:** `conversations.unread_mentions` ARRAY(UUID). On send, server appends mentioned agents.
- **Mark read:** `POST /conversations/mark_mentions_read/{conversationId}` clears the array for the calling agent.
- **Notifications:** mentioned agents get a notification (in-app + email per their settings).

## Schema delta

### `draft.ts` (new)

```ts
export const draftMessageTypeEnum = pgEnum("draft_message_type", ["reply", "note"]);

export const draft = pgTable("draft", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceID: uuid("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  ticketID: uuid("ticket_id").notNull().references(() => ticket.id, { onDelete: "cascade" }),
  agentID: uuid("agent_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  channelID: uuid("channel_id").references(() => channel.id, { onDelete: "set null" }),
  emailAddressID: uuid("email_address_id").references(() => emailAddress.id, { onDelete: "set null" }),
  messageType: draftMessageTypeEnum("message_type").notNull().default("reply"),
  bodyHtml: text("body_html").notNull().default(""),
  bodyText: text("body_text").notNull().default(""),
  attachments: jsonb("attachments").$type<DraftAttachment[]>().notNull().default([]),
  // mentions captured at draft level so we can pre-populate `unread_mentions` on send
  mentionedAgentIDs: jsonb("mentioned_agent_ids").$type<string[]>().notNull().default([]),
  updatedAt, createdAt,
}, (t) => [
  uniqueIndex("draft_unique_per_agent_channel").on(t.ticketID, t.agentID, t.channelID),
  index("draft_workspace_idx").on(t.workspaceID, t.agentID),
]);
```

### `canned_response.ts` (new)

```ts
export const cannedResponseGroup = pgTable("canned_response_group", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceID: uuid("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt, updatedAt,
}, (t) => [
  index("canned_group_workspace_idx").on(t.workspaceID, t.archivedAt),
]);

export const cannedResponse = pgTable("canned_response", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceID: uuid("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  groupID: uuid("group_id").references(() => cannedResponseGroup.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  shortcut: text("shortcut"),  // e.g. "thanks" for /thanks insertion
  bodyHtml: text("body_html").notNull(),
  bodyText: text("body_text").notNull(),
  createdByID: uuid("created_by_id").references(() => user.id),
  usageCount: integer("usage_count").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt, updatedAt,
}, (t) => [
  index("canned_workspace_idx").on(t.workspaceID, t.archivedAt),
  uniqueIndex("canned_shortcut_uq").on(t.workspaceID, lower(t.shortcut)).where(sql`${t.shortcut} IS NOT NULL`),
]);
```

### `ticket.ts` extensions

```ts
unreadMentionAgentIDs: jsonb("unread_mention_agent_ids").$type<string[]>().notNull().default([]),
```

## Zero queries

```ts
draftForTicket: ({ ticketID, channelID }) =>
  applyWorkspaceScope(z.query.draft)
    .where("ticketID", "=", ticketID)
    .where("agentID", "=", AUTH.sub)
    .where("channelID", "=", channelID ?? null)
    .one(),

cannedResponseGroups: () =>
  applyWorkspaceScope(z.query.cannedResponseGroup)
    .where("archivedAt", "IS", null)
    .orderBy("sortOrder", "asc"),

cannedResponses: () =>
  applyWorkspaceScope(z.query.cannedResponse)
    .where("archivedAt", "IS", null)
    .related("group")
    .orderBy("usageCount", "desc").orderBy("title", "asc"),
```

## Mutators

### `draft-mutators.ts`

- `draft.upsert({ ticketID, channelID?, messageType, bodyHtml, bodyText, attachments?, mentionedAgentIDs? })` — uses ticketID + agentID + channelID as upsert key; agentID = `AUTH.sub`.
- `draft.delete({ ticketID, channelID? })`.

### `canned-response-mutators.ts`

- Group: `cannedResponseGroup.create / update / archive`.
- Response: `cannedResponse.create / update / archive`.
- `cannedResponse.recordUsage({ id })` — increments `usageCount`. Called when a canned is inserted (not when ticket sends).

### Updates to `message.send`

- Accept `mentionedAgentIDs?: string[]`.
- On commit: append unique entries to `ticket.unreadMentionAgentIDs`.
- Server post-commit: dispatch `notifications/mention.created` Inngest event with key `mention-<messageID>-<agentID>` per mentioned agent.
- Delete `draft` row after send (best-effort, not blocking).

### `ticket.markMentionsRead({ ticketID })`

- New mutator. Removes `AUTH.sub` from `unreadMentionAgentIDs`.
- Called when an agent opens a conversation that has them in the array.

## Inngest functions

### `notifications/mention.created` listener

`apps/api/src/inngest/functions/dispatch-mention-notification.ts`:

- Step 1: load ticket, customer, message, mentioning agent, mentioned agent.
- Step 2: write a `notification` row (Phase 70 schema).
- Step 3: optional email if mentioned agent has email-on-mention setting (default off).
- Step 4: future — push to web socket / browser notification (Phase 70).

For this phase: just write the notification row; the in-app indicator goes live in Phase 70.

## UI surfaces

### Composer extensions (`apps/web/src/components/composer/`)

- Refactor existing composer in `inbox.t.$ticketId.tsx` into `apps/web/src/components/composer/composer.tsx`.
- Auto-save: on every Tiptap update, debounce 800 ms, call `draft.upsert`.
- Recovery on mount: `useQuery(draftForTicket(...))`. Empty content if no draft.
- Clear on send.
- Loading state: small "Saved" indicator in bottom-right of composer.

### Variable menu

- Tiptap extension `apps/web/src/components/composer/variable-extension.ts` registers `Cmd+{` and `@` (when at start of word).
- Pop popover with searchable variable list.
- On select: insert text node `{{customer.firstName}}` then `replaceVariables({customer, agent, ticket})` → "Jane".
- Strategy: insertion produces *literal* values (mirrors Atlas).

### Mention extension

- Different from variable menu: triggered by `@` mid-text.
- Combobox lists workspace members.
- On select: insert `<span class="mention" data-agent-id="...">@Name</span>` Tiptap node.
- Mark in draft `mentionedAgentIDs` array.

### Canned response picker

- Trigger: `Cmd+/` (or `/` at start of empty composer).
- Popover: search input + list grouped by `cannedResponseGroup`.
- Results sorted by usageCount desc within group.
- Tab/Enter inserts; arrow keys navigate.
- Insertion: `replaceVariables(canned.bodyHtml)` then `editor.insertContent(html)`.
- After insert: `cannedResponse.recordUsage({ id })`.

### Settings → Canned responses (`/settings/canned-responses`)

- Two-column: groups left, responses right.
- Inline create + drag-reorder.
- Detail panel: title, shortcut, group, body (Tiptap editor), preview.
- Variable picker in body editor.

## Tickets

### T-6001 — Draft schema + Zero queries

**Atlas ref:** `webapp/web/conversation/models.py:196-207`.

**Plan:** drizzle migration, Zero mirror, `draftForTicket` query, types.

**Acceptance:** migration applies; query returns null when no draft, hydrated row when one exists.

**Deps:** none.

---

### T-6002 — `draft.upsert` / `draft.delete` mutators

**Plan:** mutators per spec; agentID always = `AUTH.sub` (no overrides). Per-channel scoped via channelID nullable.

**Acceptance:** rapid keystroke debounced 800 ms; one row per `(ticketID, agentID, channelID)`. Delete is idempotent.

**Deps:** T-6001.

---

### T-6003 — Composer refactor + auto-save

**Atlas ref:** `jsapp/src/components/basic/composer/build-new-composer-context.tsx`, auto-save logic.

**Plan:**
- Extract composer from `inbox.t.$ticketId.tsx` into `apps/web/src/components/composer/composer.tsx`.
- Subscribe to `draftForTicket()`; hydrate Tiptap on mount.
- Debounced save on each `onUpdate`.
- "Saved" status indicator (idle / saving / saved with timestamp).
- On send (existing `message.send`), call `draft.delete` post-success.

**Acceptance:**
- Type, refresh page → text restored.
- Send → draft cleared.
- Switching tickets does not leak draft text.
- Two browsers same agent: drafts shared across tabs (intentional).

**Deps:** T-6002.

---

### T-6004 — Mention extension in Tiptap

**Atlas ref:** `jsapp/src/components/basic/composer/mentions-menu.tsx`.

**Plan:**
- Tiptap extension `apps/web/src/components/composer/mention-extension.ts`.
- Use `@tiptap/extension-mention` with custom suggestion list reading from `workspaceMembers()` query.
- Render mark: styled span with `data-agent-id`.
- On send: collect `data-agent-id` from doc → pass to `message.send` via `mentionedAgentIDs`.
- Backspace removes the whole node, not character-by-character.

**Acceptance:**
- Typing `@ja` filters to matching members.
- Selecting inserts visible chip.
- Sent message persists mention chip in body.
- Mentioned agent's `unreadMentionAgentIDs` includes their ID after send.

**Deps:** T-6003 + Phase 30 (registry for `@` trigger).

---

### T-6005 — Mark mentions read

**Plan:**
- `ticket.markMentionsRead` mutator.
- Conversation page calls it on mount if `unreadMentionAgentIDs` includes `AUTH.sub`.
- Helper hook `useMarkMentionsReadOnView(ticketID)`.

**Acceptance:**
- Open a conversation where you're mentioned: indicator clears within 1 s.
- Notification row marked read in same step (Phase 70 wires the row write).

**Deps:** T-6004.

---

### T-6006 — Mention notification Inngest pipeline

**Atlas ref:** Atlas's mention notification flow.

**Plan:**
- Server post-commit on `message.send`: for each mentioned agent, dispatch `notifications/mention.created` (key `mention-<messageID>-<agentID>`).
- Listener: writes a `notification` row (table introduced fully in Phase 70 — for this phase ship the bare table needed for mention notifications):

```ts
notification table fields:
  id, workspaceID, recipientUserID,
  kind ("mention" first), payload JSONB
  ticketID?, messageID?, mentioningUserID?,
  readAt?, createdAt
```

- For email-on-mention: defer (Phase 70 will surface the setting); for now don't email.

**Acceptance:**
- Mentioning Bob creates exactly one `notification` row for Bob.
- Bob's tab sees an unread badge (Phase 70 makes this visible; here ensure data is written).
- Idempotent: re-running the Inngest function is safe (key check).

**Deps:** T-6004.

---

### T-6007 — Variable menu + substitution helper

**Atlas ref:** `jsapp/src/components/basic/composer/variables-menu.tsx`, `replace-variables.tsx`.

**Plan:**
- Helper `apps/web/src/lib/composer/replace-variables.ts`:
  - Vars: `customer.firstName | lastName | fullName | email`, `agent.firstName | lastName | fullName | email`, `ticket.subject | number | priority | status`.
  - Custom field refs: `customer.cf:KEY`, `ticket.cf:KEY`.
  - Returns string; missing values render as `""` (not literal `undefined`).
- Tiptap extension popover triggered by `Cmd+{`.
- Reads context from current ticket / customer / current user.
- Inserts the *substituted* string at the cursor (mirrors Atlas at-insert-time substitution).

**Acceptance:**
- All built-in variables render correct values for a hydrated ticket.
- Missing custom field renders empty string, not literal placeholder.
- Cursor remains after the inserted text.

**Deps:** T-6003, Phase 10 (custom fields).

---

### T-6008 — Canned response schema + Zero mirror

**Atlas ref:** `webapp/web/canned/models.py`.

**Plan:** migration, Zero mirror, queries (`cannedResponseGroups`, `cannedResponses`).

**Acceptance:** migration applies; queries return ordered rows.

**Deps:** none.

---

### T-6009 — Canned response mutators

**Plan:** group + response CRUD + archive + recordUsage. Audit events.

**Acceptance:** create/edit/archive cycle live across windows; usageCount monotonically increases on insert.

**Deps:** T-6008.

---

### T-6010 — Canned response admin page

**Atlas ref:** `jsapp/src/app/app-config/canned-responses/`.

**Plan:**
- Route `/settings/canned-responses`.
- Two-column groups + responses.
- Detail editor with title, shortcut input, group select, Tiptap body.
- Variable picker available within the body editor (re-use T-6007 helper).
- Drag-reorder.

**Acceptance:**
- Admin can create groups, add responses, set shortcuts, archive.
- Shortcut uniqueness enforced (server-side).

**Deps:** T-6009.

---

### T-6011 — Canned response picker in composer

**Atlas ref:** Atlas composer's canned dropdown.

**Plan:**
- Tiptap extension that opens popover on `Cmd+/`.
- Search by title + body + shortcut.
- Results grouped by `cannedResponseGroup`.
- Insertion runs `replaceVariables` on `bodyHtml`.
- Increments usageCount.
- Also: shortcuts. Typing `/thanks` then space inline-replaces with that response.

**Acceptance:**
- Cmd+/ opens picker, Enter inserts, Esc closes.
- Variables substituted at insert time.
- Inline `/shortcut ` expansion works.
- Cmd+K command "Insert canned response" opens same picker.

**Deps:** T-6007, T-6010.

---

### T-6012 — Cmd+K registrations for composer features

**Plan:**
- `composer.send` ($mod+enter)
- `composer.canned` ($mod+/)
- `composer.variable` ($mod+{)
- `composer.note.toggle` ($mod+.)
- `composer.attachment` ($mod+shift+a) — placeholder until attachment polish in Phase 99

**Acceptance:** all hotkeys work in composer focus; help modal lists them.

**Deps:** T-6003, Phase 30.

---

## Definition of done for Phase 60

- Drafts auto-save and recover across refresh, scoped per agent + channel.
- Mentions chip in composer, write to ticket array, dispatch notification rows.
- Canned responses: full CRUD, picker in composer, shortcut expansion, usage tracking.
- Variable substitution in canned bodies.
- Cmd+K commands wired.
- Type-check + Biome clean; design review on composer changes + canned admin.
