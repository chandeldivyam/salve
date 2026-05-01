import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@opendesk/ui';
import { useRouter } from '@tanstack/react-router';
import { Copy, ExternalLink, MoreHorizontal, Pin, PinOff, Plus, RotateCcw, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { isMod, useShortcut } from '@/lib/shortcuts';
import {
  selectActiveWorkspaceTab,
  useWorkbenchStore,
  type WorkbenchTab,
  workbenchIconMap,
  workspaceKey,
} from '@/lib/workbench';
import { navigateWorkbenchHref } from './navigation';

interface WorkbenchTabStripProps {
  workspaceID: string | null;
}

const EMPTY_TABS: WorkbenchTab[] = [];

export function WorkbenchTabStrip({ workspaceID }: WorkbenchTabStripProps) {
  const router = useRouter();
  const key = workspaceKey(workspaceID);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [frozenWidths, setFrozenWidths] = useState<Record<string, number> | null>(null);
  const tabs = useWorkbenchStore((state) => state.tabsByWorkspace[key] ?? EMPTY_TABS);
  const activeTabID = useWorkbenchStore((state) => state.activeTabIdByWorkspace[key]);
  const setCommandOpen = useWorkbenchStore((state) => state.setCommandOpen);
  const reorderTabs = useWorkbenchStore((state) => state.reorderTabs);
  const activateTab = useWorkbenchStore((state) => state.activateTab);
  const closeTab = useWorkbenchStore((state) => state.closeTab);
  const reopenLastClosed = useWorkbenchStore((state) => state.reopenLastClosed);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useShortcut(
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    (event) => {
      if (!isMod(event)) return;
      event.preventDefault();
      const tab = tabs[Number(event.key) - 1];
      if (!tab) return;
      activateTab(key, tab.id);
      navigateWorkbenchHref(router, tab.href);
    },
    { allowInInputs: true, preventDefault: false },
  );

  useShortcut(
    ['W', 'w'],
    (event) => {
      if (!isMod(event) || !event.shiftKey || !activeTabID) return;
      event.preventDefault();
      closeTab(key, activeTabID);
      const next = selectActiveWorkspaceTab(key);
      if (next) navigateWorkbenchHref(router, next.href);
    },
    { allowInInputs: true, preventDefault: false },
  );

  useShortcut(
    ['T', 't'],
    (event) => {
      if (!isMod(event) || !event.shiftKey) return;
      event.preventDefault();
      const reopened = reopenLastClosed(key);
      if (reopened) navigateWorkbenchHref(router, reopened.href);
    },
    { allowInInputs: true, preventDefault: false },
  );

  function onDragEnd(event: DragEndEvent) {
    const activeID = String(event.active.id);
    const overID = event.over ? String(event.over.id) : null;
    if (!overID || activeID === overID) return;
    reorderTabs(key, activeID, overID);
  }

  function freezeTabWidths() {
    const widths: Record<string, number> = {};
    rowRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]').forEach((node) => {
      widths[node.dataset.tabId ?? ''] = node.getBoundingClientRect().width;
    });
    setFrozenWidths(widths);
  }

  return (
    <div className="relative flex h-10 min-w-0 items-center border-b border-border bg-surface">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={tabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
          <div
            ref={rowRef}
            role="tablist"
            aria-label="Open tabs"
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1"
            onMouseLeave={() => setFrozenWidths(null)}
          >
            {tabs.map((tab, index) => {
              const isLastPinned =
                tab.pinned && (index === tabs.length - 1 || !tabs[index + 1]?.pinned);
              return (
                <Fragment key={tab.id}>
                  <SortableWorkbenchTab
                    tab={tab}
                    active={tab.id === activeTabID}
                    workspaceID={key}
                    frozenWidth={frozenWidths?.[tab.id]}
                    freezeTabWidths={freezeTabWidths}
                  />
                  {isLastPinned ? <div className="h-4 w-px shrink-0 bg-border-strong" /> : null}
                </Fragment>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mr-1 h-7 w-7 shrink-0 p-0"
            onClick={() => setCommandOpen(true)}
            aria-label="Open command palette"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open command palette</TooltipContent>
      </Tooltip>
    </div>
  );
}

function SortableWorkbenchTab({
  tab,
  active,
  workspaceID,
  frozenWidth,
  freezeTabWidths,
}: {
  tab: WorkbenchTab;
  active: boolean;
  workspaceID: string;
  frozenWidth?: number;
  freezeTabWidths: () => void;
}) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  });
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(tab.customTitle ?? tab.title);
  const activateTab = useWorkbenchStore((state) => state.activateTab);
  const closeTab = useWorkbenchStore((state) => state.closeTab);
  const closeLeft = useWorkbenchStore((state) => state.closeLeft);
  const closeRight = useWorkbenchStore((state) => state.closeRight);
  const duplicateTab = useWorkbenchStore((state) => state.duplicateTab);
  const renameTab = useWorkbenchStore((state) => state.renameTab);
  const pinTab = useWorkbenchStore((state) => state.pinTab);
  const unpinTab = useWorkbenchStore((state) => state.unpinTab);
  const reopenLastClosed = useWorkbenchStore((state) => state.reopenLastClosed);
  const Icon =
    workbenchIconMap[tab.iconId as keyof typeof workbenchIconMap] ?? workbenchIconMap.ticket;
  const title = tab.customTitle ?? tab.title;
  const canClose = tab.routeId !== 'inbox';

  useEffect(() => setEditValue(tab.customTitle ?? tab.title), [tab.customTitle, tab.title]);
  useEffect(() => {
    if (!editing) return;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editing]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: frozenWidth,
  };

  function activate() {
    activateTab(workspaceID, tab.id);
    navigateWorkbenchHref(router, tab.href);
  }

  function closeAndNavigate() {
    closeTab(workspaceID, tab.id);
    if (active) {
      const next = selectActiveWorkspaceTab(workspaceID);
      if (next) navigateWorkbenchHref(router, next.href);
    }
  }

  function commitRename() {
    renameTab(workspaceID, tab.id, editValue);
    setEditing(false);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-tab-id={tab.id}
      className={cn(
        tab.pinned ? 'w-9 shrink-0' : 'min-w-[9rem] max-w-[15rem] flex-1',
        isDragging && 'opacity-60',
      )}
      {...attributes}
      {...listeners}
    >
      <div
        className={cn(
          'group flex h-9 min-w-0 items-center rounded-t-md border border-transparent px-2 text-[13px]',
          active
            ? 'border-border border-b-background bg-background text-foreground'
            : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
        )}
      >
        <button
          type="button"
          role="tab"
          aria-selected={active}
          className="flex min-w-0 flex-1 items-center gap-1.5"
          onClick={activate}
          onAuxClick={(event) => {
            if (event.button === 1 && canClose) {
              event.preventDefault();
              freezeTabWidths();
              closeAndNavigate();
            }
          }}
          onDoubleClick={() => {
            if (!tab.pinned) setEditing(true);
          }}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          {tab.pinned ? (
            <span className="sr-only">{title}</span>
          ) : editing ? (
            <input
              ref={editInputRef}
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename();
                if (event.key === 'Escape') setEditing(false);
              }}
              className="h-6 min-w-0 flex-1 rounded-sm border border-input bg-surface px-1 text-[13px] outline-none"
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <span className={cn('truncate', tab.customTitle && 'italic')}>{title}</span>
          )}
        </button>
        {!tab.pinned ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ml-1 grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
                aria-label={`${title} tab actions`}
              >
                <MoreHorizontal className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuItem
                onSelect={() =>
                  tab.pinned ? unpinTab(workspaceID, tab.id) : pinTab(workspaceID, tab.id)
                }
              >
                {tab.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                {tab.pinned ? 'Unpin tab' : 'Pin tab'}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  const duplicated = duplicateTab(workspaceID, tab.id);
                  if (duplicated) navigateWorkbenchHref(router, duplicated.href);
                }}
              >
                Duplicate tab
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setEditing(true)}>Rename tab</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  navigator.clipboard?.writeText(`${window.location.origin}${tab.href}`)
                }
              >
                <Copy className="h-3.5 w-3.5" /> Copy URL
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => window.open(tab.href, '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open browser tab
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!canClose}
                onSelect={() => {
                  freezeTabWidths();
                  closeAndNavigate();
                }}
              >
                <X className="h-3.5 w-3.5" /> Close tab
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  closeLeft(workspaceID, tab.id);
                  const next = selectActiveWorkspaceTab(workspaceID);
                  if (next) navigateWorkbenchHref(router, next.href);
                }}
              >
                Close tabs to left
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  closeRight(workspaceID, tab.id);
                  const next = selectActiveWorkspaceTab(workspaceID);
                  if (next) navigateWorkbenchHref(router, next.href);
                }}
              >
                Close tabs to right
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  const reopened = reopenLastClosed(workspaceID);
                  if (reopened) navigateWorkbenchHref(router, reopened.href);
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reopen closed tab
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {canClose ? (
          <button
            type="button"
            onMouseDown={freezeTabWidths}
            onClick={(event) => {
              event.stopPropagation();
              closeAndNavigate();
            }}
            className="ml-1 grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"
            aria-label={`Close ${title}`}
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
