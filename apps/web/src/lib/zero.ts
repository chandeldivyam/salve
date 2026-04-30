// Zero client setup for the agent web app.
//
// We initialise lazily inside the `/app` layout (see `routes/app.tsx`) — only
// authenticated users with a workspace get a Zero connection. A signed-out
// visitor never opens a WebSocket. The opendesk JWT cookie set by apps/api is
// HTTP-only, so the browser can't read it directly; we instead pull `userID`
// (= `session.user.id`) and `workspaceID` (= `session.session.activeOrganizationId`)
// from `/api/auth/get-session` and pass them into `<ZeroProvider>`. zero-cache
// itself reads the JWT cookie via `ZERO_QUERY_FORWARD_COOKIES=true` /
// `ZERO_MUTATE_FORWARD_COOKIES=true`.

import { schema } from '@opendesk/zero-schema/schema';

export const ZERO_CACHE_URL =
  // Vite-injected env override; defaults to local zero-cache-dev.
  (import.meta.env.VITE_ZERO_CACHE_URL as string | undefined) ?? 'http://localhost:4848';

export { schema };
