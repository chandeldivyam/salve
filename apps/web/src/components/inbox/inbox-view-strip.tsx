// Phase 40 — inbox view-strip (replaces the hardcoded 4-button strip).
//
// Renders built-in views (constant) followed by the agent's visible custom
// views, sorted by per-agent `position` from `view_member` (custom) and
// `builtin_view_member` (built-ins). Clicking a pill writes
// `?view=<id>` on the inbox URL. Built-ins are not draggable in v1; full
// drag-reorder lands in a follow-up.
//
// Each pill has a context menu (right-click + hover-revealed kebab) for
// Edit / Duplicate / Hide for me / Archive / Copy URL — the actions
// available depend on whether the pill is a built-in, a personal view, or
// a workspace view (and whether the caller owns it).

import { mutators } from '@opendesk/mutators';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@opendesk/ui';
import { type BuiltinViewMember, queries, type View, type ViewMember } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { useNavigate, useRouter } from '@tanstack/react-router';
import {
  Archive,
  Copy,
  EyeOff,
  Filter as FilterIcon,
  MoreHorizontal,
  Pencil,
  Plus,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { navigateWorkbenchHref } from '@/components/workbench/navigation';
import {
  BUILTIN_PREFIX,
  BUILTIN_VIEWS,
  type BuiltinKey,
  builtinViewByID,
  isBuiltinViewID,
} from '@/lib/inbox/builtin-views';
import { useWorkbenchStore } from '@/lib/workbench';
import { useZero } from '@/lib/zero';
import { CACHE_FOREVER } from '@/lib/zero-cache';

type ViewWithMembers = View & {
  members: ReadonlyArray<ViewMember>;
};

export interface ViewEditTarget {
  id: string;
  label: string;
  scope: 'workspace' | 'personal';
}

interface InboxViewStripProps {
  activeViewID: string;
  onCreateView: () => void;
  onEditView: (target: ViewEditTarget) => void;
  workspaceID: string | null;
  currentUserID: string;
}

interface PillView {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isBuiltin: boolean;
  position: number;
  // Custom-view-only metadata used by the context menu.
  scope: 'workspace' | 'personal' | null;
  ownerID: string | null;
}

export function InboxViewStrip({
  activeViewID,
  onCreateView,
  onEditView,
  workspaceID,
  currentUserID,
}: InboxViewStripProps) {
  const navigate = useNavigate();
  const router = useRouter();
  const forkTab = useWorkbenchStore((s) => s.forkTab);

  const [customViews] = useQuery(queries.views(), CACHE_FOREVER) as unknown as [
    ReadonlyArray<ViewWithMembers>,
    unknown,
  ];
  const [builtinMembers] = useQuery(queries.builtinViewMembers(), CACHE_FOREVER) as unknown as [
    ReadonlyArray<BuiltinViewMember>,
    unknown,
  ];

  const pills = useMemo<ReadonlyArray<PillView>>(() => {
    // Built-ins. Per-agent position from `builtin_view_member` overrides the
    // static order; agents who never reordered see the static order.
    const builtinMemberByKey = new Map((builtinMembers ?? []).map((m) => [m.builtinKey, m]));
    const builtinPills: PillView[] = BUILTIN_VIEWS.filter((v) => {
      const m = builtinMemberByKey.get(v.builtinKey);
      return !m || m.hiddenAt == null;
    }).map((v, i) => {
      const m = builtinMemberByKey.get(v.builtinKey);
      return {
        id: v.id,
        label: v.label,
        icon: v.icon,
        isBuiltin: true,
        position: m?.position ?? i,
        scope: null,
        ownerID: null,
      };
    });

    const customPills: PillView[] = (customViews ?? [])
      .filter((v) => {
        const m = v.members?.[0];
        return !m || m.hiddenAt == null;
      })
      .map((v) => {
        const m = v.members?.[0];
        return {
          id: v.id,
          label: v.label,
          icon: FilterIcon,
          isBuiltin: false,
          position: m?.position ?? Number.MAX_SAFE_INTEGER,
          scope: (v.scope ?? 'workspace') as 'workspace' | 'personal',
          ownerID: v.ownerID ?? null,
        };
      });

    builtinPills.sort((a, b) => a.position - b.position);
    customPills.sort((a, b) => a.position - b.position);
    return [...builtinPills, ...customPills];
  }, [builtinMembers, customViews]);

  const onPillClick = useCallback(
    (id: string, opts: { fork: boolean }) => {
      const href = `/app/inbox?view=${encodeURIComponent(id)}`;
      if (opts.fork) {
        // Cmd/Ctrl+click → open this view in a new workbench tab. The
        // forked tab has a unique tabKey so it survives subsequent
        // view switches inside it (see syncLocation in workbench/store).
        const tab = forkTab(workspaceID, href, 'tab');
        // Drive the router so the URL + content reflect the new view.
        navigateWorkbenchHref(router, tab.href);
        return;
      }
      navigate({ to: '/app/inbox', search: { view: id } });
    },
    [forkTab, navigate, router, workspaceID],
  );

  // Self-heal default: only redirect when the URL points at a *genuinely
  // invalid* view id. We deliberately do NOT redirect just because
  // `activeViewID` is missing from `pills` — Zero's optimistic update for
  // a freshly-created custom view surfaces after `navigate({view: newID})`
  // fires, and a "not yet in pills" check would race-cancel the
  // post-save navigation. For custom views, the inbox-list's
  // `viewByID` subscription is the source of truth: if it returns null
  // after hydration the inbox renders an empty state.
  useEffect(() => {
    if (isBuiltinViewID(activeViewID) && !builtinViewByID(activeViewID)) {
      navigate({
        to: '/app/inbox',
        search: { view: BUILTIN_VIEWS[0]!.id },
        replace: true,
      });
    }
  }, [activeViewID, navigate]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pills.map((p) => (
        <ViewPill
          key={p.id}
          pill={p}
          isActive={p.id === activeViewID}
          currentUserID={currentUserID}
          onClick={onPillClick}
          onEdit={onEditView}
        />
      ))}
      <button
        type="button"
        data-testid="view-pill-create"
        onClick={onCreateView}
        aria-label="Save current filters as new view"
        title="Save current filters as new view"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:bg-bg-elevated hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ViewPill({
  pill,
  isActive,
  currentUserID,
  onClick,
  onEdit,
}: {
  pill: PillView;
  isActive: boolean;
  currentUserID: string;
  onClick: (id: string, opts: { fork: boolean }) => void;
  onEdit: (target: ViewEditTarget) => void;
}) {
  const z = useZero();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const Icon = pill.icon;

  // Action availability matrix (Phase 40 §11.6):
  //   built-in  →  Duplicate (→ personal copy with same filters) / Copy URL
  //                / Hide for me (per-agent pill suppression)
  //   personal  →  Edit / Duplicate / Copy URL / Archive (owner only)
  //   workspace →  Edit / Duplicate / Copy URL / Archive (owner)
  //                Duplicate / Copy URL / Hide for me   (non-owner)
  const isBuiltin = pill.isBuiltin;
  const isOwner = pill.ownerID === currentUserID;
  const canEdit = !isBuiltin && isOwner;
  const canArchive = !isBuiltin && isOwner;
  const canHideForMe = !isBuiltin && pill.scope === 'workspace' && !isOwner;
  const canHideBuiltin = isBuiltin;

  async function onCopyURL() {
    const url = `${window.location.origin}/app/inbox?view=${encodeURIComponent(pill.id)}`;
    try {
      await navigator.clipboard?.writeText(url);
    } catch {
      // Some browsers deny clipboard without a user gesture chain — silently
      // ignore; the menu close + URL-bar selection is still useful.
    }
  }

  // Built-ins live as static client-side constants and have no `view` row
  // to duplicate from. We synthesize one by writing a fresh personal-scope
  // view with the built-in's saved query/sort. Custom views go through the
  // server-side `view.duplicate` mutator (which copies query/sort/groupBy
  // and forks scope to personal).
  async function onDuplicate() {
    const newID = crypto.randomUUID();
    if (isBuiltin) {
      const builtin = BUILTIN_VIEWS.find((v) => v.id === pill.id);
      if (!builtin) return;
      await z.mutate(
        mutators.view.create({
          id: newID,
          scope: 'personal',
          label: `${builtin.label} (copy)`,
          query: builtin.query,
          sort: builtin.sort,
        }),
      );
      return;
    }
    await z.mutate(mutators.view.duplicate({ id: pill.id, newID }));
  }

  async function onHide() {
    await z.mutate(mutators.view.hide({ id: pill.id }));
  }

  async function onArchive() {
    if (isBuiltin) return;
    setArchiving(true);
    try {
      await z.mutate(mutators.view.archive({ id: pill.id }));
      setConfirmingArchive(false);
    } finally {
      setArchiving(false);
    }
  }

  function onEditSelected() {
    if (isBuiltin || !pill.scope) return;
    // Switch to the view first so the modal shows that view's filters as
    // the live state — saving Edit means "lock in what's on screen".
    onClick(pill.id, { fork: false });
    onEdit({ id: pill.id, label: pill.label, scope: pill.scope });
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <span
        className={cn(
          'group inline-flex h-7 items-center overflow-hidden rounded-md text-xs transition-colors',
          isActive
            ? 'bg-bg-elevated font-medium text-fg-primary'
            : 'text-fg-tertiary hover:bg-bg-elevated hover:text-fg-primary',
        )}
      >
        <button
          type="button"
          data-testid={`view-pill-${pill.id}`}
          data-active={isActive ? 'true' : 'false'}
          data-builtin={isBuiltin ? 'true' : 'false'}
          onClick={(event) => {
            const fork = event.metaKey || event.ctrlKey;
            onClick(pill.id, { fork });
          }}
          onAuxClick={(event) => {
            // Middle-click also opens in a new tab — matches browser convention.
            if (event.button === 1) {
              event.preventDefault();
              onClick(pill.id, { fork: true });
            }
          }}
          // Right-click anywhere on the pill label opens the same menu the
          // hover-revealed kebab does. The kebab is a Radix Trigger (it
          // controls open via Radix); this handler controls open via the
          // shared `menuOpen` state, so the two affordances stay in sync.
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuOpen(true);
          }}
          title={`${pill.label}${'\u2003'}(${'\u2318'}+click for new tab)`}
          className="inline-flex h-7 items-center gap-1.5 px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon className="h-3.5 w-3.5" />
          <span>{pill.label}</span>
        </button>
        {/* Hover-revealed kebab. Right-click also opens the same menu via
            the wrapper's `onContextMenu`; the kebab gives a discoverable
            mouse affordance. Built-ins still get a menu (Copy URL + Hide
            for me) so the right-click contract is consistent. */}
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid={`view-pill-${pill.id}-menu`}
            aria-label={`${pill.label} options`}
            onClick={(event) => event.stopPropagation()}
            className={cn(
              'mr-0.5 grid h-5 w-5 shrink-0 place-items-center rounded text-fg-tertiary transition-opacity',
              'hover:bg-bg-elevated-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              menuOpen || isActive
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100',
            )}
          >
            <MoreHorizontal className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
      </span>
      <DropdownMenuContent align="start" className="w-48">
        {canEdit ? (
          <DropdownMenuItem onSelect={onEditSelected} data-testid={`view-pill-${pill.id}-edit`}>
            <Pencil className="h-3.5 w-3.5" />
            Edit view
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={onDuplicate} data-testid={`view-pill-${pill.id}-duplicate`}>
          <Copy className="h-3.5 w-3.5" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCopyURL} data-testid={`view-pill-${pill.id}-copy-url`}>
          <Copy className="h-3.5 w-3.5" />
          Copy view URL
        </DropdownMenuItem>
        {canHideForMe || canHideBuiltin ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onHide} data-testid={`view-pill-${pill.id}-hide`}>
              <EyeOff className="h-3.5 w-3.5" />
              Hide for me
            </DropdownMenuItem>
          </>
        ) : null}
        {canArchive ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              // Use a confirmation dialog instead of running archive
              // immediately — this is destructive (the view drops out of
              // every agent's strip) and cannot be undone from the strip
              // alone. `e.preventDefault()` keeps the menu from auto-
              // closing on select so we can hand off cleanly to the
              // dialog without a flicker.
              onSelect={(e) => {
                e.preventDefault();
                setMenuOpen(false);
                setConfirmingArchive(true);
              }}
              data-testid={`view-pill-${pill.id}-archive`}
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <Archive className="h-3.5 w-3.5" />
              Archive view…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
      <Dialog open={confirmingArchive} onOpenChange={setConfirmingArchive}>
        <DialogContent className="!w-[420px] !max-w-[calc(100vw-2rem)] gap-0 p-0">
          <DialogHeader className="px-5 pt-5 pb-3">
            <DialogTitle className="text-[15px]">Archive view?</DialogTitle>
            <DialogDescription className="text-xs">
              "{pill.label}" will be hidden from everyone in the workspace. You can restore it later
              from archived views.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="!flex-row !justify-end mt-1 gap-2 border-t border-border pt-3 px-5 pb-5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingArchive(false)}
              disabled={archiving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onArchive}
              disabled={archiving}
              data-testid={`view-pill-${pill.id}-archive-confirm`}
            >
              {archiving ? 'Archiving…' : 'Archive view'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DropdownMenu>
  );
}

export type { BuiltinKey };
// Re-export so callers don't need to import from two places.
export { BUILTIN_PREFIX, BUILTIN_VIEWS };
