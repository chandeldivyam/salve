# Phase 10 — Tags + Custom Fields

## Goal

After this phase: an admin can define tags and custom fields, agents can apply them to tickets and customers from the conversation sidebar, and inbox rows can show them. Tags and custom fields become primitives that later phases (custom views, bulk actions, inbox-row polish) build on.

## Why first

Custom views (Phase 40), bulk actions (50), and row polish (80) all reference tags and custom fields. Without these, those phases collapse into rebuilding the inbox a second time.

## Atlas behavior

### Tags (Atlas)

- **Backend:** `webapp/web/tag/` — `models.py` (`TagModel`, `TagGroupModel`), `schemas.py`, `services.py`, `repositories.py`, `apis.py` (`GET /tags`, `POST /tags`, `PUT /tags/{id}`, `DELETE /tags/{id}`).
- **Storage:** `conversations.tags` is `ARRAY(UUID)` (indexed). Tag IDs stored — labels can be renamed without data migration.
- **`TagModel` columns:** `id`, `company_id`, `label`, `group_id?`, `archived`, timestamps.
- **`TagGroupModel` columns:** `id`, `company_id`, `label`, `color` (hex), `archived`, timestamps.
- **Tag-on-ticket mutations (REST):**
  - `POST /conversation/add-tags` — `{conversationIds[], tagIds[]}` (additive)
  - `POST /conversation/change-tags` — `{conversationIds[], tagIds[]}` (replaces full set)
- **Frontend:**
  - Model: `jsapp/src/models/tag.ts`
  - Store: `jsapp/src/stores/tags-store.ts` (loaded once on app boot)
  - Sidebar widget: `jsapp/src/components/conversations/vitals/tags/ConversationTags.tsx` — multi-select dropdown with add/remove, group color, quick-create
  - Admin UI: `jsapp/src/app/app-config/tags/`
  - Filter operator: `jsapp/src/app/app-config/custom-fields/fieldOperators.tsx`
- **Display rules:**
  - Sidebar: full multi-select widget grouped by tag-group with color swatches.
  - Inbox row: subset of tag badges (most-recently-added first), with overflow `+N` chip.
  - Admin: tag cloud with usage counts.

### Custom Fields (Atlas)

- **Backend:** `webapp/web/custom_fields/` — `models.py:8-31` (`CustomFieldModel`), `schemas.py:12-27` (type enum + Pydantic), `services.py`, `apis.py`.
- **`CustomFieldModel` columns:**
  - `id`, `company_id` (indexed)
  - `key` (programmatic, e.g. `customer_tier`)
  - `display_name`, `description?`
  - `category` (`customer | ticket | account`)
  - `type` (matches the enum below)
  - `field_metadata` (`ARRAY(String)` — list-type options like `["Gold","Silver","Bronze"]`)
  - `dynamic_field_metadata` (JSONB — config for fields whose options come from an external API)
  - `required` (bool), `editable_by` (`ARRAY(String)`: `["api","admin","agents","sdk"]`), `active` (bool)
  - `rules` (JSONB — conditional logic), `depends_on` (JSONB)
  - `default_value` (JSONB)
- **Unique:** `(key, company_id, category)`.
- **Field types** (from `schemas.py:12-27`):
  - `Text`, `Number` (int), `Decimal` (float), `Boolean`, `Date`
  - `List` (single-select), `MultiSelect`
  - `Agent`, `Customer`, `Ticket`, `Account` (entity refs)
  - `URL` (`{url, title}`), `Address` (`{street1,street2,city,state,zip,country}`)
  - `DynamicList`, `DynamicMultiSelect` (options from external API)
- **Conditional visibility (`schemas.py:192-200+`):** `CustomFieldRuleCondition` with `{field, operator, value}`. Example: "Show *Shipping Address* only if *Country* is USA".
- **Storage of values:** `conversations.custom_fields` is JSONB with GIN index. Atlas stores values keyed by field `key` (not field id).
- **Frontend:**
  - Admin: `jsapp/src/app/app-config/custom-fields/` — schema editor, options editor, conditional rule builder.
  - Display widgets: `jsapp/src/components/custom-fields/`
  - Sidebar field rendering: `jsapp/src/components/conversations/conversation-list-item/ConversationCustomFields.tsx`
  - Filter operators: `jsapp/src/app/app-config/custom-fields/fieldOperators.tsx`
  - Serialize / deserialize: `jsapp/src/app/app-config/custom-fields/serializer.tsx`
  - API client: `jsapp/src/api/custom-fields.ts`
- **Bulk update endpoint:** `POST /conversation/update_custom_fields` — `{conversationIds[], updates: {key: value}[]}`.

## Schema delta (Drizzle, `packages/db/src/schema/`)

### `tag.ts` (new file)

```ts
export const tagGroup = pgTable("tag_group", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceID: uuid("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  color: text("color").notNull(), // hex, e.g. "#3B82F6"
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt, updatedAt,
}, (t) => [
  index("tag_group_workspace_idx").on(t.workspaceID, t.archivedAt),
]);

export const tag = pgTable("tag", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceID: uuid("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  groupID: uuid("group_id").references(() => tagGroup.id, { onDelete: "set null" }),
  label: text("label").notNull(),
  color: text("color"), // overrides group color when set
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt, updatedAt,
}, (t) => [
  uniqueIndex("tag_workspace_label_uq").on(t.workspaceID, lower(t.label)),
  index("tag_group_idx").on(t.groupID),
]);

export const ticketTag = pgTable("ticket_tag", {
  ticketID: uuid("ticket_id").notNull().references(() => ticket.id, { onDelete: "cascade" }),
  tagID: uuid("tag_id").notNull().references(() => tag.id, { onDelete: "cascade" }),
  workspaceID: uuid("workspace_id").notNull(), // denormalized for Zero scope
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  addedByID: uuid("added_by_id").references(() => user.id),
}, (t) => [
  primaryKey({ columns: [t.ticketID, t.tagID] }),
  index("ticket_tag_tag_idx").on(t.tagID),
  index("ticket_tag_workspace_idx").on(t.workspaceID),
]);

export const customerTag = pgTable("customer_tag", {
  customerID: uuid("customer_id").notNull().references(() => customer.id, { onDelete: "cascade" }),
  tagID: uuid("tag_id").notNull().references(() => tag.id, { onDelete: "cascade" }),
  workspaceID: uuid("workspace_id").notNull(),
  addedAt, addedByID,
}, (t) => [
  primaryKey({ columns: [t.customerID, t.tagID] }),
  index("customer_tag_tag_idx").on(t.tagID),
]);
```

**Decision:** join tables instead of `ARRAY(UUID)` like Atlas. Reason: Zero relates poorly with Postgres arrays; join tables let us define a Zero relationship and stream tag rows into the conversation sidebar live.

### `custom_field.ts` (new file)

```ts
export const customFieldCategoryEnum = pgEnum("custom_field_category", ["ticket", "customer"]);
// 'account' deferred — we don't have an account entity yet.

export const customFieldTypeEnum = pgEnum("custom_field_type", [
  "text", "number", "decimal", "boolean", "date",
  "list", "multi_select",
  "agent", "customer", "ticket",
  "url", "address",
  "dynamic_list", "dynamic_multi_select",
]);

export const customField = pgTable("custom_field", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceID: uuid("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  key: text("key").notNull(), // programmatic, e.g. "customer_tier"
  displayName: text("display_name").notNull(),
  description: text("description"),
  category: customFieldCategoryEnum("category").notNull(),
  type: customFieldTypeEnum("type").notNull(),
  required: boolean("required").notNull().default(false),
  active: boolean("active").notNull().default(true),
  options: jsonb("options").$type<string[]>().notNull().default([]), // list types
  dynamicConfig: jsonb("dynamic_config"), // dynamic_* types
  defaultValue: jsonb("default_value"),
  rules: jsonb("rules"), // conditional visibility
  dependsOn: jsonb("depends_on").$type<string[]>().notNull().default([]),
  editableBy: jsonb("editable_by").$type<("api"|"admin"|"agent"|"sdk")[]>().notNull().default(["agent","admin"]),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt, updatedAt,
}, (t) => [
  uniqueIndex("custom_field_key_uq").on(t.workspaceID, t.category, t.key),
  index("custom_field_active_idx").on(t.workspaceID, t.category, t.active),
]);

export const customFieldValue = pgTable("custom_field_value", {
  id: uuid("id").primaryKey().defaultRandom(),
  fieldID: uuid("field_id").notNull().references(() => customField.id, { onDelete: "cascade" }),
  workspaceID: uuid("workspace_id").notNull(),
  ticketID: uuid("ticket_id").references(() => ticket.id, { onDelete: "cascade" }),
  customerID: uuid("customer_id").references(() => customer.id, { onDelete: "cascade" }),
  value: jsonb("value"), // shape depends on field.type
  updatedByID: uuid("updated_by_id").references(() => user.id),
  createdAt, updatedAt,
}, (t) => [
  uniqueIndex("custom_field_value_ticket_uq").on(t.fieldID, t.ticketID),
  uniqueIndex("custom_field_value_customer_uq").on(t.fieldID, t.customerID),
  index("custom_field_value_ticket_idx").on(t.ticketID),
  index("custom_field_value_customer_idx").on(t.customerID),
  check("custom_field_value_one_target", sql`(ticket_id IS NOT NULL)::int + (customer_id IS NOT NULL)::int = 1`),
]);
```

**Decision:** separate `custom_field_value` table instead of `conversations.custom_fields JSONB` (Atlas's choice). Reason: Zero needs entity rows to relate; storing values as a related entity makes them stream into the sidebar live. Trade-off: one extra row per value per ticket. At our expected scale this is fine.

### Migration order

1. New file `packages/db/src/migrations/00XX_tags.sql` — drizzle generate.
2. New file `00XY_custom_fields.sql`.
3. Re-run logical replication catch-up (Zero picks up new tables).

## Zero schema mirror (`packages/zero-schema/src/`)

Add to `tables.ts`:

```ts
export const tagGroup = createTableSchema({ ... });
export const tag = createTableSchema({ relationships: { group: tagGroup } });
export const ticketTag = createTableSchema({ relationships: { tag, ticket, addedBy: user } });
export const customerTag = createTableSchema({ ... });
export const customField = createTableSchema({ ... });
export const customFieldValue = createTableSchema({ relationships: { field: customField } });
```

Wire into `ticket` relationships: `tags: ticketTag.via("ticketID")`, `customFieldValues: customFieldValue.via("ticketID")`.
Wire into `customer` relationships: `tags: customerTag.via("customerID")`, `customFieldValues: customFieldValue.via("customerID")`.

## Zero queries (`packages/zero-schema/src/queries.ts`)

```ts
tagGroups: () => applyWorkspaceScope(z.query.tagGroup)
  .where("archivedAt", "IS", null)
  .orderBy("sortOrder", "asc").orderBy("id", "asc"),

tags: () => applyWorkspaceScope(z.query.tag)
  .where("archivedAt", "IS", null)
  .related("group")
  .orderBy("sortOrder", "asc").orderBy("label", "asc"),

customFieldsByCategory: ({ category }) =>
  applyWorkspaceScope(z.query.customField)
    .where("category", "=", category)
    .where("active", "=", true)
    .orderBy("sortOrder", "asc").orderBy("displayName", "asc"),
```

Extend `ticketByID` to `.related("tags", q => q.related("tag", t => t.related("group")))` and `.related("customFieldValues", q => q.related("field"))`.

## Mutators (`packages/mutators/src/`)

New `tag-mutators.ts`:

- `tagGroup.create({ id, label, color, sortOrder })`
- `tagGroup.update({ id, label?, color?, sortOrder? })`
- `tagGroup.archive({ id })`
- `tag.create({ id, groupID?, label, color?, sortOrder })`
- `tag.update({ id, groupID?, label?, color? })`
- `tag.archive({ id })`
- `tag.attachToTicket({ ticketID, tagID })` — emits audit `ticket.tag_added`
- `tag.detachFromTicket({ ticketID, tagID })` — audit `ticket.tag_removed`
- `tag.replaceOnTicket({ ticketID, tagIDs[] })` — audit `ticket.tags_replaced`
- `tag.attachToCustomer({ customerID, tagID })`
- `tag.detachFromCustomer({ customerID, tagID })`

New `custom-field-mutators.ts`:

- `customField.create({ id, key, displayName, category, type, options?, ... })`
- `customField.update(...)` — non-key, non-type changes only (changing type breaks existing values)
- `customField.archive({ id })` — flips `active=false`
- `customField.setValueOnTicket({ id, fieldID, ticketID, value })` — upserts into `customFieldValue`, audit `ticket.field_set`
- `customField.setValueOnCustomer({ id, fieldID, customerID, value })`
- `customField.clearValueOnTicket({ fieldID, ticketID })`

Server-side validation in `apps/api/src/server-mutators.ts`:

- Validate `value` against `customField.type` + `options` + `required` rules.
- For entity-ref types, verify referenced entity is in same workspace.
- For dynamic_* types, accept any string (we don't validate against external API on write).

## UI surfaces

### Settings → Tags (`apps/web/src/routes/app/settings.tags.tsx`)

- Group rail on left, ungrouped tags at bottom.
- Inline create-group + create-tag affordances.
- Drag-reorder within group (sortOrder).
- Color picker per group; tag overrides optional.
- Archive (soft delete) with restore.

### Settings → Custom Fields (`apps/web/src/routes/app/settings.custom-fields.tsx`)

- Tab strip: Ticket fields / Customer fields.
- Field list with type badge, required indicator, active toggle.
- Detail panel: key, display name, description, type, options (for list types), required, conditional rules (Phase 10.5 — basic equals only; full rule builder later).
- "Test" preview showing what the input looks like.

### Conversation sidebar widgets (`apps/web/src/components/conversation-sidebar/`)

This phase introduces the sidebar (it doesn't exist yet — see Phase 80 for shared shell). For now, ship two stand-alone widgets that the existing conversation header can host:

- `<TagsField ticketId={...} />` — multi-select pill cluster, type-ahead, "+ tag" affordance, inline create.
- `<CustomFieldsBlock ticketId={...} />` — renders one input per active ticket-category field. Honors conditional `rules` for visibility.

### Inbox row (light touch this phase)

- Show up to 3 tag pills inline before the timestamp; `+N` chip on overflow.
- Custom fields not shown in row yet — that's Phase 80's display-settings popover.

## Tickets

### T-1001 — Tag schema migration

**Atlas ref:** `webapp/web/tag/models.py` (`TagModel`, `TagGroupModel`).

**Plan:**
- Add `packages/db/src/schema/tag.ts` with `tagGroup`, `tag`, `ticketTag`, `customerTag` tables (see schema delta above).
- Run `pnpm db:generate` for migration. Inspect generated SQL.
- Mirror in `packages/zero-schema/src/tables.ts` with `createTableSchema`.
- Add to `packages/zero-schema/src/schema.ts` `tables` array.
- Wire `tags` relationship on `ticket` and `customer` mirrors.

**Acceptance:**
- Drizzle migration applies cleanly to a fresh db.
- `pnpm typecheck` green.
- Zero replicates the new tables (visible in `pg_replication_slots` + zero-cache logs on dev startup).
- Shape exported from `@salve/zero-schema` exposes `tag`, `tagGroup`, `ticketTag`.

**Deps:** none.

---

### T-1002 — Tag mutators

**Atlas ref:** `webapp/web/conversation/apis.py` (`POST /conversation/add-tags`, `POST /conversation/change-tags`); `jsapp/src/api/tags.ts`.

**Plan:**
- Add `packages/mutators/src/tag-mutators.ts` covering tagGroup CRUD + archive, tag CRUD + archive, attach/detach/replace on ticket and customer.
- Mirror `zbugs` patterns from `/tmp/zero-mono/apps/zbugs/shared/mutators.ts`.
- Audit events: `ticket.tag_added`, `ticket.tag_removed`, `ticket.tags_replaced`, `customer.tag_added`, `customer.tag_removed`. Payload: `{tagID, tagLabel}` (snapshot label so audit is readable after rename).
- Server post-commit: none (no Inngest dispatch).
- Assertion: `assertCanModifyTicket` for ticket-side; `assertCanModifyCustomer` (new) for customer-side.

**Acceptance:**
- Optimistic add/remove on a ticket appears instantly in any other open client.
- `auditEvent` rows visible after each call.
- Reattaching same tag is a no-op (handled in mutator).
- Replacing tags is atomic — no flicker of empty state.

**Deps:** T-1001.

---

### T-1003 — Tag admin page (`/settings/tags`)

**Atlas ref:** `jsapp/src/app/app-config/tags/`; sidebar widget patterns at `jsapp/src/components/conversations/vitals/tags/ConversationTags.tsx`.

**Plan:**
- New route `apps/web/src/routes/app/settings.tags.tsx`.
- Component: two-column layout. Left: group list + ungrouped section. Right: detail panel for selected group/tag.
- Use `tagGroups()` and `tags()` Zero queries.
- Inline edit for label, color, sortOrder.
- Archive button → `tag.archive` mutator. Show archived in collapsed section with "Restore".
- Drag-reorder via `@dnd-kit/sortable` (keep deps minimal — check if we already have it).
- Add link in `apps/web/src/routes/app/settings.tsx` nav.

**Acceptance:**
- Create group → create tag in group → reorder → archive → restore, all live across two browsers.
- Form validation: label non-empty, color is hex.
- Empty state: "No tags yet. Create your first tag group."

**Deps:** T-1002.

---

### T-1004 — Tag widget on conversation

**Atlas ref:** `jsapp/src/components/conversations/vitals/tags/ConversationTags.tsx`.

**Plan:**
- New component `apps/web/src/components/conversation/tags-field.tsx`.
- Pill cluster with current tags (group color background, label).
- Type-ahead combobox to add: filter `tags()` by query, group results under group label.
- Inline "+ create tag" if query doesn't match — opens small modal that calls `tag.create` then immediately attaches.
- Per-pill remove on hover.
- Mount in conversation header next to assignee dropdown for now (sidebar shell arrives in Phase 80).

**Acceptance:**
- Adding/removing reflects in row tag count instantly across windows.
- Keyboard: focus pills, Backspace removes last, Enter on highlighted suggestion adds.
- Combobox respects archived: archived tags hidden.

**Deps:** T-1002, T-1003.

---

### T-1005 — Tag badges in inbox row

**Atlas ref:** `jsapp/src/components/conversations/conversation-list-item/ConversationListItem.tsx` (look at the tag rendering block).

**Plan:**
- Update `apps/web/src/components/inbox-list.tsx` row.
- Render up to 3 pills (sorted by `addedAt` desc), then `+N` chip.
- Pull from the existing `inboxOpen()` query — extend it with `.related("tags", q => q.related("tag", t => t.related("group")))`.
- Pill: 18px height, 10px font, group color background at 12% opacity, group color text. Use existing brand tokens.

**Acceptance:**
- Adding a tag from the conversation panel updates the row badge live.
- Empty state (no tags) shows nothing.
- Overflow `+N` is keyboard-focusable, tooltip lists hidden tags.

**Deps:** T-1004.

---

### T-1006 — Custom field schema migration

**Atlas ref:** `webapp/web/custom_fields/models.py:8-31`, `schemas.py:12-27`.

**Plan:**
- Add `packages/db/src/schema/custom_field.ts` per the schema delta above.
- Two enums (`custom_field_category`, `custom_field_type`).
- Tables: `customField`, `customFieldValue`.
- Mirror in Zero schema. Wire `customFieldValues` relationship on `ticket` and `customer`.
- Generate migration, apply.

**Acceptance:**
- Migration applies clean.
- Constraint check `custom_field_value_one_target` enforced (insert with both ticketID and customerID = 0 fails).
- Zero replicates.

**Deps:** none (parallel with T-1001).

---

### T-1007 — Custom field mutators

**Atlas ref:** `webapp/web/custom_fields/services.py`, `webapp/web/conversation/apis.py:update_custom_fields`.

**Plan:**
- `packages/mutators/src/custom-field-mutators.ts`.
- Mutators: `customField.create / update / archive`, `customField.setValueOnTicket / clearValueOnTicket`, `customField.setValueOnCustomer / clearValueOnCustomer`.
- Validation helper `validateCustomFieldValue(field, value)` shared between client and server. Type-by-type:
  - `text` → string, length ≤ 4096
  - `number` → integer, optional min/max from `dynamicConfig`
  - `decimal` → finite number
  - `boolean` → boolean
  - `date` → ISO date string
  - `list` → string in `options`
  - `multi_select` → string[] subset of `options`
  - `agent` → uuid in workspaceMember
  - `customer` / `ticket` → uuid in workspace + matching entity
  - `url` → `{url: string, title?: string}`
  - `address` → `{street1, street2?, city, state, zip, country}`
  - `dynamic_list` / `dynamic_multi_select` → string / string[] (no validation)
- Server mutator wraps with `validateCustomFieldValue` and the entity-ref workspace check.
- Audit events: `ticket.field_set`, `ticket.field_cleared`, `customer.field_set`, `customer.field_cleared`. Payload: `{fieldID, fieldKey, fieldDisplayName, oldValue, newValue}`.

**Acceptance:**
- Setting a value optimistically updates UI; server rejects invalid types and the optimistic write rolls back.
- Cross-workspace entity refs rejected server-side.
- Multiple set/clear in same tick are correctly ordered.

**Deps:** T-1006.

---

### T-1008 — Custom field admin page (`/settings/custom-fields`)

**Atlas ref:** `jsapp/src/app/app-config/custom-fields/`, `serializer.tsx`, `fieldOperators.tsx`.

**Plan:**
- Route `apps/web/src/routes/app/settings.custom-fields.tsx`.
- Tab strip: Ticket / Customer.
- List: rows show display name, key (mono), type badge, required dot, active toggle.
- Detail drawer: edit display name, description, options (for list types), required, sortOrder.
- Type & key are read-only after creation (changing type breaks existing values; changing key breaks API integrations).
- "Test value" preview showing the input control as it would render in the sidebar.
- Conditional rules: defer to Phase 10.5 — for this phase ship a simple "Show only when *<field>* equals *<value>*" picker, no `OR` / `AND` builder yet.

**Acceptance:**
- Create text + list + multi-select + boolean field of each category.
- Archive a field; field disappears from sidebar widget but values remain in DB.
- Reactivate field; values reappear.
- Two browsers see admin changes live.

**Deps:** T-1007.

---

### T-1009 — Custom fields widget on conversation

**Atlas ref:** `jsapp/src/components/conversations/conversation-list-item/ConversationCustomFields.tsx`, `jsapp/src/components/custom-fields/`.

**Plan:**
- New component `apps/web/src/components/conversation/custom-fields-block.tsx`.
- Subscribe to `customFieldsByCategory({ category: "ticket" })` + the ticket's `customFieldValues` relateds.
- Render one input per active field, sorted by `sortOrder`.
- One controlled input component per field type (use existing `@salve/ui` primitives where possible — `Input`, `Select`, `MultiSelect`, `Checkbox`, `DatePicker`).
- Conditional visibility: evaluate `field.rules` against current values; hide if condition false.
- On change → `customField.setValueOnTicket` (debounced 400ms for text, immediate for selects).
- Empty state (no fields configured): collapsed by default with link to settings.

**Acceptance:**
- All 14 field types render and round-trip correctly.
- Conditional visibility hides/shows live.
- Required field with empty value shows red border + helper text.
- Archived field doesn't render.

**Deps:** T-1008.

---

### T-1010 — Custom fields widget on customer

**Atlas ref:** same as T-1009 but `category: "customer"`.

**Plan:**
- Mirror T-1009's component, parameterized by entity (`ticketID | customerID`).
- Customer-side widget will mount in Phase 20's customer profile page; this ticket builds the component but Phase 20 wires it. Ship a stub mount in conversation sidebar showing customer fields under the ticket fields, separated by a divider, while Phase 20 is in flight.

**Acceptance:**
- Component takes `{ entity: "ticket" | "customer", entityID }` props.
- Both modes round-trip values.
- Storybook (or manual screenshot) shows side-by-side rendering.

**Deps:** T-1009.

---

## Definition of done for Phase 10

- All ten tickets shipped, type-checked, Biome-clean.
- Design review pass on `/settings/tags`, `/settings/custom-fields`, conversation header tag widget, and inbox row tag pills.
- Two browsers test: tag/value changes propagate <1 s.
- Migration applied to dev + replication catching up.
- Audit events visible for every state change.
- No regressions in existing inbox/conversation flows (re-run the existing j/k/enter/e hotkeys).
