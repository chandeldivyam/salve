# Salve — Hero Video Design

Light-mode, near-flat. The video must look like a calm, real product surface — not a marketing illustration.

## Palette (oklch values mirror apps/web/src/styles.css :root)

- **bg-canvas:** `oklch(0.985 0.002 320)` — page background
- **bg-panel:** `oklch(0.97 0.003 320)` — rail, secondary surfaces
- **bg-elevated:** `oklch(0.945 0.004 320)` — selected/elevated rows
- **bg-popover:** `#ffffff` — composer card, toast
- **fg-primary:** `oklch(0.2 0.01 320)` — headlines, ticket subjects
- **fg-secondary:** `oklch(0.32 0.012 320)` — names, body
- **fg-tertiary:** `oklch(0.5 0.012 320)` — previews
- **fg-quaternary:** `oklch(0.62 0.012 320)` — timestamps, hints
- **line-quiet:** `oklch(0.95 0.004 320)` — row dividers
- **line-default:** `oklch(0.9 0.006 320)` — chips, inputs
- **brand:** `oklch(0.54 0.115 270)` — accent purple; Aria, unread dot, row stripe
- **brand-soft:** `oklch(0.97 0.014 270)` — soft tint on unread rows, agent pills
- **brand-border:** `oklch(0.86 0.05 270)` — agent pill border
- **amber:** `oklch(0.78 0.14 80)` — second human avatar (warm contrast)
- **green:** `oklch(0.62 0.14 150)` — resolved badge
- **green-soft:** `oklch(0.95 0.04 150)` — resolved row background

## Typography

- **Font family:** Inter — fall back to system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif. The compiler embeds Inter automatically.
- **Wordmark/UI title:** 600 weight, -0.01em letter-spacing.
- **Inbox subject:** 13.5px / 500 weight on `--fg-secondary`. Single line, ellipsis.
- **Inbox preview:** 12.5px / 400 on `--fg-tertiary`.
- **Inbox name:** 14px / 600 on `--fg-primary`.
- **Timestamps:** 12px / 400 on `--fg-quaternary`. `font-variant-numeric: tabular-nums`.

## Corners

- Rows: no rounding (flush dividers).
- Cards, popovers, chips, inputs: 8px.
- Pills (agent status, resolved badge, filter chips): 999px (fully rounded).
- Avatars: 50% (humans), 8px (agents — distinct shape signals "not a person").

## Spacing & density

Linear-aligned breathing room. Generous, not cramped.

- Section padding: 20–24px.
- Row padding: 14px vertical, 24px horizontal.
- Internal gaps: 8–14px.

## Depth

**Subtle.** Light-mode software, not iOS. One shadow tier only:

- Composer / toast / popover: `0 1px 2px rgba(0,0,0,0.04), 0 8px 24px -16px rgba(0,0,0,0.12)`.
- Nothing else casts a shadow.
- No glow, no neon, no gradients. The accent color shows itself in small doses (stripe, pill, dot).

## Motion principles

- **Ease:** `power3.out` for entrances, `power2.in` for exits, `power1.inOut` for camera holds. No bouncy springs.
- **Durations:** 0.2–0.45s for UI element entrances. 0.6–1.0s for camera pushes. Hold beats for 0.6–1.2s — never rush.
- **Camera:** sparing 1.0 → 1.02 push on reveals, return to 1.0 between beats. No rotation, no skew.
- **Stagger:** 80–120ms when multiple elements appear together.
- **No bouncing, no springs, no overshoot.** This is enterprise software, not consumer.

## What NOT to do

- No dark mode. The marketing site is light; the video must match.
- No buzzword overlays ("AI-powered", "Real-time", "Built for scale"). No banner text. The UI is the message.
- No purple gradients. The brand purple shows only as flat fills on small elements (avatars, dots, stripes, pills).
- No motion on text once it's settled (no breathing, no bobbing).
- No 3D, no parallax, no isometric tilt. Flat product UI, period.
- No fictitious company logos (Northwind, Acme, etc.) except in the workspace switcher as a small "NS" mark.
- Don't show the cursor at rest. Cursor only appears when it has work to do.
