// Phase 2c inbox list — Linear-tight, virtualized, keyboard-driven.
// Phase 40: refactored to subscribe to `ticketsForView({viewID, viewQuery})`.
// The hardcoded 4-button strip is now `<InboxViewStrip>`. Built-in views
// (`builtin:all`, `builtin:unassigned`, `builtin:mine`, `builtin:resolved`)
// drive the same query path as custom views. Free-text search remains
// client-side for v1; FTS intersection lands in T-4006.

import { mutators } from '@opendesk/mutators';
import { Button, Input } from '@opendesk/ui';
import {
  type Filter,
  INBOX_INITIAL_PAGE,
  INBOX_PAGE_GROWTH,
  type ViewTicketRow as InboxRowData,
  MAX_INBOX_LIMIT,
  queries,
  type View,
  type ViewMember,
  type ViewQuery,
  type ViewSort,
} from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { Link, useNavigate, useRouteContext, useSearch } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowRight, Inbox, ListChecks, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BulkActionBar } from '@/components/inbox/bulk-action-bar';
import { InboxFilterBar } from '@/components/inbox/inbox-filter-bar';
import { InboxRow } from '@/components/inbox/inbox-row';
import { InboxViewStrip } from '@/components/inbox/inbox-view-strip';
import { SaveViewModal } from '@/components/inbox/save-view-modal';
import { useHoverTargetRoot, useHoverTargetStore } from '@/lib/commands/hover-target';
import { useKeyBinding } from '@/lib/commands/use-key-binding';
import { BUILTIN_VIEWS, builtinViewByID, DEFAULT_VIEW_ID } from '@/lib/inbox/builtin-views';
import { clientFilterPredicate } from '@/lib/inbox/custom-field-filter';
import { decodeFilters, encodeFilters, filtersEqual } from '@/lib/inbox/url-filters';
import { useViewCommands } from '@/lib/inbox/use-view-commands';
import { useInboxSelectionStore } from '@/lib/inbox-selection';
import { INBOX_ROW_HEIGHT, LOAD_MORE_THRESHOLD } from '@/lib/list-constants';
import { useSetupProgress } from '@/lib/setup-progress';
import { useZero } from '@/lib/zero';
import { CACHE_FOREVER } from '@/lib/zero-cache';
import { InboxListSkeleton } from './skeletons';

interface InboxListProps {
  selectedTicketID: string | null;
  currentUserID: string;
}

interface SavedInboxState {
  offset: number;
  pageLimit: number;
}

const SCROLL_KEY_PREFIX = 'opendesk.inbox.state.';

function scrollKeyFor(workspaceID: string | null, viewID: string) {
  return `${SCROLL_KEY_PREFIX}${workspaceID ?? 'no-workspace'}.${viewID}`;
}

function readSavedInboxState(workspaceID: string | null, viewID: string): SavedInboxState {
  const fallback: SavedInboxState = { offset: 0, pageLimit: INBOX_INITIAL_PAGE };
  if (typeof window === 'undefined') return fallback;
  const raw = window.sessionStorage.getItem(scrollKeyFor(workspaceID, viewID));
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<SavedInboxState>;
    const offset =
      Number.isFinite(parsed.offset) && (parsed.offset ?? 0) > 0 ? Number(parsed.offset) : 0;
    // Restore pageLimit *only* when we also have a scroll offset to restore.
    // Without this, switching back to an inbox view replays whatever
    // pageLimit the user had grown the window to — even though the
    // virtualizer is at row 0 and could happily start from
    // `INBOX_INITIAL_PAGE`. A 2000-row materialization on every cold load
    // is exactly what made the inbox feel like "all tickets at once".
    // The grow-on-scroll effect still bumps the limit back up the moment
    // the user scrolls past `LOAD_MORE_THRESHOLD`.
    const savedLimit =
      Number.isFinite(parsed.pageLimit) &&
      (parsed.pageLimit ?? 0) >= INBOX_INITIAL_PAGE &&
      (parsed.pageLimit ?? 0) <= MAX_INBOX_LIMIT
        ? Number(parsed.pageLimit)
        : INBOX_INITIAL_PAGE;
    const limit = offset > 0 ? savedLimit : INBOX_INITIAL_PAGE;
    return { offset, pageLimit: limit };
  } catch {
    return fallback;
  }
}

function writeSavedInboxState(workspaceID: string | null, viewID: string, state: SavedInboxState) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(scrollKeyFor(workspaceID, viewID), JSON.stringify(state));
}

type ViewWithMembers = View & {
  members: ReadonlyArray<ViewMember>;
};

export function InboxList({ selectedTicketID, currentUserID }: InboxListProps) {
  const navigate = useNavigate();
  const z = useZero();
  const ctx = useRouteContext({ from: '/app' }) as {
    session: { session: { activeOrganizationId: string | null } };
  };
  const workspaceID = ctx.session.session.activeOrganizationId ?? null;
  const setupProgress = useSetupProgress(workspaceID);

  // Active view from URL. Default to `builtin:all`. Self-heal happens inside
  // `<InboxViewStrip>` if the param points at a missing view.
  const search = useSearch({ from: '/app/inbox' }) as { view?: string; f?: string };
  const activeViewID = search.view ?? DEFAULT_VIEW_ID;

  // Resolve the active view's saved query/sort/group. Built-ins are
  // resolved from a static constant; custom views fall through to a Zero
  // subscription on `viewByID`.
  const builtin = useMemo(() => builtinViewByID(activeViewID), [activeViewID]);
  const [customView, customViewStatus] = useQuery(
    builtin
      ? queries.viewByID({ id: BUILTIN_VIEWS[0]!.id })
      : queries.viewByID({ id: activeViewID }),
    CACHE_FOREVER,
  ) as unknown as [ViewWithMembers | undefined, { type?: string } | undefined];

  // Self-heal a URL pointing at a custom view that doesn't exist (or that
  // the caller can't see — `viewByID` filters by scope + archived). The
  // previous code fell through to `{ filters: [] }` and rendered the
  // entire workspace's tickets, which is both wrong UX and a small
  // information leak (count of tickets visible).
  //
  // Wait for the Zero subscription to confirm "complete + null" before
  // navigating away — without this, the redirect fires during initial
  // hydration and steals the URL the user typed.
  const customViewMissing = !builtin && customViewStatus?.type === 'complete' && customView == null;
  useEffect(() => {
    if (!customViewMissing) return;
    navigate({
      to: '/app/inbox',
      search: { view: DEFAULT_VIEW_ID },
      replace: true,
    });
  }, [customViewMissing, navigate]);

  // Drift model: the URL `f` param holds the *full* effective filter set
  // when the user has touched anything. When `f` is absent, the saved
  // view's baseline is the effective set. This is deliberately *not* a
  // merge-by-field model — that one made the chip bar invisible to the
  // user and forced "edit a saved view" through "remove + create new".
  // Now: the chip bar always shows the view's filters, edits replace the
  // full list, and `Save changes` pushes them back to `view.update`.
  const hasDrift = search.f !== undefined;
  const urlFilters = useMemo<Filter[]>(() => decodeFilters(search.f), [search.f]);

  const baselineQuery: ViewQuery = useMemo(() => {
    if (builtin) return builtin.query;
    if (customView) return customView.query as unknown as ViewQuery;
    // Custom view hasn't materialized yet, or doesn't exist / isn't
    // visible to this caller. Fall back to a never-match filter (status
    // = unreachable sentinel) instead of "no filter, show everything"
    // — important for the brief window before the self-heal redirect
    // above fires, and for cases where Zero's subscription stays
    // hydrating longer than expected. The redirect handles the
    // permanent state; this guards the transient one.
    return {
      filters: [{ field: 'status', operator: 'eq', value: '__no_view__' }],
      matchAll: true,
    };
  }, [builtin, customView]);

  const effectiveFilters: Filter[] = useMemo(
    () => (hasDrift ? urlFilters : baselineQuery.filters),
    [hasDrift, urlFilters, baselineQuery.filters],
  );

  const resolvedQuery: ViewQuery = useMemo(
    () => ({ ...baselineQuery, filters: effectiveFilters }),
    [baselineQuery, effectiveFilters],
  );

  // Editing a chip writes the entire new chip-bar state into the URL. We
  // always encode (even an empty list) so "remove the last chip" stays
  // distinct from "no drift" — see `encodeFilters` for the rationale.
  const setEffectiveFilters = useCallback(
    (next: Filter[]) => {
      navigate({
        to: '/app/inbox',
        search: (prev) => ({
          ...prev,
          view: prev.view ?? activeViewID,
          f: encodeFilters(next),
        }),
        replace: true,
      });
    },
    [activeViewID, navigate],
  );

  // Reset clears the `f` param entirely so we fall back to the saved
  // baseline. Distinct from "set f to []" (which would mean "the user
  // explicitly wants no filters"); `Reset` says "discard my drift".
  const resetDrift = useCallback(() => {
    navigate({
      to: '/app/inbox',
      search: (prev) => ({ ...prev, view: prev.view ?? activeViewID, f: undefined }),
      replace: true,
    });
  }, [activeViewID, navigate]);

  // Save changes pushes the live URL state back to the view definition.
  // Built-ins reject this (they have no DB row); only owners can edit
  // custom views. Failures stay silent for v1 — drift remains in URL so
  // the user can retry.
  const driftedFromBaseline = hasDrift && !filtersEqual(effectiveFilters, baselineQuery.filters);
  const canSaveChanges =
    !builtin && customView != null && customView.ownerID === currentUserID && driftedFromBaseline;
  const saveChanges = useCallback(async () => {
    if (!canSaveChanges) return;
    try {
      await z.mutate(
        mutators.view.update({
          id: activeViewID,
          query: { ...baselineQuery, filters: effectiveFilters },
        }),
      );
      // Drop the `f` param — the URL state is now the saved baseline.
      resetDrift();
    } catch (err) {
      console.error('view.update failed', err);
    }
  }, [canSaveChanges, z, activeViewID, baselineQuery, effectiveFilters, resetDrift]);

  const resolvedSort: ViewSort = useMemo(() => {
    if (builtin) return builtin.sort;
    if (customView) return customView.sort as unknown as ViewSort;
    return { field: 'updatedAt', direction: 'desc' };
  }, [builtin, customView]);

  const resolvedGroupBy: string | null = useMemo(() => {
    if (builtin) return null;
    return (customView?.groupBy as string | null | undefined) ?? null;
  }, [builtin, customView]);

  // sessionStorage scroll state is keyed per-(workspace, view).
  const restored = useMemo(
    () => readSavedInboxState(workspaceID, activeViewID),
    [workspaceID, activeViewID],
  );
  const [pageLimit, setPageLimit] = useState(restored.pageLimit);
  // Reset scroll/limit when switching views.
  useEffect(() => {
    setPageLimit(restored.pageLimit);
  }, [restored.pageLimit]);

  const [tickets, status] = useQuery(
    queries.ticketsForView({
      viewID: activeViewID,
      // The query arg type is `{ filters: any[]; ... }` because `ViewQuery`
      // doesn't carry an index signature (see `queries.ts`). Cast through.
      viewQuery: resolvedQuery as unknown as {
        filters: unknown[];
        matchAll?: boolean;
        search?: string;
      },
      sort: resolvedSort,
      limit: pageLimit,
    }),
    CACHE_FOREVER,
  ) as unknown as [ReadonlyArray<InboxRowData>, { type?: string } | undefined];
  const ready = status?.type === 'complete';

  const [search_text, setSearchText] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Bulk selection (transient — see lib/inbox-selection.ts).
  const selectionIds = useInboxSelectionStore((s) => s.ids);
  const setSelectionWorkspace = useInboxSelectionStore((s) => s.setWorkspace);
  const setMany = useInboxSelectionStore((s) => s.setMany);
  const clearSelection = useInboxSelectionStore((s) => s.clear);
  const toggleOne = useInboxSelectionStore((s) => s.toggle);
  const setLastToggledIndex = useInboxSelectionStore((s) => s.setLastToggledIndex);
  const lastToggledIndex = useInboxSelectionStore((s) => s.lastToggledIndex);
  const selectionSet = useMemo(() => new Set(selectionIds), [selectionIds]);
  const hasSelection = selectionIds.length > 0;

  useEffect(() => {
    setSelectionWorkspace(workspaceID);
  }, [workspaceID, setSelectionWorkspace]);

  // Drop selection on view / search change so the bar's count stays honest.
  const lastFilterRef = useRef<string>(`${activeViewID}\u0000${search_text}`);
  useEffect(() => {
    const next = `${activeViewID}\u0000${search_text}`;
    if (lastFilterRef.current !== next) {
      lastFilterRef.current = next;
      clearSelection();
    }
  });

  // Client-side post-filter for any operator Zero can't fully express:
  // every custom-field comparison (jsonb shape varies by field type) plus
  // the negation-style tag operators (`empty`, `includesNone`, `nin`)
  // that would need `not(exists(...))` — unsupported on the client.
  const cfPredicate = useMemo(
    () => clientFilterPredicate(resolvedQuery.filters),
    [resolvedQuery.filters],
  );

  const filtered = useMemo(() => {
    const q = search_text.trim().toLowerCase();
    const textOnly = !q;
    return tickets.filter((t: InboxRowData) => {
      // `customFieldValues` only ships when a custom-field filter is active
      // (see `ticketsForView` in queries.ts). The cast is safe because
      // `customFieldPredicate` short-circuits to `() => true` whenever the
      // filter list contains no custom-field entries.
      if (!cfPredicate(t as unknown as Parameters<typeof cfPredicate>[0])) return false;
      if (textOnly) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.customer?.email?.toLowerCase().includes(q) ?? false) ||
        (t.customer?.name?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [tickets, search_text, cfPredicate]);

  const selectedIndex = useMemo(() => {
    if (!selectedTicketID) return -1;
    return filtered.findIndex((t) => t.id === selectedTicketID);
  }, [filtered, selectedTicketID]);

  const parentRef = useRef<HTMLDivElement | null>(null);
  useHoverTargetRoot(parentRef);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => INBOX_ROW_HEIGHT,
    overscan: 8,
    initialOffset: restored.offset,
  });

  const cursorTarget = useHoverTargetStore((state) => state.target);
  const cursorSource = useHoverTargetStore((state) => state.source);
  const cursorTicketID = cursorTarget?.kind === 'ticket' ? cursorTarget.id : null;
  const cursorIndex = useMemo(() => {
    if (cursorTicketID) {
      const idx = filtered.findIndex((t) => t.id === cursorTicketID);
      if (idx >= 0) return idx;
    }
    if (selectedIndex >= 0) return selectedIndex;
    return filtered.length > 0 ? 0 : -1;
  }, [cursorTicketID, filtered, selectedIndex]);

  // Reset cursor when the list changes shape.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeViewID/search_text are the trigger; we never read them
  useEffect(() => {
    useHoverTargetStore.getState().clear();
  }, [activeViewID, search_text]);

  const moveCursor = useCallback(
    (delta: 1 | -1) => {
      if (filtered.length === 0) return;
      const start = cursorIndex < 0 ? 0 : cursorIndex;
      const next = Math.max(0, Math.min(filtered.length - 1, start + delta));
      const ticket = filtered[next];
      if (!ticket) return;
      useHoverTargetStore.getState().setKeyboardTarget({
        kind: 'ticket',
        id: ticket.id,
        label: ticket.shortID > 0 ? `#${ticket.shortID}` : ticket.title,
      });
      virtualizer.scrollToIndex(next, { align: 'auto' });
    },
    [cursorIndex, filtered, virtualizer],
  );

  const pageLimitRef = useRef(pageLimit);
  pageLimitRef.current = pageLimit;
  const captureScroll = useCallback(() => {
    const node = parentRef.current;
    if (!node) return;
    writeSavedInboxState(workspaceID, activeViewID, {
      offset: node.scrollTop,
      pageLimit: pageLimitRef.current,
    });
  }, [workspaceID, activeViewID]);

  useEffect(() => captureScroll, [captureScroll]);

  // Pre-encoded `?view=…&f=…` suffix appended to ticket-detail hrefs so the
  // saved view + chip filters survive a ticket round-trip. `BackToInbox`
  // preserves the same params on the way back.
  const inboxSearchQS = useMemo(() => {
    const params = new URLSearchParams();
    if (search.view) params.set('view', search.view);
    if (search.f) params.set('f', search.f);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [search.view, search.f]);

  const goToIndex = useCallback(
    (idx: number) => {
      const t = filtered[idx];
      if (!t) return;
      captureScroll();
      navigate({
        to: '/app/inbox/t/$ticketId',
        params: { ticketId: t.id },
        search: (prev) => prev,
      });
    },
    [filtered, navigate, captureScroll],
  );
  useKeyBinding(['j', 'ArrowDown'], () => moveCursor(1), {
    scopes: ['inbox'],
    label: 'Move cursor down',
    group: 'Navigation',
  });
  useKeyBinding(['k', 'ArrowUp'], () => moveCursor(-1), {
    scopes: ['inbox'],
    label: 'Move cursor up',
    group: 'Navigation',
  });
  useKeyBinding(
    'Enter',
    () => {
      if (cursorIndex < 0) return;
      goToIndex(cursorIndex);
    },
    { scopes: ['inbox'], label: 'Open ticket at cursor', group: 'Navigation' },
  );
  useKeyBinding(
    'e',
    () => {
      const t = filtered[cursorIndex];
      if (t) z.mutate(mutators.ticket.close({ id: t.id }));
    },
    { scopes: ['inbox'], label: 'Close ticket', group: 'Ticket', commandId: 'ticket.close' },
  );

  const toggleSelection = useCallback(
    (id: string, opts: { shiftRange?: boolean }) => {
      const idx = filtered.findIndex((t) => t.id === id);
      if (idx < 0) return;
      if (opts.shiftRange && lastToggledIndex !== null) {
        const start = Math.min(lastToggledIndex, idx);
        const end = Math.max(lastToggledIndex, idx);
        const rangeIDs = filtered.slice(start, end + 1).map((t) => t.id);
        const next = Array.from(new Set([...selectionIds, ...rangeIDs]));
        setMany(next);
      } else {
        toggleOne(id);
      }
      setLastToggledIndex(idx);
    },
    [filtered, lastToggledIndex, selectionIds, setMany, toggleOne, setLastToggledIndex],
  );

  useKeyBinding(
    'x',
    () => {
      const t = filtered[cursorIndex];
      if (!t) return;
      toggleSelection(t.id, { shiftRange: false });
    },
    { scopes: ['inbox'], label: 'Select ticket at cursor', group: 'Ticket' },
  );

  const extendSelection = useCallback(
    (delta: 1 | -1) => {
      if (filtered.length === 0 || cursorIndex < 0) return;
      const nextIndex = Math.max(0, Math.min(filtered.length - 1, cursorIndex + delta));
      const current = filtered[cursorIndex];
      const next = filtered[nextIndex];
      if (!next) return;
      if (lastToggledIndex === null && current) {
        setMany(Array.from(new Set([...selectionIds, current.id])));
        setLastToggledIndex(cursorIndex);
      }
      toggleSelection(next.id, { shiftRange: true });
      useHoverTargetStore.getState().setKeyboardTarget({
        kind: 'ticket',
        id: next.id,
        label: next.shortID > 0 ? `#${next.shortID}` : next.title,
      });
      virtualizer.scrollToIndex(nextIndex, { align: 'auto' });
    },
    [
      cursorIndex,
      filtered,
      lastToggledIndex,
      selectionIds,
      setLastToggledIndex,
      setMany,
      toggleSelection,
      virtualizer,
    ],
  );

  useKeyBinding('Shift+j', () => extendSelection(1), {
    scopes: ['inbox'],
    label: 'Extend selection down',
    group: 'Ticket',
  });
  useKeyBinding('Shift+k', () => extendSelection(-1), {
    scopes: ['inbox'],
    label: 'Extend selection up',
    group: 'Ticket',
  });

  useKeyBinding(
    '/',
    () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
    { scopes: ['inbox'], label: 'Focus inbox search', group: 'Navigation' },
  );

  useKeyBinding(
    'Escape',
    (event) => {
      if (selectionIds.length === 0) return;
      event.stopPropagation();
      clearSelection();
    },
    { scopes: ['inbox'], preventDefault: false, enabled: hasSelection },
  );

  useKeyBinding(
    '$mod+a',
    (event) => {
      event.preventDefault();
      setMany(filtered.map((t) => t.id));
      setLastToggledIndex(filtered.length > 0 ? 0 : null);
    },
    {
      scopes: ['inbox'],
      preventDefault: false,
      label: 'Select all visible tickets',
      group: 'Ticket',
    },
  );

  // Save-view modal triggered by `+` button or `Alt+V`. `editTarget` switches
  // the modal into edit mode; null means "create a new view".
  const [saveOpen, setSaveOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{
    id: string;
    label: string;
    scope: 'workspace' | 'personal';
  } | null>(null);
  const openCreateView = useCallback(() => {
    setEditTarget(null);
    setSaveOpen(true);
  }, []);
  const openEditView = useCallback(
    (target: { id: string; label: string; scope: 'workspace' | 'personal' }) => {
      setEditTarget(target);
      setSaveOpen(true);
    },
    [],
  );
  useKeyBinding('Alt+v', openCreateView, {
    scopes: ['inbox'],
    label: 'Save view…',
    group: 'View',
    commandId: 'view.save_current',
  });

  // Dynamic per-view Cmd+K commands. Returns the visible view list ordered
  // for the strip; we reuse the array for `[`/`]` next/prev nav.
  const navigableViews = useViewCommands();
  const cycleView = useCallback(
    (delta: 1 | -1) => {
      if (navigableViews.length === 0) return;
      const idx = navigableViews.findIndex((v) => v.id === activeViewID);
      const start = idx < 0 ? 0 : idx;
      const next = (start + delta + navigableViews.length) % navigableViews.length;
      const nextID = navigableViews[next]?.id;
      if (!nextID) return;
      navigate({ to: '/app/inbox', search: { view: nextID } });
    },
    [activeViewID, navigableViews, navigate],
  );
  useKeyBinding(']', () => cycleView(1), {
    scopes: ['inbox'],
    label: 'Next view',
    group: 'View',
    commandId: 'view.next',
  });
  useKeyBinding('[', () => cycleView(-1), {
    scopes: ['inbox'],
    label: 'Previous view',
    group: 'View',
    commandId: 'view.prev',
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtualIndex = virtualItems[virtualItems.length - 1]?.index ?? 0;
  useEffect(() => {
    if (!ready) return;
    if (tickets.length < pageLimit) return;
    if (pageLimit >= MAX_INBOX_LIMIT) return;
    if (filtered.length - lastVirtualIndex <= LOAD_MORE_THRESHOLD) {
      setPageLimit((p) => Math.min(MAX_INBOX_LIMIT, p + INBOX_PAGE_GROWTH));
    }
  }, [ready, tickets.length, pageLimit, filtered.length, lastVirtualIndex]);

  async function onCreateSampleTicket() {
    const samples = [
      {
        title: 'Where is my refund?',
        priority: 'high' as const,
        customerEmail: 'amelia@northwind.com',
        customerName: 'Amelia Hart',
      },
      {
        title: 'Cannot connect Slack integration',
        priority: 'normal' as const,
        customerEmail: 'priya@acme.io',
        customerName: 'Priya Shah',
      },
      {
        title: 'Feature request: keyboard shortcut for snooze',
        priority: 'low' as const,
        customerEmail: 'leo@cobalt.dev',
        customerName: 'Leo Park',
      },
    ];
    for (const s of samples) {
      await z.mutate(
        mutators.ticket.create({
          id: crypto.randomUUID(),
          ...s,
        }),
      );
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-surface">
      <div className="flex shrink-0 flex-col gap-2 border-b border-line-quiet px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={search_text}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search title or customer…"
              className="h-9 pl-8 text-sm"
            />
          </div>
        </div>
        <InboxViewStrip
          activeViewID={activeViewID}
          onCreateView={openCreateView}
          onEditView={openEditView}
          workspaceID={workspaceID}
          currentUserID={currentUserID}
        />
        <InboxFilterBar
          filters={effectiveFilters}
          onFiltersChange={setEffectiveFilters}
          currentUserID={currentUserID}
        />
        {driftedFromBaseline ? (
          <DriftBanner
            isBuiltin={Boolean(builtin)}
            canSaveChanges={canSaveChanges}
            onSaveChanges={saveChanges}
            onSaveAsNew={openCreateView}
            onReset={resetDrift}
          />
        ) : null}
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div
          ref={parentRef}
          data-input-mode={cursorSource ?? 'hover'}
          data-active-view={activeViewID}
          className="h-full overflow-y-auto [&[data-input-mode=keyboard]_[data-ticket-id]:hover]:!bg-transparent"
          onClickCapture={captureScroll}
        >
          {/*
           * Render order matters here:
           *   1. tickets present → render the list (covers both "live data"
           *      and "IDB cache from a previous mount", so reload never
           *      flashes a loading state).
           *   2. server confirmed empty + no search → empty state.
           *   3. server hasn't responded yet → skeleton.
           */}
          {filtered.length === 0 && !ready ? (
            <InboxListSkeleton />
          ) : filtered.length === 0 ? (
            <EmptyInbox
              showSampleCreate={
                tickets.length === 0 && activeViewID === DEFAULT_VIEW_ID && search_text === ''
              }
              onCreate={onCreateSampleTicket}
              setup={setupProgress}
            />
          ) : (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((vi) => {
                const t = filtered[vi.index];
                if (!t) return null;
                const isSelected = t.id === selectedTicketID;
                const multiSelected = selectionSet.has(t.id);
                const isCursor = cursorSource === 'keyboard' && vi.index === cursorIndex;
                return (
                  <div
                    key={t.id}
                    data-testid="inbox-row"
                    data-selected={isSelected ? 'true' : 'false'}
                    data-multi-selected={multiSelected ? 'true' : 'false'}
                    data-cursor={isCursor ? 'true' : 'false'}
                    ref={virtualizer.measureElement}
                    data-index={vi.index}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      transform: `translateY(${vi.start}px)`,
                    }}
                  >
                    <InboxRow
                      ticket={t}
                      isSelected={isSelected}
                      multiSelected={multiSelected}
                      showCheckbox={hasSelection}
                      isCursor={isCursor}
                      inboxSearchQS={inboxSearchQS}
                      onToggleSelect={toggleSelection}
                      onNavigate={clearSelection}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <BulkActionBar currentUserID={currentUserID} />
      </div>

      <SaveViewModal
        open={saveOpen}
        onOpenChange={(open) => {
          setSaveOpen(open);
          if (!open) setEditTarget(null);
        }}
        baseQuery={resolvedQuery}
        baseSort={resolvedSort}
        baseGroupBy={resolvedGroupBy}
        driftFilters={effectiveFilters}
        activeViewLabel={builtin?.label ?? customView?.label ?? 'view'}
        editing={editTarget}
      />
    </div>
  );
}

function EmptyInbox({
  showSampleCreate,
  onCreate,
  setup,
}: {
  showSampleCreate: boolean;
  onCreate: () => void;
  setup: ReturnType<typeof useSetupProgress>;
}) {
  const isDev = import.meta.env.DEV;
  const promoteSetup = setup.ready && !setup.isComplete && !setup.dismissed;
  const nextItem = setup.items.find((item) => !item.completed);

  if (promoteSetup) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-12 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand-soft-foreground ring-1 ring-brand-border">
          <ListChecks className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Set up your inbox</p>
          <p className="text-xs text-muted-foreground">
            {setup.completedCount} of {setup.total} complete
            {nextItem ? ` · Next: ${NEXT_LABEL[nextItem.id]}` : ''}
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/app/settings/setup">
            Continue setup <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
        {isDev && showSampleCreate ? (
          <button
            type="button"
            onClick={onCreate}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Dev: create sample tickets
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand-soft-foreground">
        <Inbox className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Nothing in this view</p>
        <p className="text-xs text-muted-foreground">
          Replies and matching tickets will appear here.
        </p>
      </div>
      {isDev && showSampleCreate ? (
        <button
          type="button"
          onClick={onCreate}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Dev: create sample tickets
        </button>
      ) : null}
    </div>
  );
}

const NEXT_LABEL: Record<ReturnType<typeof useSetupProgress>['items'][number]['id'], string> = {
  workspace: 'create your workspace',
  domain: 'add a sending domain',
  dnsVerified: 'verify DNS',
  address: 'create a support address',
  routing: 'configure routing',
  firstMessage: 'receive your first message',
  invite: 'invite a teammate',
};

function DriftBanner({
  isBuiltin,
  canSaveChanges,
  onSaveChanges,
  onSaveAsNew,
  onReset,
}: {
  isBuiltin: boolean;
  canSaveChanges: boolean;
  onSaveChanges: () => void;
  onSaveAsNew: () => void;
  onReset: () => void;
}) {
  return (
    <div
      data-testid="drift-banner"
      className="flex items-center justify-between rounded-md border border-border bg-bg-elevated px-2.5 py-1 text-xs"
    >
      <span className="text-fg-tertiary">
        {isBuiltin
          ? 'Filters changed. Built-ins can’t be edited; save as a new view to keep them.'
          : canSaveChanges
            ? 'Filters differ from the saved view.'
            : 'Filters differ from the saved view. Only the owner can save changes.'}
      </span>
      <div className="flex items-center gap-1">
        {canSaveChanges ? (
          <button
            type="button"
            data-testid="drift-save-changes"
            onClick={onSaveChanges}
            className="rounded-md bg-brand px-2 py-1 font-medium text-brand-foreground hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Save changes
          </button>
        ) : null}
        <button
          type="button"
          data-testid="drift-save-as-new"
          onClick={onSaveAsNew}
          className="rounded-md px-2 py-1 font-medium text-fg-primary hover:bg-bg-elevated-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Save as new view
        </button>
        <button
          type="button"
          data-testid="drift-reset"
          onClick={onReset}
          className="rounded-md px-2 py-1 text-fg-tertiary hover:bg-bg-elevated-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
