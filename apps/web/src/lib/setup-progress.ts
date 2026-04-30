// Setup checklist state — computed from live Zero queries with a per-workspace
// dismiss flag persisted in localStorage. Mirrors the `useSyncExternalStore`
// pattern in `theme.ts` so the dismiss flag stays in sync across the header
// pill, the sidebar, and the inbox empty state without prop drilling.

import { queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { useSyncExternalStore } from 'react';

const STORAGE_PREFIX = 'salve.setup.dismissed.';

const listeners = new Set<() => void>();
let dismissedSnapshot: Record<string, boolean> = {};

function emit() {
  for (const listener of listeners) listener();
}

function storageKey(workspaceID: string): string {
  return `${STORAGE_PREFIX}${workspaceID}`;
}

function readDismissed(workspaceID: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(storageKey(workspaceID)) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(workspaceID: string, dismissed: boolean) {
  if (typeof window === 'undefined') return;
  try {
    if (dismissed) window.localStorage.setItem(storageKey(workspaceID), '1');
    else window.localStorage.removeItem(storageKey(workspaceID));
  } catch {
    // Safari private mode etc.
  }
}

function refreshDismissedFor(workspaceID: string) {
  const next = readDismissed(workspaceID);
  if (dismissedSnapshot[workspaceID] === next) return dismissedSnapshot;
  dismissedSnapshot = { ...dismissedSnapshot, [workspaceID]: next };
  return dismissedSnapshot;
}

export function setSetupDismissed(workspaceID: string | null, dismissed: boolean) {
  if (!workspaceID) return;
  writeDismissed(workspaceID, dismissed);
  refreshDismissedFor(workspaceID);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useDismissed(workspaceID: string | null): boolean {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (workspaceID ? refreshDismissedFor(workspaceID) : dismissedSnapshot),
    () => dismissedSnapshot,
  );
  if (!workspaceID) return false;
  return snapshot[workspaceID] === true;
}

export interface SetupItemSnapshot {
  id: 'workspace' | 'domain' | 'dnsVerified' | 'address' | 'routing' | 'firstMessage' | 'invite';
  completed: boolean;
}

export interface SetupProgressSnapshot {
  ready: boolean;
  workspaceID: string | null;
  items: SetupItemSnapshot[];
  completedCount: number;
  total: number;
  isComplete: boolean;
  dismissed: boolean;
  /** Setup is meaningful and not yet finished/dismissed — drives the header pill. */
  shouldPromote: boolean;
}

/**
 * Computes the live setup checklist state for the active workspace. Must be
 * called inside a `<ZeroProvider>` (so above /app's auth gate).
 */
export function useSetupProgress(workspaceID: string | null): SetupProgressSnapshot {
  const dismissed = useDismissed(workspaceID);

  const [domainRows, domainStatus] = useQuery(queries.sendingDomains());
  const [addressRows, addressStatus] = useQuery(queries.receivableEmailAddresses());
  const [sendableRows, sendableStatus] = useQuery(queries.sendableEmailAddresses());
  const [routingRuleRows, routingStatus] = useQuery(queries.inboundRoutingRules());
  const [memberRows, memberStatus] = useQuery(queries.workspaceMembers());

  const ready =
    domainStatus?.type !== 'unknown' &&
    addressStatus?.type !== 'unknown' &&
    sendableStatus?.type !== 'unknown' &&
    routingStatus?.type !== 'unknown' &&
    memberStatus?.type !== 'unknown';

  // Address completeness covers send-or-receive — both flows configure an
  // address for the workspace, so either presence completes the step.
  const hasAddress = addressRows.length > 0 || sendableRows.length > 0;
  const hasVerifiedDomain = domainRows.some((d) => d.dnsStatus === 'verified');
  const hasRoutingRule = routingRuleRows.some((r) => r.enabled !== false);
  const hasTeammate = memberRows.length > 1;

  const items: SetupItemSnapshot[] = [
    { id: 'workspace', completed: Boolean(workspaceID) },
    { id: 'domain', completed: domainRows.length > 0 },
    { id: 'dnsVerified', completed: hasVerifiedDomain },
    { id: 'address', completed: hasAddress },
    { id: 'routing', completed: hasRoutingRule },
    // No inbound table query yet — Phase 4 will add a receivedAny signal.
    { id: 'firstMessage', completed: false },
    { id: 'invite', completed: hasTeammate },
  ];

  const completedCount = items.filter((item) => item.completed).length;
  const total = items.length;
  const isComplete = completedCount === total;
  const shouldPromote = Boolean(workspaceID) && !dismissed && !isComplete;

  return {
    ready,
    workspaceID,
    items,
    completedCount,
    total,
    isComplete,
    dismissed,
    shouldPromote,
  };
}
