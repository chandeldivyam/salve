# packages/mutators · AGENTS.md

The write path. Custom mutators that run on **both client (optimistic) and server (authoritative)**. Read root `AGENTS.md` first.

## Layout

```
src/
├── index.ts    # defineMutators({ ticket: { create, update, ... }, message: { send, ... } })
├── auth.ts     # assertIsLoggedIn, assertHasWorkspace, assertCanModifyTicket, ...
└── error.ts    # MutationError + MutationErrorCode enum
```

## Notable patterns

- **One source of truth for mutator logic.** The same code runs on the client (for optimistic UI) and on the server (in `apps/api/src/server-mutators.ts`, which wraps these to add post-commit logic like Inngest dispatch).
- **Three required steps per mutator**:
  1. **Validate input** (Zod schema in `args`).
  2. **Assert authorization** via helpers from `auth.ts`. Throw `MutationError` with the right `MutationErrorCode`.
  3. **Write via `tx.mutate.<table>.{insert,update,delete}`** — never via raw SQL.
- **Workspace scoping is mandatory.** Every write filters by `workspaceID = ctx.workspaceID` (read-side too — see `@opendesk/zero-schema`'s `applyWorkspaceScope`). Cross-workspace probes return `MutationErrorCode.CROSS_WORKSPACE` with the **generic "not found" message** to avoid leaking entity existence (zbugs `auth.ts:53` pattern).
- **Use `crypto.randomUUID()` for new row IDs**, not `nanoid` — the schema's UUID columns reject nanoid's character set.
- **Ticket transitions emit audit_event rows** in the same Zero transaction so the audit trail is atomic with the state change.

## Mutator catalog (current)

```
ticket: { create, update, assign, snooze, close, reopen }
message: { send }
```

Phase 3+ adds: `tag.{attach,detach}`, `view.{create,update,delete}`, `macro.{create,use}`, `kb.{publish,update}`, `viewState.markRead`, `domain.{create,verify}`.

## MutationError + assertions

Mirror of zbugs's `shared/error.ts:13-24` and `shared/auth.ts:23-86`:

```ts
export class MutationError extends Error {
  constructor(message: string, public code: MutationErrorCode, public id?: string, public cause?: unknown) { super(message); }
}

export const enum MutationErrorCode {
  NOT_LOGGED_IN, NO_WORKSPACE, NOT_AUTHORIZED, NOT_FOUND, INVALID_INPUT, CROSS_WORKSPACE,
}

export function assertIsLoggedIn(auth: AuthData | undefined): asserts auth { if (!auth) throw new MutationError(...) }
export function assertHasWorkspace(auth: AuthData): asserts auth is AuthData & { workspaceID: string } { ... }
export async function assertCanModifyTicket(tx, auth, ticketID) { /* re-fetch + workspace + role check */ }
```

## Server-side wrapping

`apps/api/src/server-mutators.ts` does:

```ts
defineMutators(mutators, {
  ticket: {
    create: defineMutator(createTicketArgs, async ({ tx, args, ctx }) => {
      await mutators.ticket.create.fn({ tx, args, ctx });        // shared client impl
      postCommitTasks.push(() => inngest.send({ name: 'ticket/created', data: { ticketID: args.id } }));
    }),
  },
  // ...
});
```

Pattern from `/tmp/zero-mono/apps/zbugs/server/server-mutators.ts:25-80`. Server overrides run *instead of* client when zero-cache replays the mutation server-side.

## Gotchas hit

- The optimistic client `<ZeroProvider context>` carries `role: null` (we don't fetch the full role on the React side). `assertHasWorkspace` checks `workspaceID` only and is permissive on `role`. The **server-side** context has the JWT-derived role for any role-gated mutators.
- `assertCanModifyTicket` re-fetches the ticket via `tx.run(builder.ticket.where('id', id).one())` rather than trusting client args — defends against stale JWTs and tampered mutations.
- Cross-workspace probes return `MutationError` with code `CROSS_WORKSPACE` and a generic "ticket not found" message. **Don't tell the attacker which case they're in.**
- `nanoid` for IDs: rejected by Postgres UUID columns. Use `crypto.randomUUID()` everywhere.

## Where to look

| File | What it is |
|---|---|
| `src/index.ts` | The mutator catalog: `defineMutators({ ... })`. |
| `src/auth.ts` | Assertion helpers — every mutator opens with these. |
| `src/error.ts` | `MutationError` + enum codes. |

Reference: `/tmp/zero-mono/apps/zbugs/shared/{mutators,auth,error}.ts`.
