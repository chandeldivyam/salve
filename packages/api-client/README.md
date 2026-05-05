# @opendesk/api-client

Internal workspace package for Salve's first-party TypeScript SDK. It is published later as `@salve/api-client`, but inside this monorepo it stays under the `@opendesk/*` scope and is built directly from `@opendesk/action-contracts`.

```ts
import { SalveClient } from '@opendesk/api-client';

const salve = new SalveClient({
  token: process.env.SALVE_TOKEN,
  baseUrl: 'https://api.usesalve.com',
});

const page = await salve.tickets.list({ status: 'open', limit: 50 });
const ticket = await salve.tickets.get(page.data[0].id);
await salve.tickets.resolve(ticket.ticket.id);
```

The client validates inputs and outputs with the same Zod contracts that drive `/v1/openapi.json`. Write calls automatically attach `Idempotency-Key`, retry transient 5xx responses with jittered backoff, and throw `SalveApiError` for stable API error envelopes.

For cursor endpoints, use the `list` method for a single page or `listAll` / `ticketsAll` for async iteration:

```ts
for await (const ticket of salve.tickets.listAll({ status: 'open' })) {
  console.log(ticket.shortId, ticket.title);
}
```

Set `workspaceId` to send `X-Salve-Workspace` when a token can access multiple workspaces. Tests can inject `fetch`, set `retry: { maxAttempts: 1 }`, or listen to `request`, `response`, and `error` events with `client.on(...)`.
