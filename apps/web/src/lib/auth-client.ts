// better-auth React client. Talks to /api/auth/* on the API server.
//
// In dev we rely on Vite's `server.proxy` so /api/** is same-origin — no CORS
// preflight, cookies just work. `VITE_API_URL` defaults to '' so paths stay
// relative; in prod set it to e.g. 'https://api.usesalve.com'.

import { magicLinkClient, organizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

const apiUrl = import.meta.env.VITE_API_URL ?? '';

export const authClient = createAuthClient({
  baseURL: apiUrl || undefined,
  plugins: [organizationClient(), magicLinkClient()],
  fetchOptions: {
    // Always include cookies — same-origin in dev (via Vite proxy), proper
    // CORS in prod once a separate API origin is configured.
    credentials: 'include',
  },
});

export const { useSession } = authClient;

/**
 * Switch the active workspace by hitting our custom endpoint, which:
 *  - verifies membership server-side
 *  - calls better-auth's setActiveOrganization
 *  - re-issues the salve JWT cookie
 */
export async function switchWorkspace(workspaceID: string): Promise<void> {
  const res = await fetch(`${apiUrl}/api/auth/switch-workspace`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceID }),
  });
  if (!res.ok) {
    throw new Error(`switch-workspace failed: ${res.status}`);
  }
}
