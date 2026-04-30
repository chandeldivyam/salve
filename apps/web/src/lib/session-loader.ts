// Tiny session client used in TanStack Router's `beforeLoad` to gate /app routes.
// We can't use React hooks in beforeLoad, so this fetches /api/auth/get-session
// directly. The result is also handed to the component via loaderDeps to avoid
// a second round-trip on initial mount.

// Default to '' (same-origin) — Vite's `server.proxy` shuttles /api/** to the
// Hono server in dev. In prod, set VITE_API_URL to the API origin.
const apiUrl = import.meta.env.VITE_API_URL ?? '';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface SessionData {
  user: SessionUser;
  session: {
    activeOrganizationId: string | null;
  };
}

export async function fetchSession(): Promise<SessionData | null> {
  const res = await fetch(`${apiUrl}/api/auth/get-session`, {
    credentials: 'include',
  });
  if (!res.ok) return null;
  const json = (await res.json()) as SessionData | null;
  // better-auth returns null when there's no active session.
  if (!json?.user) return null;
  return json;
}

export interface OrgMembership {
  id: string;
  organizationId: string;
  role: string;
  organization?: { id: string; name: string; slug: string };
}

export async function listOrganizations(): Promise<
  Array<{ id: string; name: string; slug: string }>
> {
  const res = await fetch(`${apiUrl}/api/auth/organization/list`, {
    credentials: 'include',
  });
  if (!res.ok) return [];
  const json = (await res.json()) as Array<{ id: string; name: string; slug: string }>;
  return json ?? [];
}
