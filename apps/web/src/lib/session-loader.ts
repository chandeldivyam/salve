// Tiny session client used in TanStack Router's `beforeLoad` to gate /app routes.
// We can't use React hooks in beforeLoad, so this fetches /api/auth/get-session
// directly. The result is cached at module level so subsequent navigations
// inside `/app` (which re-trigger `beforeLoad` on every match) resolve
// synchronously instead of re-hitting the auth endpoint and putting the route
// into a pending state. Without this cache, every in-app click would briefly
// re-trigger the auth-gate pending UI.

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

// `undefined` = not yet fetched; `null` = fetched, no session; otherwise the
// resolved session. Cleared by `clearSessionCache()` on sign-out so the next
// /app entry refetches.
let cachedSession: SessionData | null | undefined = undefined;
let inflight: Promise<SessionData | null> | null = null;

async function fetchSessionUncached(): Promise<SessionData | null> {
  const res = await fetch(`${apiUrl}/api/auth/get-session`, {
    credentials: 'include',
  });
  if (!res.ok) return null;
  const json = (await res.json()) as SessionData | null;
  if (!json?.user) return null;
  return json;
}

export async function fetchSession(): Promise<SessionData | null> {
  if (cachedSession !== undefined) return cachedSession;
  if (inflight) return inflight;
  inflight = fetchSessionUncached().then((s) => {
    cachedSession = s;
    inflight = null;
    return s;
  });
  return inflight;
}

/** Invalidate the cached session — call on sign-out so subsequent /app
 *  navigations re-trigger the auth fetch and redirect to sign-in. */
export function clearSessionCache(): void {
  cachedSession = undefined;
  inflight = null;
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
