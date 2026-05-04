import { mutators } from '@opendesk/mutators';
import { cn, Dialog, DialogContent, DialogDescription, DialogTitle } from '@opendesk/ui';
import { queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { useRouteContext, useRouter } from '@tanstack/react-router';
import { Command as Cmdk } from 'cmdk';
import { Search, Ticket, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { bulkAssign } from '@/components/inbox/bulk-actions';
import { acceptsTicketOrBulk } from '@/lib/commands/catalog';
import { formatHotkey } from '@/lib/commands/format';
import {
  allCommands,
  type Command,
  type CommandContext,
  type SubPageDescriptor,
  type Target,
  useCommandRegistry,
} from '@/lib/commands/registry';
import { labelForTarget, resolveTarget } from '@/lib/commands/target';
import { type SearchResponse, searchAll } from '@/lib/search';
import type { SessionData } from '@/lib/session-loader';
import {
  selectWorkspaceTabs,
  useWorkbenchStore,
  workbenchIconMap,
  workspaceKey,
} from '@/lib/workbench';
import { useZero } from '@/lib/zero';
import { CACHE_FOREVER } from '@/lib/zero-cache';
import { navigateWorkbenchHref } from '../workbench/navigation';

interface CommandPaletteProps {
  workspaceID: string | null;
}

const GROUP_ORDER: ReadonlyArray<string> = [
  'Ticket',
  'Navigation',
  'Open tabs',
  'Customer',
  'View',
  'Settings',
  'Help',
];

// Canonical destinations covered by `nav.*` catalog commands. Tabs at
// these hrefs are suppressed from the "Open tabs" group so we don't show
// e.g. `Inbox` (tab) next to `Go to inbox` (catalog) in the palette.
const CANONICAL_NAV_HREFS = new Set<string>([
  '/app/inbox',
  '/app/customers',
  '/app/settings/setup',
]);

const TAB_POSITION_HOTKEY_LIMIT = 9;
const SEARCH_DEBOUNCE_MS = 150;
const EMPTY_SEARCH_RESULTS: SearchResponse = { tickets: [], customers: [] };

export function CommandPalette({ workspaceID }: CommandPaletteProps) {
  const router = useRouter();
  const z = useZero();
  const { session } = useRouteContext({ from: '/app' }) as { session: SessionData };
  const key = workspaceKey(workspaceID);
  const open = useWorkbenchStore((state) => state.commandOpen);
  const setOpen = useWorkbenchStore((state) => state.setCommandOpen);
  const openOrReuseTab = useWorkbenchStore((state) => state.openOrReuseTab);
  const forkTab = useWorkbenchStore((state) => state.forkTab);
  const [members] = useQuery(queries.workspaceMembers(), CACHE_FOREVER);
  const [query, setQuery] = useState('');
  const [pages, setPages] = useState<SubPageDescriptor[]>([]);
  const [target, setTarget] = useState<Target>({ kind: 'none' });
  const [searchResults, setSearchResults] = useState<SearchResponse>(EMPTY_SEARCH_RESULTS);
  const [searchPending, setSearchPending] = useState(false);
  const [selectedValue, setSelectedValue] = useState<string>('');
  const page = pages.at(-1);
  const bindings = useCommandRegistry((state) => state.bindings);
  const rootQuery = page ? '' : query.trim();

  const ctx = useMemo<CommandContext>(
    () => ({
      workspaceID,
      userID: session.user.id,
      z,
      routePathname: router.state.location.pathname,
      openPalette: () => setOpen(true),
      closePalette: () => setOpen(false),
      openHelp: () => useCommandRegistry.getState().setHelpOpen(true),
      closeHelp: () => useCommandRegistry.getState().setHelpOpen(false),
      navigateHref: (href, opts) => {
        const tab = opts?.fork
          ? forkTab(key, href, 'command')
          : openOrReuseTab(key, href, 'command');
        navigateWorkbenchHref(router, tab.href);
      },
    }),
    [forkTab, key, openOrReuseTab, router, session.user.id, setOpen, workspaceID, z],
  );

  useEffect(() => {
    if (!open) return;
    const store = useCommandRegistry.getState();
    const request = store.paletteRequest;
    const nextTarget = request?.target ?? resolveTarget();
    setTarget(nextTarget);
    setQuery('');
    if (request) {
      const command = allCommands().find((candidate) => candidate.id === request.commandId);
      const subPage = command?.subPage?.(nextTarget, ctx);
      setPages(subPage ? [subPage] : []);
      store.setPaletteRequest(null);
    } else {
      setPages([]);
    }
    store.pushModal('dialog:cmdk');
    return () => useCommandRegistry.getState().popModal('dialog:cmdk');
  }, [ctx, open]);

  useEffect(() => {
    if (!open || !rootQuery) {
      setSearchResults(EMPTY_SEARCH_RESULTS);
      setSearchPending(false);
      return;
    }

    const controller = new AbortController();
    setSearchPending(true);
    const timeout = window.setTimeout(() => {
      searchAll(rootQuery, controller.signal)
        .then((results) => setSearchResults(results))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setSearchResults(EMPTY_SEARCH_RESULTS);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchPending(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
      setSearchPending(false);
    };
  }, [open, rootQuery]);

  const dynamicCommands = useMemo(
    () => [
      ...selectWorkspaceTabs(workspaceID)
        .map((tab, originalIndex) => ({ tab, originalIndex }))
        .filter(({ tab }) => !CANONICAL_NAV_HREFS.has(tab.href))
        .map<Command>(({ tab, originalIndex }, displayIndex) => {
          const Icon = workbenchIconMap[tab.iconId as keyof typeof workbenchIconMap];
          // The `$mod+N` binding picks tabs by their *original* position
          // in the workbench list, so the displayed hotkey hint must
          // mirror that — not the post-filter palette order.
          const hotkeyHint =
            originalIndex < TAB_POSITION_HOTKEY_LIMIT
              ? formatHotkey(`$mod+${originalIndex + 1}`)
              : undefined;
          return {
            id: `tab.${tab.id}`,
            label: tab.customTitle ?? tab.title,
            group: 'Open tabs',
            description: tab.href,
            icon: Icon,
            accepts: (candidate): candidate is Target => candidate.kind !== 'bulk',
            run: () => ctx.navigateHref(tab.href),
            order: displayIndex,
            hotkeyHint,
          };
        }),
      ...members.flatMap<Command>((member) => {
        const userID = member.userId;
        if (!userID || userID === session.user.id) return [];
        const label = member.user?.name ?? member.user?.email ?? userID;
        return [
          {
            id: `ticket.assign.${member.id}`,
            label: `Assign to ${label}`,
            group: 'Ticket',
            description: member.user?.email ?? undefined,
            accepts: acceptsTicketOrBulk,
            run: (commandTarget, commandCtx) => {
              if (commandTarget.kind === 'bulk') {
                return bulkAssign({ ids: commandTarget.ids, z: commandCtx.z as never }, userID);
              }
              if (commandTarget.kind !== 'ticket') return;
              void (commandCtx.z as { mutate: (mutation: unknown) => unknown }).mutate(
                mutators.ticket.assign({ id: commandTarget.id, assigneeID: userID }),
              );
            },
            order: 115,
          },
        ];
      }),
    ],
    [ctx, members, session.user.id, workspaceID],
  );

  const available = useMemo(() => {
    const source = page?.commands ?? [...allCommands(), ...dynamicCommands];
    return source
      .filter((command) => command.accepts(target))
      .sort((a, b) => (a.order ?? 500) - (b.order ?? 500) || a.label.localeCompare(b.label));
  }, [dynamicCommands, page, target]);
  const groupedAvailable = useMemo(() => groupCommands(available), [available]);

  const firstVisibleValue = useMemo(() => {
    if (!page && rootQuery) {
      const firstTicket = searchResults.tickets[0];
      if (firstTicket) return ticketSearchValue(firstTicket);
      const firstCustomer = searchResults.customers[0];
      if (firstCustomer) return customerSearchValue(firstCustomer);
    }
    return groupedAvailable[0]?.[1][0]?.id ?? '';
  }, [groupedAvailable, page, rootQuery, searchResults]);

  useEffect(() => {
    if (open) setSelectedValue(firstVisibleValue);
  }, [firstVisibleValue, open]);

  function close() {
    setOpen(false);
  }

  async function selectCommand(command: Command) {
    if (!command.accepts(target)) return;
    const condition = command.condition?.(target, ctx);
    if (typeof condition === 'string') return;
    const subPage = command.subPage?.(target, ctx);
    if (subPage) {
      setPages((current) => [...current, subPage]);
      if (!subPage.inheritsQuery) setQuery('');
      return;
    }
    await command.run(target, ctx);
    close();
  }

  const targetLabel = labelForTarget(target);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        hideClose
        className="top-[10vh] w-[min(calc(100vw-2rem),40rem)] overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Search actions and navigation.</DialogDescription>
        <Cmdk
          value={selectedValue}
          onValueChange={setSelectedValue}
          className="flex max-h-[min(640px,80vh)] flex-col overflow-hidden bg-bg-popover text-fg-primary"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
            if (event.key === 'Backspace' && query === '') {
              if (pages.length > 0) {
                event.preventDefault();
                setPages((current) => current.slice(0, -1));
                return;
              }
              if (target.kind !== 'none') {
                event.preventDefault();
                setTarget({ kind: 'none' });
              }
            }
          }}
        >
          <div className="flex min-h-12 items-center gap-2 border-b border-line-quiet px-3">
            <Search className="h-4 w-4 shrink-0 text-fg-tertiary" />
            {targetLabel ? (
              <button
                type="button"
                onClick={() => setTarget({ kind: 'none' })}
                className="inline-flex h-6 max-w-[180px] shrink-0 items-center gap-1 rounded-md bg-bg-elevated px-2 text-[12px] text-fg-secondary hover:bg-bg-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="truncate">{targetLabel}</span>
                <X className="h-3 w-3" />
              </button>
            ) : null}
            <Cmdk.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder={page?.title ?? 'Search commands…'}
              className="h-12 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg-quaternary focus-visible:outline-none focus-visible:ring-0"
            />
            <kbd className="rounded border border-line-default bg-bg-elevated px-1.5 py-0.5 text-[11px] text-fg-tertiary">
              {searchPending ? 'Searching' : 'Esc'}
            </kbd>
          </div>
          <Cmdk.List className="max-h-[560px] overflow-y-auto p-2">
            <Cmdk.Empty className="px-3 py-8 text-center text-[13px] text-fg-tertiary">
              No results
            </Cmdk.Empty>
            {!page && rootQuery ? (
              <SearchResultGroups
                results={searchResults}
                onTicket={(ticketID) => {
                  close();
                  ctx.navigateHref(`/app/inbox/t/${ticketID}`);
                }}
                onCustomer={(customerID) => {
                  close();
                  ctx.navigateHref(`/app/customers/${customerID}`);
                }}
              />
            ) : null}
            {groupedAvailable.map(([group, commands]) => (
              <Cmdk.Group
                key={group}
                heading={group}
                className="pb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-fg-quaternary"
              >
                {commands.map((command) => (
                  <CommandRow
                    key={command.id}
                    command={command}
                    hotkey={
                      command.hotkeyHint ?? hotkeyForCommand(command.id, Object.values(bindings))
                    }
                    onSelect={() => selectCommand(command)}
                  />
                ))}
              </Cmdk.Group>
            ))}
          </Cmdk.List>
        </Cmdk>
      </DialogContent>
    </Dialog>
  );
}

function SearchResultGroups({
  results,
  onTicket,
  onCustomer,
}: {
  results: SearchResponse;
  onTicket: (ticketID: string) => void;
  onCustomer: (customerID: string) => void;
}) {
  return (
    <>
      {results.tickets.length > 0 ? (
        <Cmdk.Group
          heading="Tickets"
          className="pb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-fg-quaternary"
        >
          {results.tickets.map((ticket) => (
            <Cmdk.Item
              key={`ticket:${ticket.id}`}
              value={ticketSearchValue(ticket)}
              onSelect={() => onTicket(ticket.id)}
              className={cn(
                'flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] outline-none',
                'aria-selected:bg-brand-soft aria-selected:text-brand-soft-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <Ticket className="h-4 w-4 shrink-0" />
              <span className="shrink-0 text-[12px] tabular-nums text-fg-tertiary">
                #{ticket.shortID}
              </span>
              <span className="min-w-0 flex-1 truncate">{ticket.title}</span>
              {ticket.customerEmail ? (
                <span className="hidden max-w-[180px] truncate text-[12px] text-fg-tertiary sm:block">
                  {ticket.customerEmail}
                </span>
              ) : null}
            </Cmdk.Item>
          ))}
        </Cmdk.Group>
      ) : null}
      {results.customers.length > 0 ? (
        <Cmdk.Group
          heading="Customers"
          className="pb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-fg-quaternary"
        >
          {results.customers.map((customer) => (
            <Cmdk.Item
              key={`customer:${customer.id}`}
              value={customerSearchValue(customer)}
              onSelect={() => onCustomer(customer.id)}
              className={cn(
                'flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] outline-none',
                'aria-selected:bg-brand-soft aria-selected:text-brand-soft-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <UserRound className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{customer.name}</span>
              <span className="hidden max-w-[220px] truncate text-[12px] text-fg-tertiary sm:block">
                {customer.email}
              </span>
            </Cmdk.Item>
          ))}
        </Cmdk.Group>
      ) : null}
    </>
  );
}

function ticketSearchValue(ticket: SearchResponse['tickets'][number]): string {
  return `ticket:${ticket.id}:${ticket.shortID}:${ticket.title}:${ticket.customerEmail ?? ''}`;
}

function customerSearchValue(customer: SearchResponse['customers'][number]): string {
  return `customer:${customer.id}:${customer.name}:${customer.email}`;
}

function CommandRow({
  command,
  hotkey,
  onSelect,
}: {
  command: Command;
  hotkey: string | null;
  onSelect: () => void;
}) {
  const Icon = command.icon;
  return (
    <Cmdk.Item
      value={command.id}
      keywords={[command.label, command.description ?? '', ...(command.keywords ?? [])]}
      onSelect={onSelect}
      className={cn(
        'flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] outline-none',
        'aria-selected:bg-brand-soft aria-selected:text-brand-soft-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0" /> : <span className="h-4 w-4 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{command.label}</span>
      {command.description ? (
        <span className="hidden max-w-[180px] truncate text-[12px] text-fg-tertiary sm:block">
          {command.description}
        </span>
      ) : null}
      {hotkey ? (
        <kbd className="ml-auto rounded border border-line-default bg-bg-elevated px-1.5 py-0.5 text-[11px] text-fg-tertiary">
          {hotkey}
        </kbd>
      ) : null}
    </Cmdk.Item>
  );
}

function groupCommands(commands: ReadonlyArray<Command>): Array<[string, ReadonlyArray<Command>]> {
  const grouped = new Map<string, Command[]>();
  for (const command of commands) {
    const group = grouped.get(command.group) ?? [];
    group.push(command);
    grouped.set(command.group, group);
  }
  return [...grouped.entries()].sort(([a], [b]) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
}

function hotkeyForCommand(
  commandId: string,
  bindings: ReadonlyArray<{ commandId?: string; pattern: string }>,
): string | null {
  const binding = bindings.find((candidate) => candidate.commandId === commandId);
  return binding ? formatHotkey(binding.pattern) : null;
}
