# packages/ui · AGENTS.md

shadcn-derived primitives. **Hand-written, not from `npx shadcn add`.** Read root `AGENTS.md` first.

## Components shipped

```
src/
├── avatar.tsx        # @radix-ui/react-avatar, with initials fallback
├── badge.tsx         # cva variants: default | success | warning | danger | muted
├── button.tsx        # cva default + outline + ghost + link variants; brand-* tokens
├── card.tsx          # Card, CardHeader, CardTitle (accepts `as` prop), CardDescription, CardContent
├── dropdown-menu.tsx # @radix-ui/react-dropdown-menu — used for status, priority, assignee pickers
├── input.tsx         # styled <input>, brand-* focus ring, aria-invalid red-bordered
├── label.tsx         # @radix-ui/react-label
├── logo.tsx          # hand-pathed leaf SVG, optional withWordmark
├── scroll-area.tsx   # @radix-ui/react-scroll-area — used for thread scrollers
├── separator.tsx     # @radix-ui/react-separator
├── skeleton.tsx      # animate-pulse loading shimmer
├── tooltip.tsx       # @radix-ui/react-tooltip
├── utils.ts          # cn() = clsx + tailwind-merge
└── index.ts          # public exports
```

## Notable patterns

- **Brand tokens, not slate hardcodes.** Components reference `bg-brand-600`, `hover:bg-brand-700`, `focus-visible:ring-brand-500`, `text-brand-700`. The brand palette (50/100/500/600/700/900) lives in `apps/web/src/styles.css` `@theme {}`. Slate is reserved for body copy + neutral borders.
- **`cva` for variants** with `class-variance-authority`. Default exports the component plus a `Props = VariantProps<typeof cva>` type.
- **`cn()` everywhere** (`utils.ts`) for class composition with `tailwind-merge` resolution.
- **`CardTitle` takes an `as` prop** (default `"h3"`) so auth pages can pass `as="h1"` for accessibility / SEO. Title and description are block-level — never inline at wide viewports.
- **`Logo`** is a hand-authored `<svg>` (no external icon dep) so it doesn't break on Tailwind purge or SSR. `withWordmark` toggles the "Salve" text alongside.
- **No font import.** System fonts only. Phase 5+ may add Geist / Inter.

## Tailwind v4 wiring (gotcha)

Tailwind v4's `@tailwindcss/vite` auto-detects content from the project root by default — but **doesn't pick up workspace siblings**. `apps/web/src/styles.css` has:

```css
@import "tailwindcss";
@source "../../../packages/ui/src/**/*.{ts,tsx}";

@theme {
  --color-brand-50: oklch(0.97 0.020 200);
  --color-brand-100: oklch(0.93 0.040 200);
  --color-brand-500: oklch(0.62 0.115 200);
  --color-brand-600: oklch(0.56 0.115 200);
  --color-brand-700: oklch(0.50 0.105 200);
  --color-brand-900: oklch(0.32 0.075 200);
}
```

If you add a new package consumed by `apps/web` that uses Tailwind classes, **add another `@source` line**.

## Design bar

- **Linear-tight density** for table rows, buttons, inputs.
- **Plain.com-clean** for composers, forms, modals — generous whitespace, clear hierarchy.
- **Internal note** styling is amber/yellow with a lock icon — **must be unmistakable** vs customer-facing reply (brand-teal). The composer tints amber when the Internal-note tab is active.

## Adding a new primitive

1. Pick the radix primitive if it exists (don't reinvent).
2. Write the component as a forwardRef with `cva` variants.
3. Use `cn()` for class merging.
4. Default styling = brand tokens (not slate hardcodes for accents).
5. Export from `src/index.ts`.
6. Add to this file's "Components shipped" list.

## Gotchas hit

- `lucide-react` icons must be a direct dep of any app that uses them (not just `@salve/ui`) or Rolldown auto-codesplit fails to resolve.
- `@radix-ui/react-tooltip` requires a single `<TooltipProvider>` wrapping the app — placed in `apps/web/src/routes/app.tsx`.
- The native browser focus ring is suppressed (`focus:outline-none`) and replaced with `focus-visible:ring-2 focus-visible:ring-brand-500`. Keep this consistent across all interactive components.
- Workspace switcher is currently a native `<select>` (Phase 1 simplicity); the dropdown-menu primitive lands a Combobox replacement in Phase 4+.
