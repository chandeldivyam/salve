import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle } from '@salve/ui';
import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { currentHotkeyPlatform, formatHotkey, type HotkeyPlatform } from '@/lib/commands/format';
import type { CommandGroup, KeyBinding } from '@/lib/commands/registry';
import { useCommandRegistry } from '@/lib/commands/registry';
import { useKeyBinding } from '@/lib/commands/use-key-binding';

const GROUP_ORDER: ReadonlyArray<CommandGroup> = [
  'Navigation',
  'Ticket',
  'Customer',
  'View',
  'Settings',
  'Help',
];

interface HelpRow {
  readonly key: string;
  readonly label: string;
  readonly group: CommandGroup;
  readonly patterns: ReadonlyArray<string>;
}

export function HelpModal() {
  const open = useCommandRegistry((state) => state.helpOpen);
  const setOpen = useCommandRegistry((state) => state.setHelpOpen);
  const bindings = useCommandRegistry((state) => state.bindings);
  const [platform, setPlatform] = useState<HotkeyPlatform>(currentHotkeyPlatform());
  const rows = useMemo(() => collapseBindings(bindings), [bindings]);

  useEffect(() => {
    if (!open) return;
    const store = useCommandRegistry.getState();
    store.pushModal('modal:help');
    return () => useCommandRegistry.getState().popModal('modal:help');
  }, [open]);

  useKeyBinding('Escape', () => setOpen(false), {
    scopes: ['modal:help'],
    allowInInputs: true,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        hideClose
        className="top-[10vh] w-[min(calc(100vw-2rem),38rem)] overflow-hidden p-0"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line-quiet px-4 py-3">
          <div>
            <DialogTitle className="text-[15px]">Keyboard shortcuts</DialogTitle>
            <DialogDescription className="mt-1 text-[12px]">
              Shortcuts available in the current workspace.
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex rounded-md bg-bg-elevated p-0.5">
              {(['mac', 'windows'] as const).map((item) => (
                <Button
                  key={item}
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setPlatform(item)}
                  className={cn(
                    'h-7 px-2 text-[12px]',
                    platform === item && 'bg-bg-popover text-fg-primary',
                  )}
                >
                  {item === 'mac' ? 'Mac' : 'Win'}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Close keyboard shortcuts"
              onClick={() => setOpen(false)}
              className="h-7 w-7 text-fg-tertiary hover:text-fg-primary"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-3">
          {groupBindings(rows).map(([group, groupRows]) => (
            <section key={group} className="pb-3">
              <h3 className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-quaternary">
                {group}
              </h3>
              <div className="space-y-0.5">
                {groupRows.map((row) => (
                  <div
                    key={row.key}
                    className="flex h-8 items-center justify-between gap-3 rounded-md px-2 text-[13px] hover:bg-bg-elevated/40"
                  >
                    <span className="min-w-0 truncate text-fg-secondary">{row.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {summarizePatterns(row.patterns).map((pattern) => (
                        <kbd
                          key={pattern}
                          className="shrink-0 rounded border border-line-default bg-bg-elevated px-1.5 py-0.5 text-[11px] text-fg-tertiary"
                        >
                          {formatHotkey(pattern, platform)}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Collapse bindings sharing the same (label, group) into one row. Multiple
// patterns become alternative key chips on that row. Without this, the
// help modal renders e.g. 9 "Switch tab" entries (one per ⌘1..⌘9) and
// 3 "Close ticket" entries (e + E + e-in-conversation-scope).
function collapseBindings(bindings: Record<string, KeyBinding>): ReadonlyArray<HelpRow> {
  const byKey = new Map<string, HelpRow & { mutablePatterns: string[] }>();
  for (const binding of Object.values(bindings)) {
    if (!binding.label || binding.enabled === false) continue;
    const group = binding.group ?? 'Help';
    const key = `${group}\u0000${binding.label}`;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.mutablePatterns.includes(binding.pattern)) {
        existing.mutablePatterns.push(binding.pattern);
      }
      continue;
    }
    const row = {
      key,
      label: binding.label,
      group,
      mutablePatterns: [binding.pattern],
      patterns: [] as string[],
    };
    byKey.set(key, row);
  }
  return [...byKey.values()].map((row) => ({
    key: row.key,
    label: row.label,
    group: row.group,
    patterns: row.mutablePatterns,
  }));
}

// Render at most three chips per row. For sequential numeric `$mod+N`
// bindings (Cmd+1..Cmd+9) collapse into a single range chip.
function summarizePatterns(patterns: ReadonlyArray<string>): ReadonlyArray<string> {
  const numeric = [...patterns].filter((pattern) => /^\$mod\+\d$/.test(pattern));
  if (numeric.length >= 3 && numeric.length === patterns.length) {
    const digits = numeric
      .map((pattern) => Number.parseInt(pattern.slice(-1), 10))
      .sort((a, b) => a - b);
    return [`$mod+${digits[0]}…${digits.at(-1)}`];
  }
  if (patterns.length <= 3) return patterns;
  return [...patterns.slice(0, 2), `+${patterns.length - 2} more`];
}

function groupBindings(
  rows: ReadonlyArray<HelpRow>,
): Array<[CommandGroup, ReadonlyArray<HelpRow>]> {
  const grouped = new Map<CommandGroup, HelpRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.group) ?? [];
    list.push(row);
    grouped.set(row.group, list);
  }
  return [...grouped.entries()].sort(([a], [b]) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
}
