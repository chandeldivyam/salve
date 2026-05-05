# apps/inngest · AGENTS.md

Placeholder workspace for Inngest functions. The current functions still live alongside the Hono server at `apps/api/src/inngest/` because they share email builders, db helpers, and the same imports. Phase 3b (inbound email) will start moving functions here. Read root `AGENTS.md` first.

## Why this workspace exists

Architecturally, Inngest functions are a separate concern from the API server: they run in a different process model (durable, retried, idempotent step machines), they don't see HTTP requests, and they only care about events. Splitting them out lets us:

- Deploy the function workers independently of the API.
- Keep `apps/api`'s deps focused on request-handling.
- Run a separate `inngest dev` process locally without restarting the API.

The split hasn't happened yet because the existing function (`outbound-email`) imports too many helpers from `apps/api/src/email/*` to be worth extracting before the inbound function lands.

## What goes here (when it does)

- **Channel-agnostic event handlers**. `delivery/message.requested`, `delivery/message.bounced`, `inbound/message.received` — the polymorphic delivery layer.
- **Domain-event side effects**. `ticket/created`, `customer/seen` — fan-outs that aren't request-scoped.
- **Recovery crons**. Last-ditch sweepers that should be no-ops in healthy operation. Never the primary mechanism — Inngest events from server mutators are.
- **Webhook delivery worker** (post-v1, see RFC §18).

## What does NOT go here

- **DB pollers.** No table scans for "things to send / process". Inngest is the durable queue.
- **Synchronous API logic.** That belongs in `apps/api/src/public-api/<domain>.ts` or in an executor.
- **Mutator logic.** Mutators run on the client and server through Zero. Inngest functions can dispatch mutations via the api-client + a service-account token, but that's a downstream consumer, not the canonical path.

## Event taxonomy

Event names are channel-agnostic and dotted. Two parts: domain (`delivery`, `ticket`, `customer`) and verb (`message.requested`, `created`, `seen`). Never embed the channel — `delivery/message.requested` works for email, chat, WhatsApp, SMS via a `channel` discriminator in the payload.

The full event schema lives in `apps/api/src/inngest/events.ts`. All sender call sites should import from there, not literal-string the name.

## Idempotency

Every Inngest event carries an idempotency key in its payload. For events fired post-mutation, use the resource id (e.g. `messageID`, `ticketID`). For events fired from action executors, propagate `ctx.idempotencyKey` through. Functions then dedupe natively; retries are safe.

## When to migrate from `apps/api/src/inngest/` to here

Probably during Phase 3b when the inbound-email function lands and the email-builder helpers can be extracted to `packages/core/src/email/`. Until then, leaving functions colocated with the API saves a deploy boundary and keeps the diff small.

## Where to look

- **Today**: `apps/api/src/inngest/{events.ts, functions/}`. That's where all current functions live.
- **Future**: `src/functions/` here, with `src/index.ts` as the registration entrypoint.
- **Plan**: `tmp/research/inngest-multichannel-design.md` (6900-word design doc — required reading before any function work).
