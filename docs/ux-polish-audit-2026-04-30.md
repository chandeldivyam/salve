# UX Polish Audit - 2026-04-30

This document records the polish audit run before moving on to the next product phase. The goal was to understand the current Salve app experience end to end, compare it against the higher-quality Atlas support tool at `/Users/divyamchandel/Documents/atlas/app`, and identify the highest-leverage UX, UI, routing, feedback, asset, and dark-mode improvements.

No production code changes were made as part of the audit itself. Browser artifacts and subagent reports were written under `tmp/design-review/`.

## Scope

The audit covered:

- First-run flow: sign-up, sign-in, workspace creation, first inbox landing.
- Main workbench: inbox empty state, sample ticket list, ticket detail, composer.
- Email setup: email channel page, add domain, domain row, routing rule form, DNS detail page.
- Responsive behavior: desktop `1440x900` and mobile `390x844`.
- Dark-mode readiness using browser dark media emulation.
- Current UI primitives in `packages/ui`.
- Current route/loading/error handling in `apps/web`.
- Atlas reference patterns for onboarding, settings navigation, inbox, and composer.
- Asset-generation options through the installed `peek` CLI.

## Orchestration

Three subagents were started, with the parent process reviewing their outputs and independently verifying the current app in the browser.

1. Full UX/UI audit agent
   - Purpose: walk the current app, capture screenshots, inspect source, compare against Atlas patterns, and find mistakes or polish opportunities.
   - Output: `tmp/design-review/polish-audit-agent1/audit-notes.md`
   - Screenshots: `tmp/design-review/polish-audit-agent1/screenshots/`

2. UX systems research agent
   - Purpose: research current best practices for B2B app route feedback, toasts, async errors, form validation, command palettes, setup checklists, dark-mode architecture, and accessibility.
   - Output: subagent final report in the conversation summary.
   - No source edits.

3. Asset and `peek` agent
   - Purpose: inspect `peek --agent-help`, understand image/video generation capabilities, and recommend a safe asset pipeline.
   - Output: `tmp/design-review/polish-asset-agent3/capability-report.md`
   - No production assets generated.

The parent then ran its own browser pass using `agent-browser` and inspected screenshots manually.

Parent screenshots:

- `tmp/design-review/polish-parent/01-sign-up.png`
- `tmp/design-review/polish-parent/02-sign-in.png`
- `tmp/design-review/polish-parent/03-sign-up-filled.png`
- `tmp/design-review/polish-parent/04-workspace-new.png`
- `tmp/design-review/polish-parent/05-workspace-filled.png`
- `tmp/design-review/polish-parent/06-inbox-empty.png`
- `tmp/design-review/polish-parent/07-inbox-with-samples.png`
- `tmp/design-review/polish-parent/08-ticket-detail.png`
- `tmp/design-review/polish-parent/09-settings-email-empty.png`
- `tmp/design-review/polish-parent/10-settings-add-domain-form.png`
- `tmp/design-review/polish-parent/11-settings-domain-created.png`
- `tmp/design-review/polish-parent/12-settings-routing-form.png`
- `tmp/design-review/polish-parent/13-domain-dns-detail.png`
- `tmp/design-review/polish-parent/14-mobile-inbox.png`
- `tmp/design-review/polish-parent/15-mobile-settings-email.png`
- `tmp/design-review/polish-parent/16-dark-media-inbox.png`

## Current App State Verified

The parent successfully verified this flow in a fresh browser session:

1. Open sign-up.
2. Create an account.
3. Create a workspace.
4. Land in inbox.
5. Create sample tickets.
6. Open a ticket detail.
7. Open email settings.
8. Add an email domain.
9. Inspect the domain row, routing rule form, and DNS detail page.
10. Capture mobile inbox and mobile email settings.
11. Capture dark media emulation.

During the first subagent audit, the browser hit Zero `SchemaVersionNotSupported` errors for recently added email tables/columns and bounced to sign-in. The parent could not reproduce this after the active zero-cache process was restarted. The likely cause was stale zero-cache state from the Phase 3B/3C schema change. This is still worth treating as a dev-reliability issue because it blocked automated review once.

## Atlas Reference Learnings

Atlas is more mature in four areas that matter for Salve now:

1. Onboarding stays present
   - Atlas has an onboarding widget with progress, persistent collapsed/expanded state, action buttons, optional task completion, and task navigation.
   - Salve currently drops a new workspace into an empty inbox with no guided next step.

2. Settings are information architecture, not one page
   - Atlas builds settings navigation from many sections and keeps orientation in a dedicated layout.
   - Salve currently has one sidebar item, "Email channel", with domains, addresses, routing, suppressions, and delivery mechanics on one long surface.

3. Composer is an agent command center
   - Atlas supports channel selection, warnings, CC context, team drafts, article insertion, smart assist, scheduling, send-control variants, pinning, status-aware sends, and customer context.
   - Salve has a good Tiptap foundation, reply/internal note mode, attachments, and from-address selection, but does not yet expose enough support-agent workflow controls.

4. Workbench density is deliberate
   - Atlas keeps inbox and ticket workflows operational and compact, with more controls for filtering, sorting, selection, and context panes.
   - Salve is visually clean but currently sparse, especially after first setup and in empty states.

## Findings

### 1. First-run setup is the largest product gap

Current behavior:

- Sign-up sends users to workspace creation.
- Workspace creation sends users to `/app`, which redirects to `/app/inbox`.
- The inbox is empty and presents "Create sample tickets".
- There is no obvious path to the actual setup work: add domain, verify DNS, create support address, define routing, test inbound, invite teammates.

Impact:

- A company trying to set up Salve reaches an empty operational tool before it has configured any channel.
- The app has the data model for email setup, but the journey does not teach or sequence it.
- The "Create sample tickets" CTA is useful in dev, but it is not a production onboarding action.

Recommended fix:

- Add a setup checklist route or setup surface, likely `/app/settings/setup`.
- Route new workspaces to setup instead of directly to the empty inbox.
- Compute checklist state from real Zero queries:
  - Workspace created.
  - Sending domain added.
  - DNS verified.
  - Send/receive address created.
  - Routing rule configured.
  - Test inbound received.
  - Teammate invited.
- Add a "Continue setup" entry in the app header until setup is complete.

### 2. Dark mode requires a semantic token foundation

Current behavior:

- `apps/web/src/styles.css` defines brand Tailwind colors but not semantic surface/text/border/status tokens.
- UI primitives and routes use direct light-mode classes such as `bg-white`, `bg-slate-50`, `text-slate-*`, `border-slate-*`, `ring-offset-white`, `bg-red-*`, `bg-amber-*`, and `bg-emerald-*`.
- Browser dark media emulation does not change the UI, as expected, because no dark-mode system exists yet.

Impact:

- Adding one-off `dark:` classes route by route would create a maintenance problem.
- Status colors, dropdowns, cards, inputs, composer, and settings all need consistent contrast in both modes.
- Future generated assets should wait until the theme surface is defined, otherwise art direction may mismatch.

Recommended fix:

- Add selector-driven dark mode with Tailwind v4 `@custom-variant dark`.
- Define semantic CSS vars in `:root` and `.dark`, then map them into Tailwind via `@theme inline`.
- Suggested token families:
  - `surface`, `surface-muted`, `surface-elevated`
  - `border`, `border-strong`
  - `text`, `text-muted`, `text-subtle`
  - `brand`, `brand-muted`, `brand-strong`
  - `danger`, `warning`, `success`, plus muted variants
- Migrate `packages/ui` primitives first.
- Then migrate app shells and routes.
- Add a persisted system/light/dark preference and a small theme switcher.

### 3. Route feedback, loading, not-found, and errors are too thin

Current behavior:

- Router setup is minimal.
- Root has a top-level error boundary, but route-specific pending/error/not-found surfaces are not established.
- Zero query loading often appears as inline text such as "Loading..." or "Loading inbox...".
- Missing ticket and missing domain states exist, but they are not part of a coherent route feedback system.

Impact:

- Slow session checks or route loads can feel blank or abrupt.
- Errors do not consistently preserve the nearest useful shell.
- Browser/system errors are hard to recover from without manual reload.

Recommended fix:

- Add `apps/web/src/components/route-feedback.tsx` with:
  - `RoutePending`
  - `RouteError`
  - `RouteNotFound`
  - Shell-preserving variants for app, inbox, and settings.
- Wire TanStack Router defaults:
  - `defaultPendingComponent`
  - `defaultErrorComponent`
  - `defaultNotFoundComponent`
  - `defaultPendingMs`
  - `defaultPendingMinMs`
- Add route-specific boundaries for `/app`, `/app/inbox`, `/app/settings`, and domain detail routes.
- Keep component-level skeletons for Zero `useQuery` unknown states because route pending will not cover reactive query loading.

### 4. Async feedback and toasts are missing

Current behavior:

- There is no toast system installed or exported from `packages/ui`.
- REST mutations and Zero mutations are mostly silent.
- Some buttons show loading text, but there is no standard pattern.
- Failures in composer send, ticket mutation, domain setup, routing rule save, and shortcut-driven actions need better user feedback.

Impact:

- Users may not know if an action succeeded, failed, or is still processing.
- Failed setup actions are easy to miss.
- High-frequency inbox actions could become noisy if every optimistic action gets a success toast, so the design needs nuance.

Recommended fix:

- Add a shadcn-style Sonner/Toaster primitive in `packages/ui`.
- Mount the toaster in the app/root shell.
- Add `apps/web/src/lib/feedback.ts` or `async-action.ts` for:
  - Error normalization.
  - `toast.promise` helpers.
  - Optional quiet mode.
  - Consistent success/error copy.
- Use low-noise rules:
  - High-frequency optimistic actions: inline pending/error only.
  - Destructive/status-changing actions: toast with undo where possible.
  - Setup actions: toast plus inline status.
  - Upload/send failures: clear inline error and toast.

### 5. Forms are inconsistent

Current behavior:

- Auth forms use `noValidate`, inline field errors, and `aria-invalid`.
- Workspace creation uses native `required` and lacks the same inline validation pattern.
- Settings forms are hand-rolled with varied loading/error handling.
- `react-hook-form`, `@hookform/resolvers`, and Zod are already installed.

Impact:

- Workspace creation can fall back to browser-native tooltips.
- Form error accessibility is inconsistent.
- Double-submit and field focus behavior are not standardized.

Recommended fix:

- Add UI primitives:
  - `Field`
  - `FieldError`
  - `Textarea`
  - `FormActions`
  - optional `LoadingButton`
- Convert auth, workspace, add-domain, add-address, and routing-rule forms to RHF + Zod.
- Preserve the project rule:
  - `noValidate`
  - `aria-invalid`
  - inline errors
  - server errors with `role="alert"` or associated `aria-describedby`
- Ensure first invalid field is focusable and described.

### 6. Email settings expose implementation details

Current behavior:

- Customer-facing UI shows "Verify dev" and "Mark verified (dev)".
- Address creation exposes raw signature HTML.
- Routing form asks for a raw `team id`.
- Long forwarding and DNS values are visible but not copyable.
- Email channel page mixes setup, domain status, addresses, forwarding, routing, and suppressions on one page.

Impact:

- The page feels like a developer console rather than a company setup flow.
- Users can configure incorrect values or get stuck on raw IDs.
- DNS setup is copy-heavy but lacks copy affordances.

Recommended fix:

- Hide dev-only verification actions outside development or move them behind a dev affordance.
- Rename customer-facing actions:
  - `Verify dev` -> hidden in production or `Verify DNS`
  - `Mark verified (dev)` -> hidden in production
- Add copy buttons for every DNS and forwarding value.
- Replace raw team ID with a team picker once teams exist. Until then, avoid showing a field that implies the user should know an ID.
- Replace raw signature HTML with a plain/rich text signature editor.
- Split the email page into tabs or subroutes:
  - Overview
  - Domains
  - Addresses
  - Routing
  - Suppressions
  - Delivery health

### 7. Inbox ergonomics are early-stage

Current behavior:

- Inbox has search and filter chips.
- Filter icon is a placeholder.
- No counts are shown in tabs.
- No sort control.
- No bulk selection or bulk action bar.
- Empty state includes a dev sample-ticket CTA.
- Fixed `360px` list width is fine on desktop but does not create a true mobile experience.

Impact:

- The inbox looks clean but does not yet feel like an agent-grade workbench.
- Mobile shows the list squeezed into the viewport instead of a routed list/detail pattern.
- Users cannot understand workload counts at a glance.

Recommended fix:

- Add counts to filter chips.
- Replace placeholder filter with a real menu.
- Add sort: newest, oldest, priority, SLA due when available.
- Gate sample-ticket creation to dev or an explicit demo mode.
- Add bulk selection and a bulk action bar after the basic filtering model is stable.
- Make mobile route behavior list-first, then detail, with a clear back action.

### 8. Ticket detail and composer have a good foundation but need agent controls

Current behavior:

- Ticket detail loads status, priority, assignment, messages, outbound delivery rows, inbound auth badges, and composer.
- Composer supports reply/internal note, Tiptap formatting, attachments, selected send address, and keyboard submit.
- If there are no send addresses, composer shows `No send address` but still visually presents a reply surface.

Impact:

- The foundation is strong, but support agents will soon need richer workflow controls.
- Missing setup state should be more prominent in the composer.
- Current send controls are too simple for real support operations.

Recommended fix:

- Add delivery-risk warnings:
  - No send address.
  - Domain not verified.
  - Suppressed recipient.
  - Closed/resolved ticket.
- Add send action variants when the model supports them:
  - Send reply.
  - Send and close.
  - Save note.
  - Schedule send later.
- Add CC/recipient context for email.
- Add draft persistence before heavier composer features.
- Later: macros/templates, article insertion, smart assist, and team drafts.

### 9. Settings IA needs expansion

Current behavior:

- `/app/settings` has a single sidebar item: Email channel.
- This was acceptable for Phase 3 but is now limiting.

Impact:

- Every future operational setting will either bloat the single email page or require a late navigation redesign.
- Setup and channel health need first-class navigation.

Recommended fix:

- Introduce a broader settings IA now, even if many pages are placeholders:
  - Setup
  - Channels
  - Email
  - Team
  - Workspace
  - Security
  - Delivery health
- For the immediate polish pass, add at least Setup and split Email into clearer tabs/subsections.

### 10. Mobile needs a real responsive strategy

Current behavior:

- Mobile inbox screenshot shows the fixed list occupying nearly the full width with the detail pane off-screen.
- Mobile settings works better, but dense rows truncate heavily and long technical values need copy/detail affordances.

Impact:

- The app is usable enough for visual testing, but not for real mobile support work.
- The inbox/detail pattern needs route-aware behavior.

Recommended fix:

- For inbox:
  - Mobile `/app/inbox` shows the list only.
  - Mobile `/app/inbox/t/:ticketId` shows detail only with a back button.
- For settings:
  - Convert long domain/address rows into stacked sections with copy buttons.
  - Avoid relying on horizontal truncation for technical values.

### 11. Assets should be purposeful, not decorative

Current state:

- No checked-in bitmap product assets were found.
- The Salve logo is a code-native SVG in `packages/ui/src/logo.tsx`.
- `peek 0.4.0` supports image generation, image editing, media analysis, and video generation.

Recommended asset direction:

- Keep the logo as SVG. Do not AI-generate brand marks.
- Add small static app illustrations only where they help:
  - Empty inbox.
  - Select-ticket placeholder.
  - Email/domain routing setup.
  - Optional workspace creation side visual.
- Use real app screenshots/recordings for walkthrough videos.
- Use generated video only for intro/outro plates or subtle motion loops.

Suggested future placement:

- `apps/web/src/assets/illustrations/empty-inbox.webp`
- `apps/web/src/assets/illustrations/select-ticket.webp`
- `apps/web/src/assets/illustrations/domain-routing.webp`
- `apps/web/src/assets/illustrations/workspace-create.webp`

Constraints:

- No readable generated text in images.
- No fake UI controls.
- No generated logo or wordmark.
- Add stable dimensions to avoid layout shift.
- Keep key assets roughly under 80-120 KB each after optimization.

## Recommended Implementation Order

### Slice 1: UX foundation

Do this first because it affects every later polish task.

- Add semantic theme tokens and dark-mode selector.
- Migrate `packages/ui` primitives to semantic tokens.
- Add persisted system/light/dark theme mode.
- Add route pending/error/not-found components.
- Add toast and feedback primitives.
- Add shared form primitives.

Acceptance:

- Auth, inbox, ticket detail, settings, dropdowns, and composer render correctly in light and dark.
- Slow route/session loads show stable pending UI.
- Route errors can be retried.
- Async errors are user-visible.
- No source route needs one-off dark-mode hacks for basic surfaces.

### Slice 2: setup path

- Add setup checklist route or persistent setup band.
- Redirect new workspaces to setup.
- Add "Continue setup" entry in header/settings.
- Compute checklist from live data.
- Remove or gate sample-ticket CTA from production paths.

Acceptance:

- A new company can understand what to do next without guessing.
- Each checklist item links to the exact control that completes it.
- Checklist state updates through Zero.

### Slice 3: email setup polish

- Split or tab the email channel page.
- Add copy buttons for DNS and forwarding values.
- Hide dev-only actions outside dev.
- Replace raw team ID and raw signature HTML with safer controls.
- Add setup-specific empty states and help panels.

Acceptance:

- Domain/address setup is customer-ready.
- DNS records are easy to copy.
- No dev labels appear in customer-facing production UI.

### Slice 4: inbox and composer polish

- Add counts, sort, real filter menu.
- Add mobile list/detail routing.
- Add composer delivery warnings.
- Add send action variants once supported.
- Add draft persistence before heavy composer features.

Acceptance:

- Inbox feels like a real triage surface.
- Mobile does not show a squeezed desktop layout.
- Composer clearly communicates when reply delivery is not ready.

### Slice 5: assets and walkthroughs

- Generate or design small empty/setup illustrations after theme tokens land.
- Use real screenshots for product walkthrough videos.
- Keep generated videos out of the app bundle unless there is a clear product requirement.

Acceptance:

- Assets match the actual product UI and theme.
- No generated image contains fake product text or controls.
- App bundle size remains controlled.

## Browser QA Requirements For The Polish Work

Every polish implementation should include screenshots for:

- Desktop `1440x900`, light.
- Desktop `1440x900`, dark.
- Mobile `390x844`, light.
- Mobile `390x844`, dark.
- Loading state.
- Error state.
- Empty state.
- Long text and truncation.
- Keyboard focus state.

Recommended artifact location:

- `tmp/design-review/ux-polish-foundation/`
- `tmp/design-review/ux-polish-setup/`
- `tmp/design-review/ux-polish-email/`
- `tmp/design-review/ux-polish-inbox/`

## Notes On Current Reliability

The first audit agent saw Zero schema errors and auth bounces. The parent browser pass did not reproduce those after zero-cache was restarted and confirmed:

- Inbox loads.
- Sample tickets create.
- Ticket detail opens.
- Email settings load.
- Domain creation works.
- DNS detail page opens.

The dev workflow should still handle stale zero-cache/schema mismatch more clearly. At minimum, this should be documented for agents and possibly automated in `pnpm dev:clean` or a targeted zero-cache reset command.

## Concrete File Areas To Touch First

Likely first implementation files:

- `apps/web/src/styles.css`
- `apps/web/src/main.tsx`
- `apps/web/src/routes/__root.tsx`
- `apps/web/src/routes/app.tsx`
- `apps/web/src/components/app-header.tsx`
- `packages/ui/src/button.tsx`
- `packages/ui/src/card.tsx`
- `packages/ui/src/input.tsx`
- `packages/ui/src/dropdown-menu.tsx`
- `packages/ui/src/badge.tsx`
- `packages/ui/src/tooltip.tsx`
- New `apps/web/src/components/route-feedback.tsx`
- New `apps/web/src/components/feedback-toasts.tsx`
- New `apps/web/src/lib/feedback.ts`

Likely second implementation files:

- `apps/web/src/routes/app/workspaces/new.tsx`
- New `apps/web/src/routes/app/settings/setup.tsx`
- `apps/web/src/routes/app/settings.tsx`
- `apps/web/src/routes/app/settings.channels.email.tsx`
- `apps/web/src/routes/app/settings.email.domains.$domainId.tsx`
- `apps/web/src/components/inbox-list.tsx`
- `apps/web/src/routes/app/inbox.tsx`
- `apps/web/src/routes/app/inbox.t.$ticketId.tsx`
- `apps/web/src/components/composer.tsx`

## Bottom Line

The system is now at the right point for a dedicated polish phase. The underlying product foundation is credible: auth, workspaces, Zero-backed inbox, ticket detail, composer, and multi-address email settings exist. The next improvement should not be isolated visual tweaks. It should be a small UX foundation phase that creates theme tokens, dark mode, route feedback, async feedback, and form primitives, followed by setup/onboarding and email-settings polish.

That order avoids restyling the same screens twice and turns the current Phase 3 functionality into a product flow a real company can follow.
