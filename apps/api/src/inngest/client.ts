// Phase 3a — single Inngest client for the Hono process.
// Inngest 4.x has migrated event-typing helpers; for the lone outbound-email
// function we just lean on the function's `event: { event: 'name', data: {...} }`
// args inside the handler.

import { Inngest } from 'inngest';

const isDev = process.env.NODE_ENV !== 'production';
// The Inngest dev server (docker-compose: localhost:8288) discovers our
// `/api/inngest` introspection route. When `isDev=true` the client posts events
// to the dev server instead of the cloud event API and skips the event-key
// requirement.
const devBase = process.env.INNGEST_DEV_URL ?? 'http://localhost:8288';

export const inngest = new Inngest({
  id: 'opendesk',
  eventKey: process.env.INNGEST_EVENT_KEY ?? (isDev ? 'dev-key' : undefined),
  ...(isDev ? { baseUrl: devBase } : {}),
});
