// better-auth React client. Talks to /api/auth/* on the API server.
// Uses VITE_API_URL so the client builds the right absolute URL in dev.

import { magicLinkClient, organizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export const authClient = createAuthClient({
  baseURL: apiUrl,
  plugins: [organizationClient(), magicLinkClient()],
  fetchOptions: {
    // Send cookies cross-origin (web :5173 → api :3001).
    credentials: 'include',
  },
});

export const { useSession } = authClient;

/**
 * Switch the active workspace by hitting our custom endpoint, which:
 *  - verifies membership server-side
 *  - calls better-auth's setActiveOrganization
 *  - re-issues the opendesk JWT cookie
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
