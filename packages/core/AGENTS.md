# packages/core · AGENTS.md

Shared domain types + pure utilities. Mostly a placeholder right now — fills up in Phase 3+. Read root `AGENTS.md` first.

## What goes here

- **Pure functions** with no Drizzle / Zero / Hono / React deps. Importable from any app or package.
- Domain types that aren't already in `@salve/db` (Drizzle types) or `@salve/zero-schema` (Zero `Row<T>` types).
- Validation helpers, formatters, parsing utilities.

## What does NOT go here

- Drizzle schema → `@salve/db`.
- Zero schema / queries → `@salve/zero-schema`.
- Mutator logic → `@salve/mutators`.
- React components → `@salve/ui`.
- Server-only code (postgres client, S3 SDK, SES) → `apps/api`.

## Coming in Phase 3+

The plan slates these for `packages/core/src/email/`:

- `strip-quoted.ts` — quoted-text-stripping selector list. Removes `On <date>, <name> wrote:` and similar quote markers from inbound message bodies. Used by the inbound email driver.
- `forward-from-colleague.ts` — detects when an internal admin forwards a customer's email (B2B common case). Reattributes the message to the original sender.
- `subject-normalize.ts` — strips `Re:` / `Fwd:` / `Aw:` / `[Prefix]` / `Zendesk's "Request received:"` etc. for threading subject revalidation.
- `reply-token.ts` — HMAC-signed reply-plus token shared between Phase 3a (signing in mailer) and Phase 3b (verifying in inbound parser). Format: `reply+t_<base32(ticketID)>_<base32(hmac)>@reply.usesalve.com`.

Phase 4+ adds SLA math (`sla.ts`).

## Layout (today)

```
src/
└── index.ts        # placeholder export — currently SERVICE_NAME constant
```

## Notable patterns

- Pure ESM. `type: "module"` in `package.json`.
- No build step — TS source is consumed directly by Vite/tsx in workspaces that depend on this package.
- Add a `.test.ts` next to each `.ts` when it lands; vitest will pick them up once tests are wired (Phase 5).

## Where to look

- Reference for SLA math: zbugs doesn't have SLA, so we'll improvise; Plain.com's documented SLA model is the inspiration.
