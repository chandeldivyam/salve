// /app layout — gates everything behind better-auth. Also wires the Zero
// React provider here (NOT in __root.tsx) so signed-out users never open a
// WebSocket to zero-cache. The provider receives the live `userID` from
// the better-auth session; the JWT cookie is forwarded by zero-cache itself
// (ZERO_QUERY_FORWARD_COOKIES / ZERO_MUTATE_FORWARD_COOKIES in
// apps/zero-cache/.env).

import { mutators } from '@opendesk/mutators';
import { TooltipProvider } from '@opendesk/ui';
import { schema } from '@opendesk/zero-schema/schema';
import { ZeroProvider } from '@rocicorp/zero/react';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { BrandSplash } from '@/components/brand-splash';
import { RouteErrorFeedback, RouteNotFoundFeedback } from '@/components/route-feedback';
import { WorkbenchShell } from '@/components/workbench/shell';
import { fetchSession, listOrganizations, type SessionData } from '@/lib/session-loader';
import { useZero, ZERO_CACHE_URL } from '@/lib/zero';
import { preloadWorkspace } from '@/lib/zero-preload';

export const Route = createFileRoute('/app')({
  beforeLoad: async () => {
    // Fetch session + org list in parallel. Both are cached at module
    // level (lib/session-loader) so subsequent navigations resolve
    // synchronously and the workbench shell can render without a
    // useEffect-driven flicker. The org list is a hard prerequisite for
    // the workspace switcher; failing the fetch is non-fatal (we just show
    // no orgs).
    const [session] = await Promise.all([fetchSession(), listOrganizations()]);
    if (!session) {
      throw redirect({ to: '/auth/sign-in' });
    }
    return { session };
  },
  pendingComponent: BrandSplash,
  errorComponent: RouteErrorFeedback,
  notFoundComponent: RouteNotFoundFeedback,
  component: AppLayout,
});

function AppLayout() {
  const { session } = Route.useRouteContext() as { session: SessionData };

  // Zero needs at minimum a userID; pass `'anon'` for users without one (e.g.
  // mid-sign-out). `cacheURL` points at zero-cache-dev in dev. The `context`
  // is read by Phase 2b custom queries/mutators — the JWT is also forwarded
  // by zero-cache itself via cookie forwarding, so this is a *client-side
  // hint* used for optimistic mutations and query parameterisation. Memoised
  // so we don't tear down + reconnect the WebSocket on every render.
  const zeroOpts = useMemo(
    () => ({
      userID: session.user.id,
      cacheURL: ZERO_CACHE_URL,
      schema,
      mutators,
      context: {
        sub: session.user.id,
        workspaceID: session.session.activeOrganizationId ?? null,
        role: null as 'owner' | 'admin' | 'agent' | null,
      },
    }),
    [session.user.id, session.session.activeOrganizationId],
  );

  // WorkbenchShell lives here (not in each leaf layout) so it mounts ONCE
  // for the lifetime of the /app subtree. The auth/Zero boundary stays
  // intact; tabs and command search are a UI layer over normal routes.
  return (
    <ZeroProvider {...zeroOpts}>
      <TooltipProvider delayDuration={150}>
        <WorkspacePreloader />
        <WorkbenchShell session={session}>
          <Outlet />
        </WorkbenchShell>
      </TooltipProvider>
    </ZeroProvider>
  );
}

/**
 * Subscribes the inbox + workspace metadata queries outside React for the
 * lifetime of `<ZeroProvider>` so they stay warm in IndexedDB across SPA
 * navigations. Without this, navigating away from /app/inbox tears down
 * the subscription, the TTL clock starts, and a quick reload can race the
 * cache. Mirrors zbugs `src/zero-preload.ts` + the `preload()` calls in
 * its list-page / issue-page lifecycle effects.
 */
function WorkspacePreloader() {
  const z = useZero();
  useEffect(() => preloadWorkspace(z), [z]);
  return null;
}
