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
  emailVerified: boolean;
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
let cachedSession: SessionData | null | undefined;
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

/** Invalidate the cached session + org list — call on sign-out so the
 *  next /app entry refetches and redirects to sign-in if needed. */
export function clearSessionCache(): void {
  cachedSession = undefined;
  inflight = null;
  cachedOrgs = undefined;
  orgsInflight = null;
}

export interface OrgMembership {
  id: string;
  organizationId: string;
  role: string;
  organization?: { id: string; name: string; slug: string };
}

export type OrgRow = { id: string; name: string; slug: string };

// Same cache shape as `cachedSession` — `undefined` = not fetched,
// `OrgRow[]` = resolved. The org list rarely changes per session and the
// AppHeader reads it on every mount; without caching, navigating between
// /app sub-routes would re-fetch on every sub-layout remount and the
// workspace switcher would briefly flash empty.
let cachedOrgs: OrgRow[] | undefined;
let orgsInflight: Promise<OrgRow[]> | null = null;

async function listOrganizationsUncached(): Promise<OrgRow[]> {
  try {
    const res = await fetch(`${apiUrl}/api/auth/organization/list`, {
      credentials: 'include',
    });
    if (!res.ok) return [];
    const json = (await res.json()) as OrgRow[];
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

export async function listOrganizations(): Promise<OrgRow[]> {
  if (cachedOrgs !== undefined) return cachedOrgs;
  if (orgsInflight) return orgsInflight;
  orgsInflight = listOrganizationsUncached().then((o) => {
    cachedOrgs = o;
    orgsInflight = null;
    return o;
  });
  return orgsInflight;
}

/** Synchronous accessors — return cached value or `null/[]` if not yet
 *  fetched. Use these when you want to render from cache without waiting
 *  for an effect cycle (e.g. AppHeader after the initial /app beforeLoad
 *  has already populated the cache). */
export function getCachedSession(): SessionData | null {
  return cachedSession ?? null;
}
export function getCachedOrgs(): OrgRow[] {
  return cachedOrgs ?? [];
}
