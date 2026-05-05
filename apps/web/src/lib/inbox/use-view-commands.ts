// Phase 40 — dynamic Cmd+K commands for the inbox view list.
//
// Subscribes to `views()` + the static built-ins and pushes them to the
// command registry under the `inbox` route key. The resulting commands
// surface in the palette grouped under "View" with an icon and the view's
// label as a keyword.
//
// Hotkeys (`Alt+V` save, `[`/`]` next/prev) live in `inbox-list.tsx` next
// to the keybinding shape; this hook only handles the data-driven catalog.

import { useQuery } from '@rocicorp/zero/react';
import { type BuiltinViewMember, queries, type View, type ViewMember } from '@salve/zero-schema';
import { Filter as FilterIcon } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import type { Command } from '@/lib/commands/registry';
import { useCommandRegistry } from '@/lib/commands/registry';
import { CACHE_FOREVER } from '@/lib/zero-cache';
import { BUILTIN_VIEWS } from './builtin-views';

type ViewWithMembers = View & {
  members: ReadonlyArray<ViewMember>;
};

export function useViewCommands(): ReadonlyArray<{ id: string; label: string }> {
  const [customViews] = useQuery(queries.views(), CACHE_FOREVER) as unknown as [
    ReadonlyArray<ViewWithMembers>,
    unknown,
  ];
  // Built-in `view_member` rows carry per-agent hide state for the
  // canonical built-ins. Without consulting them, "Hide for me" on
  // `builtin:resolved` would leave the command palette still surfacing
  // it (and `[`/`]` would still cycle through it).
  const [builtinMembers] = useQuery(queries.builtinViewMembers(), CACHE_FOREVER) as unknown as [
    ReadonlyArray<BuiltinViewMember>,
    unknown,
  ];

  const allViews = useMemo(() => {
    const hiddenBuiltinKeys = new Set(
      (builtinMembers ?? []).filter((m) => m.hiddenAt != null).map((m) => m.builtinKey),
    );
    const builtinList = BUILTIN_VIEWS.filter((v) => !hiddenBuiltinKeys.has(v.builtinKey)).map(
      (v) => ({ id: v.id, label: v.label }),
    );
    const customList = (customViews ?? [])
      .filter((v) => {
        const m = v.members?.[0];
        return !m || m.hiddenAt == null;
      })
      .map((v) => ({ id: v.id, label: v.label }));
    return [...builtinList, ...customList];
  }, [customViews, builtinMembers]);

  // Push commands into the route-scoped catalog under the 'inbox' route key.
  // The signature for each command: id `view.open.<id>`, group 'View'.
  useEffect(() => {
    const commands: Command[] = allViews.map((v, idx) => ({
      id: `view.open.${v.id}`,
      label: `Switch to ${v.label}`,
      group: 'View' as const,
      icon: FilterIcon,
      keywords: [v.label, 'view'],
      accepts: () => true,
      run: (_target, ctx) => ctx.navigateHref(`/app/inbox?view=${encodeURIComponent(v.id)}`),
      order: 800 + idx,
    }));
    useCommandRegistry.getState().setRouteCommands('inbox', commands);
    return () => {
      useCommandRegistry.getState().setRouteCommands('inbox', []);
    };
  }, [allViews]);

  return allViews;
}
