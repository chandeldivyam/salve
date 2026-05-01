# Phase 95 — SLA + Teams + Shifts

## Goal

After this phase: agents can be grouped into teams, teams can have business-hours / shifts, and SLA rules drive timers + warnings + breach notifications. Inbox rows show SLA status (Monitor / Urgent / Overdue + remaining time). Routing rules can target a team. New tickets get SLA timers based on matching rules.

## Why now

This is the most infra-heavy phase but also the highest "operational maturity" lift. Most B2B helpdesks live or die by SLA reporting. We do it last because it depends on most prior pieces (notifications, audit, custom fields, views).

## Atlas behavior

### Teams

- Atlas conversation has `team_id`. Mutators: `POST /conversation/assign-team`.
- Team-level routing (Phase 3a's `inboundRoutingRule.assignTeamID` is already pointed here).
- Backend: implied via team services; frontend: `jsapp/src/components/conversations/vitals/team/ConversationTeam.tsx`.

### Shifts

- Atlas: `webapp/web/shifts/`.
- `ShiftModel`: `agent_id`, `day_of_week`, `start_time`, `end_time`, `timezone`.
- Determines which agents are "on shift" for routing & SLA calculations.
- Frontend admin: `jsapp/src/app/app-config/scheduling/ShiftSettings.tsx`.
- Time-off: `TimeoffModal.tsx` — agent marks days/hours as unavailable.
- Backend: `webapp/web/shifts/services.py`, `apis.py`, `models.py`.

### SLA

- Atlas: `webapp/web/sla/`.
- `SlaRuleModel`: `id`, `company_id`, `name`, `segment`, `priorities`, `first_response_time`, `tags`, `sub_channels`, `teams`, `next_response_time`, `working_hours`, `rank`, `notifications`, `channels`.
- `SlaRuleSentNotificationModel`: tracks sent notifications (idempotent).
- Working-hours-aware: SLA timers exclude nights/weekends per business hours.
- Multiple rules ranked; first match applies.
- Inbox row indicator: `jsapp/src/components/conversations/conversation-list-item/ConversationListItem.tsx:178-191`. Color states Monitor/Urgent/Overdue.
- Hook: `jsapp/src/hooks/useSlaFields.tsx`.
- Notifications: agents alerted as SLA approaches breach + when breached.

## Schema delta

### `team.ts` (new)

```ts
export const team = pgTable("team", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceID: uuid("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  description: text("description"),
  color: text("color"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt, updatedAt,
}, (t) => [
  uniqueIndex("team_label_uq").on(t.workspaceID, lower(t.label)),
]);

export const teamMember = pgTable("team_member", {
  teamID: uuid("team_id").notNull().references(() => team.id, { onDelete: "cascade" }),
  userID: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  workspaceID: uuid("workspace_id").notNull(),
  role: pgEnum("team_role", ["lead", "member"])("role").notNull().default("member"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.teamID, t.userID] }),
  index("team_member_user_idx").on(t.userID, t.workspaceID),
]);
```

### `ticket.ts` extension

```ts
teamID: uuid("team_id").references(() => team.id, { onDelete: "set null" }),
```

(Alongside individual `assigneeID` — both can coexist; team-assigned tickets without specific agent are unassigned-within-team.)

### `business_hours.ts` (new)

Workspace-level default + per-team overrides:

```ts
export const businessHours = pgTable("business_hours", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceID: uuid("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  teamID: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
  // null teamID = workspace default
  timezone: text("timezone").notNull(), // IANA, e.g. "America/Los_Angeles"
  schedule: jsonb("schedule").$type<{
    mon: WindowList; tue: WindowList; wed: WindowList; thu: WindowList;
    fri: WindowList; sat: WindowList; sun: WindowList;
  }>().notNull(),
  // WindowList = Array<{ start: "HH:MM", end: "HH:MM" }>
  holidays: jsonb("holidays").$type<{date: string, label: string}[]>().notNull().default([]),
  createdAt, updatedAt,
}, (t) => [
  uniqueIndex("business_hours_team_uq").on(t.workspaceID, t.teamID),
]);
```

### `shift.ts` (new)

```ts
export const shift = pgTable("shift", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceID: uuid("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  userID: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  teamID: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Sun..6=Sat
  startTime: text("start_time").notNull(), // "HH:MM"
  endTime: text("end_time").notNull(),
  timezone: text("timezone").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
}, (t) => [
  index("shift_user_idx").on(t.userID, t.dayOfWeek),
]);

export const timeOff = pgTable("time_off", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceID: uuid("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  userID: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  reason: text("reason"),
  createdAt, updatedAt,
}, (t) => [
  index("time_off_user_idx").on(t.userID, t.startsAt, t.endsAt),
]);
```

### `sla_rule.ts` (new)

```ts
export const slaRule = pgTable("sla_rule", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceID: uuid("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  rank: integer("rank").notNull(), // lower = higher priority
  // matching criteria
  priorities: jsonb("priorities").$type<TicketPriority[]>().notNull().default([]),
  tagIDs: jsonb("tag_ids").$type<string[]>().notNull().default([]),
  channelIDs: jsonb("channel_ids").$type<string[]>().notNull().default([]),
  emailAddressIDs: jsonb("email_address_ids").$type<string[]>().notNull().default([]),
  teamIDs: jsonb("team_ids").$type<string[]>().notNull().default([]),
  customerSegmentRules: jsonb("customer_segment_rules").$type<Filter[]>().notNull().default([]),
  // targets
  firstResponseMinutes: integer("first_response_minutes").notNull(),
  nextResponseMinutes: integer("next_response_minutes"),
  resolutionMinutes: integer("resolution_minutes"),
  workingHoursOnly: boolean("working_hours_only").notNull().default(true),
  // notifications
  warnAtPercent: integer("warn_at_percent").notNull().default(80),
  enabled: boolean("enabled").notNull().default(true),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt, updatedAt,
}, (t) => [
  index("sla_rule_workspace_idx").on(t.workspaceID, t.enabled, t.rank),
]);

export const ticketSla = pgTable("ticket_sla", {
  ticketID: uuid("ticket_id").primaryKey().references(() => ticket.id, { onDelete: "cascade" }),
  slaRuleID: uuid("sla_rule_id").references(() => slaRule.id, { onDelete: "set null" }),
  workspaceID: uuid("workspace_id").notNull(),
  firstResponseDueAt: timestamp("first_response_due_at", { withTimezone: true }),
  nextResponseDueAt: timestamp("next_response_due_at", { withTimezone: true }),
  resolutionDueAt: timestamp("resolution_due_at", { withTimezone: true }),
  firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
  resolutionAt: timestamp("resolution_at", { withTimezone: true }),
  status: pgEnum("ticket_sla_status", ["pending","met","breached","paused","cleared"])("status").notNull(),
  warnedAt: timestamp("warned_at", { withTimezone: true }),
  breachedAt: timestamp("breached_at", { withTimezone: true }),
  createdAt, updatedAt,
}, (t) => [
  index("ticket_sla_status_idx").on(t.workspaceID, t.status, t.firstResponseDueAt),
]);
```

## Inngest functions

### SLA assignment on ticket creation

`apps/api/src/inngest/functions/sla-assign.ts`:

- Triggered by `ticket/created` event from `ticket.create` post-commit.
- Step 1: load workspace's SLA rules ordered by rank.
- Step 2: evaluate match — first rule that matches wins.
- Step 3: compute `firstResponseDueAt` based on rule's minutes + ticket's createdAt + business-hours math (skip non-business-hours if `workingHoursOnly`).
- Step 4: insert `ticketSla` row with status `pending`.

### SLA timer / warn / breach

`apps/api/src/inngest/functions/sla-timer.ts`:

- After `sla-assign` writes a row, dispatch `sla/timer.scheduled` with `step.sleepUntil(warnAt)` then later `step.sleepUntil(dueAt)`.
- Warn step: if still pending, write notification kind `sla_warning` to assignee + team leads.
- Breach step: if still pending, status → `breached`, notification kind `sla_breach`.

### SLA met / cleared

- On agent reply (first agent message): `ticket.firstResponseAt` stamps; sla row first-response set + status updated. Inngest function cancels via idempotency: re-running is a no-op when status is met.
- On ticket resolved: clear SLA timers, status `met` or `cleared`.

### Business-hours math helper

`packages/core/src/business-hours.ts`:

- Function `addBusinessMinutes(start: Date, minutes: number, schedule: BusinessHours): Date`.
- Walks day-by-day, subtracts non-business-hours, accounts for holidays.
- Test fixture: 9–5 Mon-Fri, schedule of 480-minute SLA at Friday 4 PM → due Monday 3 PM.

## UI surfaces

### Settings → Teams

- Route `/settings/teams`.
- List teams + member counts.
- Detail: members list (add/remove), business-hours editor, color, lead designations.

### Settings → Shifts

- Route `/settings/shifts`.
- Per-user shift schedule editor (calendar week view).
- Per-team shift overlay.
- Time-off requests list.

### Settings → SLA

- Route `/settings/sla`.
- List rules ordered by rank with drag-reorder.
- Detail: name, matching criteria (priority multi-select, tags, channels, email addresses, teams, customer-segment filter builder), targets (first/next/resolution minutes), warn threshold, working-hours toggle.

### SLA badge on inbox row + sidebar

- Color states:
  - **Met / no SLA** — none.
  - **Monitor** (>50% time remaining) — neutral grey.
  - **Urgent** (warn threshold reached) — amber.
  - **Overdue** — red.
- Tooltip: target time + actual remaining time.
- Sidebar shows full SLA panel: rule name, all due times, current status.

### Team assignment widget

- Add team picker alongside assignee picker.
- Filter assignee options by team membership when team set.

### Routing rule UI updates

- Phase 3a's routing rules already have `assignTeamID` field; surface it in the routing UI (deferred from 3a).

## Tickets

### T-9501 — Team schema + mutators + admin

**Atlas ref:** `webapp/web/conversation/apis.py:assign-team`.

**Plan:**
- Migration: team, teamMember tables, ticket.teamID column.
- Zero mirror.
- Mutators: `team.create / update / archive`, `team.addMember / removeMember / setRole`, `ticket.assignTeam`.
- Admin route `/settings/teams`.
- Wire `ticket.assignTeam` into command palette `team.assign`.

**Acceptance:** team CRUD + member management + ticket assignment all live.

**Deps:** none.

---

### T-9502 — Team picker on conversation

**Atlas ref:** `ConversationTeam.tsx`.

**Plan:**
- Sidebar widget: team picker.
- When team set, assignee picker filters to team members (with "all members" toggle).

**Acceptance:** team-then-assignee flow works; filter behaves.

**Deps:** T-9501 + Phase 80 sidebar.

---

### T-9503 — Business hours table + admin UI

**Atlas ref:** Atlas company business hours.

**Plan:**
- Migration per spec.
- Workspace-default + per-team override editor.
- 7-day grid with multiple windows per day.
- Holidays list (date + label).
- Timezone picker (IANA).

**Acceptance:** workspace + team-override schedules persist; UI editor works.

**Deps:** T-9501.

---

### T-9504 — Shift table + admin UI

**Atlas ref:** `ShiftSettings.tsx`, `TimeoffModal.tsx`, `webapp/web/shifts/`.

**Plan:**
- Migration: shift, timeOff tables.
- `/settings/shifts` page: per-user weekly grid; team filter.
- Time-off request modal (start, end, reason).

**Acceptance:** shifts saved; time-off CRUD; UI matches spec.

**Deps:** T-9501.

---

### T-9505 — Business-hours math helper + tests

**Plan:**
- `packages/core/src/business-hours.ts`.
- `addBusinessMinutes`, `isWithinBusinessHours`, `nextBusinessMinute`.
- Test cases including DST transitions and holidays.

**Acceptance:** unit tests green for 20+ scenarios.

**Deps:** T-9503.

---

### T-9506 — SLA rule schema + admin UI

**Atlas ref:** `SlaRuleModel`, `webapp/web/sla/`.

**Plan:**
- Migration: slaRule, ticketSla tables.
- Admin page `/settings/sla`.
- Rule list with rank reorder.
- Detail: matching criteria + targets + warn threshold + working-hours toggle.
- Mutators: `slaRule.create / update / archive / reorder`.

**Acceptance:** SLA rule CRUD; rank reorder live.

**Deps:** T-9501.

---

### T-9507 — SLA assignment Inngest function

**Plan:**
- `sla-assign.ts` per spec.
- Triggered by `ticket/created` event (added in `ticket.create` server post-commit).
- Computes due times using business-hours helper.

**Acceptance:**
- New ticket gets SLA row within 1 s when a matching rule exists.
- No SLA row when no rule matches.
- Rank tie-break consistent.

**Deps:** T-9505, T-9506.

---

### T-9508 — SLA timer + warn + breach Inngest function

**Plan:**
- `sla-timer.ts` per spec.
- Two sleepUntil checkpoints (warn + due).
- Notification rows on warn + breach.
- Idempotent if status already met.

**Acceptance:**
- Set SLA "first response in 5 minutes, warn at 80%": agent gets warn at 4 minutes, breach at 5 if no reply.
- Reply at 3 minutes → no warn, no breach.

**Deps:** T-9507, Phase 70 (notifications).

---

### T-9509 — First-response detection + SLA met

**Plan:**
- Existing `message.send` already stamps `firstResponseAt` on first agent reply. Extend post-commit to update `ticketSla` status to `met` if pending.
- Cancellation of timers via idempotency-key short-circuit.

**Acceptance:**
- First agent reply marks SLA met; no breach notification fires.

**Deps:** T-9508.

---

### T-9510 — SLA badge on inbox row + sidebar

**Atlas ref:** `ConversationListItem.tsx:178-191`, `useSlaFields.tsx`.

**Plan:**
- Inbox row: small color-coded badge with remaining-time. Hidden if no SLA or status `met`.
- Sidebar SLA panel: rule name, all due times, status pill, time remaining live-updating.
- Live updates via Zero subscription on `ticketSla`.

**Acceptance:** badge + panel reflect status correctly; minute-precision update.

**Deps:** T-9509, Phase 80 (sidebar).

---

### T-9511 — Cmd+K SLA + team commands

**Plan:**
- `team.assign` ($mod+t).
- `team.unassign`.
- `sla.view_targets` (palette-only).

**Deps:** T-9501, T-9510, Phase 30.

---

### T-9512 — Routing rule UI: surface team assignment

**Atlas ref:** Phase 3a's `inboundRoutingRule.assignTeamID` is unused in current UI.

**Plan:**
- Update `apps/web/src/routes/app/settings.channels.email.routing.tsx` to expose team picker as assignment target.
- Mutator already supports it from Phase 3a.

**Acceptance:** routing rule with team assignment correctly routes inbound to team.

**Deps:** T-9501.

---

## Definition of done for Phase 95

- Teams + members + team assignment live.
- Business hours editable; helper passes tests.
- Shifts + time-off persist; admin UI works.
- SLA rules: rank-ordered, criteria-rich, working-hours-aware.
- Auto-assign on ticket create; warn + breach notifications fire.
- Inbox row + sidebar SLA badges live.
- Routing rules can target teams.
- Type-check + Biome clean; design review on each new settings page + SLA badge states.
