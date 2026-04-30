# packages/zero-schema · AGENTS.md

Zero's view of the Postgres source of truth, plus parameterized read-side queries (`defineQueries`). Read root `AGENTS.md` first.

## Layout

```
src/
├── index.ts        # public re-exports: schema, queries, builder, types
├── schema.ts       # the createSchema(...) call + relationships + builder
└── queries.ts      # defineQueries({...}) with applyWorkspaceScope helper
```

## Notable patterns

- **Schema mirrors Drizzle.** Domain tables (`customer`, `ticket`, `message`, `attachment`, `audit_event`) plus minimal auth read-views (`user`, `organization`, `member` — id/name/email/image only, never password hashes). Drizzle is the source of truth for DDL; Zero schema is hand-written to match.
- `createSchema({ tables, relationships, enableLegacyMutators: false, enableLegacyQueries: false })` — both legacy flags must be `false` once `defineMutators` and `defineQueries` are wired, or `z.query` becomes the wrong type.
- **No `definePermissions`.** Zero 1.3 deprecates it for custom-mutator setups. Permissions live inline in queries (this file) and mutators (`@opendesk/mutators`). The plan committed to assertion-based perms; we ship without the DSL.
- **Timestamps map transparently.** Zero's `pg-data-type.ts` converts Postgres `timestamptz` → JS number (epoch ms). Declare columns as `number().from('created_at')` and the conversion happens both ways. No mirror columns, no triggers, no ISO strings.
- **`createBuilder(schema)` is exported** so mutators and queries share the same type-safe builder.
- **`DefaultTypes` augmentation** declares the `context` type as `AuthData | undefined` so `<ZeroProvider context={...}>` is type-checked end-to-end.

## Query pattern

Every query goes through `applyWorkspaceScope(q, ctx)` — a single helper that adds `.where('workspaceID', '=', ctx.workspaceID)`. This is the multi-tenant boundary on the read side. **Missing this on a single query = data leak.**

```ts
// queries.ts pattern (mirrors zbugs/shared/queries.ts:16-22)
function applyWorkspaceScope<TQuery>(q: TQuery, auth: AuthData | undefined): TQuery {
  return q.where('workspaceID', '=', auth?.workspaceID ?? '__no-workspace__') as TQuery;
}

export const queries = defineQueries({
  inboxOpen: defineQuery(z.object({}), ({ ctx }) =>
    applyWorkspaceScope(
      builder.ticket.where('status', 'IN', ['open', 'in_progress', 'snoozed'])
        .related('customer').related('assignee')
        .orderBy('updatedAt', 'desc'),
      ctx,
    ),
  ),
  ticketByID: defineQuery(z.object({ id: z.string() }), ({ ctx, args }) =>
    applyWorkspaceScope(builder.ticket.where('id', args.id).related('messages.attachments').one(), ctx),
  ),
  // ...
});
```

Lint rule (planned): ban raw `builder.<table>` access outside this file. Use the helpers.

## Gotchas hit

- Zero 1.3 logs `"No permissions found ... no tables will be syncable"` if you have neither `definePermissions` nor any other auth scaffolding. We dropped that warning by removing `definePermissions` entirely (per agents.md guidance) and rely on query-side filters + mutator assertions.
- `<ZeroProvider context={...}>` requires the `context` shape to match the augmented `DefaultTypes.context`. We synthesise it client-side from the better-auth session (`{ sub, workspaceID, role: null }`); zero-cache receives the real JWT via cookie forwarding for true server-side auth.
- `json<unknown>()` doesn't satisfy Zero's typed builder constraints. Use bare `json()` for free-form jsonb payloads (e.g. `audit_event.payload`, delivery `provider_meta`).
- `enableLegacyQueries: true` is needed only as a temporary measure when `defineQueries` isn't yet populated — flipping to `false` makes `z.query` undefined.

## Where to look

| File | What it is |
|---|---|
| `src/schema.ts` | All `table()` calls, `relationships()`, `createSchema(...)`, `createBuilder(...)`, `AuthData` type, `DefaultTypes` augmentation. |
| `src/queries.ts` | `defineQueries({...})` + `applyWorkspaceScope` helper. |
| `src/index.ts` | Public surface — what consumers import. |

Reference: `/tmp/zero-mono/apps/zbugs/shared/{schema,queries}.ts` is the canonical pattern.
