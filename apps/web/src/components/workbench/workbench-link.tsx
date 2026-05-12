import { cn } from '@salve/ui';
import { useRouteContext, useRouter } from '@tanstack/react-router';
import {
  type AnchorHTMLAttributes,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import type { SessionData } from '@/lib/session-loader';
import { acquireTicketPreload, extractTicketIDFromHref } from '@/lib/ticket-preload';
import {
  makeTicketTabHref,
  resolveWorkbenchHref,
  selectActiveWorkspaceTab,
  type TabOpenSource,
  useWorkbenchStore,
  workspaceKey,
} from '@/lib/workbench';
import { useZero } from '@/lib/zero';
import { navigateWorkbenchHref } from './navigation';

// Hover-intent delay before we start preloading. Matches TanStack
// Router's `defaultPreloadDelay` (50ms) so the feel is identical to a
// real `<Link>` — a fast cursor sweep doesn't trigger preloads, but a
// deliberate hover (any user about to click) does.
const PRELOAD_INTENT_DELAY_MS = 50;

// After the cursor leaves, keep the Zero subscription warm briefly so
// a quick re-hover reuses the same preload. 5s covers the common
// "moved the mouse to read the timestamp column, now moving back".
const PRELOAD_RELEASE_GRACE_MS = 5000;

interface WorkbenchLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  source?: TabOpenSource;
  children: ReactNode;
}

export function WorkbenchLink({
  href,
  source = 'left-rail',
  children,
  className,
  onClick,
  onAuxClick,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  ...props
}: WorkbenchLinkProps) {
  const router = useRouter();
  const z = useZero();
  const { session } = useRouteContext({ from: '/app' }) as { session: SessionData };
  const workspaceID = workspaceKey(session.session.activeOrganizationId ?? null);
  const openOrReuseTab = useWorkbenchStore((state) => state.openOrReuseTab);
  const forkTab = useWorkbenchStore((state) => state.forkTab);

  // Hover/focus preload state. Three timers/handles to track:
  //   * intentTimer — scheduled debounce before we kick off any preload
  //   * releaseTimer — grace timeout after pointer leave / blur
  //   * releaseFn — Zero subscription release returned by acquireTicketPreload
  // All are refs (not state) — they don't drive rendering, and we want
  // them to survive re-renders without recreating timers.
  const intentTimerRef = useRef<number | null>(null);
  const releaseTimerRef = useRef<number | null>(null);
  const releaseFnRef = useRef<(() => void) | null>(null);

  const runPreload = useCallback(() => {
    // Route chunk preload. TanStack's `defaultPreload: 'intent'` only
    // fires on `<Link>` / `createLink` — this anchor doesn't qualify, so
    // we call `preloadRoute` explicitly. Errors are swallowed: a failed
    // preload should never affect actual navigation.
    void router.preloadRoute({ to: href }).catch(() => {});
    // Data preload only for ticket-row links — that's where the cold
    // conversation actually hurts. Left-rail / settings navigation is
    // covered by `preloadWorkspace`.
    if (source !== 'ticket-row' || releaseFnRef.current) return;
    const ticketID = extractTicketIDFromHref(href);
    if (!ticketID) return;
    try {
      releaseFnRef.current = acquireTicketPreload(z, ticketID);
    } catch {
      // Zero may throw if the schema doesn't know `ticketAnchor`; never
      // let a preload error break navigation.
    }
  }, [href, router, source, z]);

  const handleIntentEnter = useCallback(() => {
    // Cancel any pending release — user came back before the grace expired.
    if (releaseTimerRef.current != null) {
      clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }
    // Already scheduled or already preloaded — nothing to do. Route
    // preload is idempotent inside TanStack Router; data preload is
    // dedup'd by `acquireTicketPreload`'s refcount.
    if (intentTimerRef.current != null || releaseFnRef.current) return;
    intentTimerRef.current = window.setTimeout(() => {
      intentTimerRef.current = null;
      runPreload();
    }, PRELOAD_INTENT_DELAY_MS);
  }, [runPreload]);

  const handleIntentLeave = useCallback(() => {
    // Cancel the debounce if it hasn't fired yet — user moved on.
    if (intentTimerRef.current != null) {
      clearTimeout(intentTimerRef.current);
      intentTimerRef.current = null;
    }
    // Schedule release of any held Zero subscription. Skip if already
    // scheduled or nothing to release.
    if (releaseFnRef.current && releaseTimerRef.current == null) {
      releaseTimerRef.current = window.setTimeout(() => {
        releaseTimerRef.current = null;
        releaseFnRef.current?.();
        releaseFnRef.current = null;
      }, PRELOAD_RELEASE_GRACE_MS);
    }
  }, []);

  // Tear down on unmount so we don't leak Zero subscriptions if the
  // inbox row scrolls out of view mid-grace.
  useEffect(
    () => () => {
      if (intentTimerRef.current != null) clearTimeout(intentTimerRef.current);
      if (releaseTimerRef.current != null) clearTimeout(releaseTimerRef.current);
      releaseFnRef.current?.();
      releaseFnRef.current = null;
    },
    [],
  );

  function go(opts: { fork: boolean; background?: boolean }) {
    const match = resolveWorkbenchHref(href);
    if (opts.fork) {
      const ticketID =
        source === 'ticket-row' && href.startsWith('/app/inbox/t/')
          ? (href.split('/').pop()?.split('?')[0] ?? '')
          : '';
      const forkHref = ticketID ? makeTicketTabHref(ticketID) : href;
      // Background fork = Chrome-style cmd+click / middle-click. Create
      // the tab in the strip but don't activate it and don't navigate
      // the URL — the user stays on whatever they were reading.
      const tab = forkTab(workspaceID, forkHref, source, { activate: !opts.background });
      if (!opts.background) navigateWorkbenchHref(router, tab.href);
      return;
    }
    // If the active tab is a fork of the same routeId, stay on it — opening
    // a ticket from a forked inbox view should navigate inside the fork
    // rather than yanking the user back to the original inbox tab.
    const activeTab = selectActiveWorkspaceTab(workspaceID);
    const activeIsFork = activeTab?.tabKey?.includes(':fork:') ?? false;
    if (activeTab && activeIsFork && activeTab.routeId === match.route.id) {
      navigateWorkbenchHref(router, href);
      return;
    }
    const tab = openOrReuseTab(workspaceID, href, source);
    navigateWorkbenchHref(router, tab.href);
  }

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    event.preventDefault();
    // Cmd/Ctrl+click — fork in the background, like Chrome. Shift+click
    // is the "bring me along to the new tab" gesture, so it forks in
    // the foreground.
    const fork = event.metaKey || event.ctrlKey || event.shiftKey;
    const background = (event.metaKey || event.ctrlKey) && !event.shiftKey;
    go({ fork, background });
  }

  // Middle-click (scrollwheel button) → open in a new workbench tab in
  // the background. Browsers dispatch `auxclick` for non-primary buttons;
  // `click` does not fire for them in modern engines. Without this
  // handler, scrollwheel-clicks fall through to the anchor's default
  // `_self` navigation.
  function handleAuxClick(event: MouseEvent<HTMLAnchorElement>) {
    onAuxClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 1) return;
    event.preventDefault();
    go({ fork: true, background: true });
  }

  function handlePointerEnter(event: ReactPointerEvent<HTMLAnchorElement>) {
    onPointerEnter?.(event);
    handleIntentEnter();
  }
  function handlePointerLeave(event: ReactPointerEvent<HTMLAnchorElement>) {
    onPointerLeave?.(event);
    handleIntentLeave();
  }
  function handleFocus(event: FocusEvent<HTMLAnchorElement>) {
    onFocus?.(event);
    handleIntentEnter();
  }
  function handleBlur(event: FocusEvent<HTMLAnchorElement>) {
    onBlur?.(event);
    handleIntentLeave();
  }

  return (
    <a
      href={href}
      className={cn(className)}
      onClick={handleClick}
      onAuxClick={handleAuxClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      {...props}
    >
      {children}
    </a>
  );
}
