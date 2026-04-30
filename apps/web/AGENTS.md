# apps/web · AGENTS.md

The agent UI. React 19 + Vite 8 + TanStack Router (file-based) + Tailwind v4 + Zero. Read the root `AGENTS.md` first.

## Notable patterns

- **File-based routing** under `src/routes/`. `__root.tsx` wraps everything; `app.tsx` is the auth-gated layout that mounts `<ZeroProvider>`. Routes nest via dotted filenames: `inbox.t.$ticketId.tsx` is `/app/inbox/t/:ticketId` under `inbox.tsx`.
- **`<ZeroProvider>` lives inside `/app`**, not at the root. Signed-out users never connect to zero-cache. Pass `context: { sub, workspaceID, role: null }` for the optimistic mutator path; the JWT cookie carries the real auth to zero-cache.
- **Same-origin via Vite proxy**: `/api/**` proxies to `:3001` in `vite.config.ts`. Auth-client base URL is `''` (relative). No CORS in dev. Production deploys *will* need real CORS — that's a Phase 6 thing.
- **Two-pane shell** in `inbox.tsx`: `~360px` list left, flex-1 detail right. Selected row: `bg-brand-50` + `border-l-4 border-brand-200`. Linear-style density.
- **State**: Zero (server) + Zustand (ephemeral UI: search input, sidebar collapse, etc.). No TanStack Query alongside — it fights Zero's reactive cache.
- **Forms**: `noValidate` on `<form>` + `aria-invalid` + inline red errors. Never browser-native validation. See `routes/auth/sign-{in,up}.tsx` for the pattern.
- **Composer**: Tiptap v2 (StarterKit + Link + Mention) with a hand-rolled toolbar (lucide-react icons). Internal-note tab tints the whole composer amber so agents can never accidentally send internal notes to customers. `⌘↩` to send.
- **Inbox virtualization**: `@tanstack/react-virtual` even when there are 3 rows — load-bearing for production. Estimated row size is 96px to avoid first-paint flicker.
- **Keyboard nav**: J/K/↑/↓ in the inbox to move selection, Enter to open, E to resolve. Lives in `components/inbox-list.tsx`.

## Brand & design

- Brand color: muted teal-leaning blue (`oklch(~0.58 0.115 200)`) — Salve = healing balm. Tokens in `src/styles.css` `@theme {}` block. `--color-brand-{50,100,500,600,700,900}`.
- **Never use `slate-*` classes for accent colors** in `@opendesk/ui` components. Always `brand-*`. Slate is fine for body copy and borders.
- Logo is a hand-pathed SVG leaf (`@opendesk/ui` `Logo` component) in `text-brand-600`. Optional `withWordmark` shows "Salve" beside it.

## Gotchas hit

- Tailwind v4 doesn't auto-detect classes from sibling workspace packages. Explicit `@source "../../../packages/ui/src/**/*.{ts,tsx}"` in `styles.css` is required, otherwise every shadcn component renders with no background fill.
- TanStack Router's `routeTree.gen.ts` must be regenerated before `tsc --noEmit` will pass. The router plugin in `vite.config.ts` regenerates on file changes; just run `pnpm dev` once after pulling.
- `lucide-react` must be a direct dep of `apps/web`, not just `@opendesk/ui`, or Rolldown auto-codesplit fails to resolve it from route files.
- TanStack Router devtools (`@tanstack/react-router-devtools`) version-lags the router by 1-2 versions; we omit it for now.

## Where to look

| File | What it is |
|---|---|
| `src/routes/__root.tsx` | App shell + styled `errorComponent` (Card + Reload + Sign-in link) |
| `src/routes/app.tsx` | Auth-gated layout; mounts `<ZeroProvider>` and `<TooltipProvider>` |
| `src/routes/app/inbox.tsx` | Two-pane shell (list + detail outlet) |
| `src/routes/app/inbox.t.$ticketId.tsx` | Ticket detail: header, thread, composer |
| `src/components/inbox-list.tsx` | TanStack Virtual + filter chips + search + keyboard nav |
| `src/components/composer.tsx` | Tiptap composer with attachments + internal-note tab |
| `src/lib/zero.ts` | Zero client init + `useZero` re-export |
| `src/lib/auth-client.ts` | better-auth React client |
| `src/lib/session-loader.ts` | Fetch helpers for TanStack Router `beforeLoad` |
| `src/styles.css` | Tailwind v4 entry + `@theme` brand tokens + `@source` glob |
