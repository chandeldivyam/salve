# Settings UX — plan & policy

How `/app/settings/*` should look and behave. Read this before adding a new settings sub-route.

Snapshot of current state at the bottom (§9). The plan first.

---

## 1. The decision: vertical-sidebar layout (Linear-shaped, salve-tuned)

We adopt **a single vertical sidebar with grouped sections**, not the current horizontal section strip. Reasons:

- **Scales.** We have 4 sections today (Setup / Email / Tags / Custom fields). Roadmap adds: Account, Profile, Notifications, Members, Teams, Roles, SLAs, Macros, Snippets, Webhooks, API keys, Audit log, Billing, Integrations, Channels (chat, WhatsApp, SMS, Instagram, FB), Routing, Custom views — easily 20+. A horizontal strip dies past ~6.
- **Scannability.** A vertical list with grouped headers ("Account · Workspace · Channels · Customization · Developer") lets agents scan, recall, jump. Linear's redesign explicitly groups Features / Administration / Your teams.
- **Consistency.** Mirrors our Inbox left-rail mental model (vertical list of sections). Agents already know this column exists.
- **Mobile.** Collapses cleanly to a hamburger + top selector (PostHog pattern). A horizontal strip can't.

We **do not** adopt PostHog's two-column split (Project / Organization). Their split is justified by hierarchy (a user belongs to many projects in one org). Our settings are all workspace-scoped — flattening that into one sidebar with a section group is clearer.

We **do** borrow PostHog's mobile pattern (top bar + collapsed list) and search-as-first-class.

### What changes from today

- Replace `SectionStrip` (horizontal) under the page header with a `SettingsSidebar` (vertical, 220 px) on the left of the page body.
- The Email channel's nested `EmailChannelTabs` strip goes away — Domains / Addresses / Routing / Suppressions / Overview each become first-class sidebar entries under the **Channels → Email** group.
- Page body becomes a single column (max ~720 px reading width for forms, max ~1100 px for tabular content). No more 3-column tag editor or always-visible right-rail create forms.

---

## 2. Layout primitives

```
┌────────────────────────────────────────────────────────────────┐
│ Workbench shell (left rail · top tabs · main)                  │
│                                                                │
│ ┌────────────┬─────────────────────────────────────────────┐   │
│ │ Settings   │ Page header (title · description · CTA)      │   │
│ │ sidebar    ├─────────────────────────────────────────────┤   │
│ │  220 px    │                                             │   │
│ │            │ Page body                                   │   │
│ │  groups    │  · sections (ListSection)                   │   │
│ │  + items   │  · forms (FormSection)                      │   │
│ │            │  · tables (DataTable)                       │   │
│ │  search    │                                             │   │
│ │  optional  │                                             │   │
│ └────────────┴─────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

### `<SettingsSidebar>`
- 220 px fixed, scrolls independently, sticky to top of settings layout.
- Groups: each group has an 11 px uppercase muted label, 16 px top spacing.
- Items: 28 px row, leading 14 px Lucide icon, label, optional trailing count badge (e.g. tag count). Active = `bg-bg-elevated text-fg-primary`, no brand border (Linear restraint — accent reserved for focus + CTA).
- Optional `<SettingsSearch>` at top — single input that fuzzy-filters items by label and group. Cmd-K still works globally.

### `<SettingsHeader>`
Every page renders this. No more per-page bespoke headers.
- `title` (16 px semibold), `description` (13 px muted, max-width 60ch), optional `actions` (primary CTA, secondary buttons, search input).
- 24 px vertical padding, bottom border `--line-quiet`.

### Body containers (pick one per page)
- `<FormSection>` — for editing one entity's fields. 720 px max width, label-on-top, 12 px gap between fields, sticky save bar at bottom when dirty (see §5).
- `<ListSection>` — for collections. Header row (count + filters + primary CTA), then dense rows (32 px), no per-row borders, surface deltas (`--bg-panel` body / `hover:bg-bg-elevated`).
- `<DataTable>` — only when columns are genuinely useful (e.g., Routing rules with priority, sender pattern, action). Otherwise prefer `ListSection`.

---

## 3. Section taxonomy

Lock these groups now so future PRs slot in obviously. Names matter — agents will read this list daily.

```
ACCOUNT                           (you, the agent)
  Profile
  Preferences                     (theme, density, hotkeys)
  Notifications                   (per-channel: desktop, email, slack)

WORKSPACE                         (org-wide, admin-restricted later)
  General                         (name, logo, timezone, default lang)
  Setup                           (onboarding checklist — until 100% then hides)
  Members
  Teams                           (Phase 4)
  Roles & permissions             (Phase 4)
  Audit log                       (Phase 5)

CHANNELS
  Email
    Overview                      (forwarding addr + reply template)
    Domains
    Addresses
    Routing
    Suppressions
  Chat / WhatsApp / SMS / …       (future, same shape)

CUSTOMIZATION
  Tags
  Custom fields
  SLAs                            (Phase 5)
  Macros                          (Phase 4)
  Saved views                     (Phase 4)

DEVELOPER
  API keys                        (Phase 5)
  Webhooks                        (Phase 5)

BILLING                           (Phase 6)
```

Rules:
- **Account vs Workspace** is the user's mental fork. Linear leads with this and so do we.
- **Channels** stays plural and ready — when chat lands, it's a sibling to Email, not a tab inside it.
- **Setup lives under Workspace**, not as its own top-level. Once `progress.dismissed || completedCount === total`, it disappears from the sidebar but the route still resolves.

---

## 4. Entity creation — by complexity tier

The single most common bug shape today is "create form is permanently glued to the page." Fix this by tiering creation by entity complexity.

### Tier A — inline row (one field, no validation surface)
**Example:** add a tag inside an existing group.

- A subtle `+ Add tag` row at the bottom of the group's tag list.
- Click → row turns into an inline input, focus-trapped, `Enter` saves, `Esc` cancels.
- Optimistic insert via Zero mutator. Failure → toast + revert.
- No modal, no sheet, no route change.

### Tier B — side sheet (2–6 fields, contained edit)
**Example:** create a tag group, create a routing rule, create an API key.

- Trigger from a primary CTA in the page header (`+ New group`).
- 480 px right-anchored `Sheet` (Radix `Dialog` styled as side panel).
- Header: "New tag group", close X. Body: fields stacked, label-on-top. Footer: `Cancel` + primary `Create`.
- `Esc` closes. Click-outside closes (with dirty-warn if fields touched).
- On submit: optimistic create, sheet closes, toast "Group created", URL stays on list page (no jarring redirect).
- For follow-up edit affordances: list row is a click target → opens the same sheet in edit mode.

### Tier C — dedicated route (multi-step, DNS records, schema-changing)
**Example:** add a sending domain (DKIM, MAIL FROM, verification), add an OAuth integration, define a complex SLA.

- `+ Add domain` → `/app/settings/channels/email/domains/new`
- Full page with stepper, copy-able DNS rows, "I've added the records" → poll → confirm.
- Back goes to list.
- Sheet is the wrong primitive here because users want to copy values to clipboard, switch tabs to their DNS provider, and come back. A modal/sheet over their context fights that flow.

### Tier D — auto-discovery (no creation form at all)
**Example:** Suppressions (added by SES bounces, not by humans), Audit log entries, Webhook events.

- No "Create" CTA. The list itself is the surface; rows might have actions ("Reinstate", "Resend") but you don't author rows.

### Picking a tier — quick rule
- 1 field → A.
- Fits in 480 px without scrolling, single-shot save → B.
- Has external dependencies (DNS, OAuth callback, file upload, multi-step) → C.
- System-generated → D.

---

## 5. Save semantics

Today: Tags uses per-row `Save group`/`Save tag` buttons. Custom fields uses a single `Save changes` button per detail. Inconsistent.

**Policy:**

- **Editing existing entity in `<FormSection>`:** debounced auto-save (400 ms after last change). Pencil icon next to title flips to spinner while saving, check on success, alert on error. No save button. This matches Linear/Notion intuition.
- **Creating new entity in side sheet:** explicit `Create` button. The sheet is a transactional unit — half-filled state shouldn't survive accidental close.
- **Bulk / dangerous changes** (archive, delete, change a custom-field type): explicit confirmation, even if it's a single-field flip. Use `<AlertDialog>`.
- **Inline tier-A rows:** save on `Enter`/blur, cancel on `Esc`.

The `Save group` / `Save tag` buttons inside the current Tags layout are removed. Inline edits auto-save.

---

## 6. Empty, loading, error

Standardize these too.

### Empty state (`<EmptyState>`)
- Centered in the body container.
- 40 × 40 muted icon (the page's section icon), 14 px medium title, 12 px muted description (max 50ch), one primary CTA.
- Copy formula: "No {plural}", "Brief why-it-matters", "{Action verb} {singular}".
- Example: "No tags yet · Group tickets so agents can filter and macros can target. · `+ New tag group`"

### Pending
- `RoutePendingFeedback` (existing) at route level. Inside the page, prefer skeleton rows (3–5) for `ListSection`; inline spinner for `FormSection` (200 ms delay before showing).

### Error
- `RouteErrorFeedback` for hard route errors.
- Inline form errors live with the field (red text below input, `aria-invalid`). Page-level errors (e.g., "Failed to save — retry") use a top banner inside the body container, dismissable.
- Mutator failures surface as toasts + optimistic revert.

---

## 7. Mobile / responsive

Three breakpoints matter:

- **≥ 1024 px (desktop):** sidebar 220 px + body. Default.
- **640–1023 px (tablet):** sidebar collapses to 56 px (icons only, label on hover/active). Body fills rest. Page CTA stays in header.
- **< 640 px (mobile):** sidebar hides. A `Settings ▾` button appears in the page header — opens a drawer with the full sidebar (PostHog pattern). Page body becomes full-width single column. CTAs in the header collapse into an overflow `⋯` if more than one.

Side sheets become full-screen modals on mobile.

---

## 8. Concrete migration plan

In order, each landable on its own:

1. **Build primitives**
   - `SettingsSidebar`, `SettingsHeader`, `FormSection`, `ListSection`, `EmptyState`, side-sheet variant of existing `Dialog`, sticky `SaveBar` (auto-save indicator, not a button).
   - Add to `@salve/ui` and document in `guidelines/frontend.md` §11 (new section).

2. **Migrate Setup**
   - Move under Workspace group. Same checklist content. Drop the `bg-brand-soft` icon tile in favor of a neutral `bg-bg-elevated` tile (accent restraint).

3. **Migrate Tags**
   - One column. Top: header (title, count, `+ New group` CTA). Body: each group renders as a `ListSection`: group header (label, color dot, ⋯ menu for archive/edit) + tag rows + a tier-A "+ Add tag" row at the bottom.
   - Group create → side sheet (tier B).
   - Inline auto-save on tag rename, color change.
   - Archived rows hidden behind a `Show archived` toggle in the header.

4. **Migrate Custom fields**
   - Collapse the `Ticket Fields | Customer Fields` pill into two sidebar items under Customization → Custom fields → Ticket / Customer. Sub-items are fine.
   - Per category: `ListSection` of fields. `+ New field` → side sheet (tier B). Click row → opens edit sheet (also tier B). The right-rail input preview lives inside the edit sheet, below the form.

5. **Migrate Email channel**
   - Drop the nested tab strip. Each tab becomes a sidebar entry under Channels → Email.
   - Overview becomes the email parent route (clicking "Email" in the sidebar lands here).
   - "Add domain" stays a dedicated route (tier C). "Add address" becomes a side sheet (tier B). Routing rule create becomes a side sheet.

6. **Add SettingsSearch**
   - Cmd-K already covers global. The sidebar search is local (filters visible items). Implement once the taxonomy has 12+ items — not before.

7. **Mobile pass**
   - Drawer pattern for sidebar. Test on iPhone-width viewport.

---

## 9. Current state — friction points found in audit

Captured 2026-05-01 from screenshots + creation walk-through. Pin to git history; this section will be obsolete after migration.

- **Setup** — works. Single column, checklist, progress bar. Only nit: brand-soft icon tile pulls eye unnecessarily.
- **Email channel** — has its own H1 + description + nested tab strip on top of the parent Settings header + section strip. Four layers of chrome before content. Two horizontal navigations of equal visual weight stacked.
- **Tags** — three-column layout (groups list · editor · create forms) with **two persistent create-forms** taking the right rail forever. Editor middle column shows one selected group at a time even though the surface is wide — most of the page is empty when nothing's selected. Per-row `Save group`/`Save tag` buttons fight Zero's optimistic mutators.
- **Custom fields** — persistent inline create form glued to the top. Right-rail "Field detail" + "Input preview" useful but always on, even when nothing's selected. `Ticket | Customer` pill toggle is hidden in top-right; should be sidebar-level navigation.
- **No search.** No section grouping. No mobile story. No shared header primitive — every page reinvents it.

---

## 10. Decisions taken in slice 1

- **Settings as workbench tab.** Kept. `Cmd+,` modal-takeover deferred until the shortcut lands.
- **Sidebar position: option A (single rail).** When the route is under `/app/settings/*`, the workbench `LeftRail` swaps its nav to the settings sidebar. No second sidebar. A `← Back to inbox` link sits at the top of the rail as the way out (closing the Settings tab also works).
- **Setup visibility.** Stays in the sidebar under WORKSPACE until dismissed or 100% complete; then disappears (the route still resolves).
