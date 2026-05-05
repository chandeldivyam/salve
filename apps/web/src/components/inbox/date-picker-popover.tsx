// Phase 40 — date filter editor.
//
// Two modes side-by-side in a single dropdown:
//   • Relative ("in last N days") with preset chips and a custom input
//   • Absolute (before / after / between) with native date inputs
//
// Returns a `Filter` shape via `onChange`. The caller decides which field
// the filter targets — this component is type-agnostic.

import { Button, cn, DropdownMenuLabel, DropdownMenuSeparator } from '@salve/ui';
import type { Filter, FilterField } from '@salve/zero-schema';
import { useEffect, useMemo, useState } from 'react';

type DateUnit = 'minute' | 'hour' | 'day' | 'week';

interface DatePickerPopoverProps {
  field: FilterField;
  filter: Filter;
  onChange: (next: Filter) => void;
  /**
   * Called after a commit (Apply / Enter / preset chip). Lets the caller
   * close the surrounding dropdown — without this the user has to click
   * outside the popover after every edit. Optional so `<DatePickerPopover>`
   * can still be rendered standalone without forcing a close handler.
   */
  onClose?: () => void;
}

const RELATIVE_PRESETS: ReadonlyArray<{
  label: string;
  unit: DateUnit;
  n: number;
}> = [
  { label: 'Last 24h', unit: 'hour', n: 24 },
  { label: 'Last 7 days', unit: 'day', n: 7 },
  { label: 'Last 30 days', unit: 'day', n: 30 },
  { label: 'Last 90 days', unit: 'day', n: 90 },
];

type Mode = 'relative' | 'before' | 'after' | 'between';

export function DatePickerPopover({ field, filter, onChange, onClose }: DatePickerPopoverProps) {
  const initial = useMemo(() => readMode(filter), [filter]);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [absolute1, setAbsolute1] = useState<string>(initial.absolute1);
  const [absolute2, setAbsolute2] = useState<string>(initial.absolute2);
  const [customN, setCustomN] = useState<string>(String(initial.customN));
  const [customUnit, setCustomUnit] = useState<DateUnit>(initial.customUnit);

  // Re-seed from incoming filter on prop change so the popover stays
  // in sync when the URL is mutated externally.
  useEffect(() => {
    const next = readMode(filter);
    setMode(next.mode);
    setAbsolute1(next.absolute1);
    setAbsolute2(next.absolute2);
    setCustomN(String(next.customN));
    setCustomUnit(next.customUnit);
  }, [filter]);

  const applyRelative = (unit: DateUnit, n: number) => {
    onChange({ field, operator: 'inLast', value: { unit, n } });
    onClose?.();
  };

  const applyAbsolute = (op: 'before' | 'after', iso: string) => {
    if (!iso) return;
    const epoch = Date.parse(`${iso}T00:00:00.000Z`);
    if (!Number.isFinite(epoch)) return;
    onChange({ field, operator: op, value: epoch });
    onClose?.();
  };

  const applyBetween = (lo: string, hi: string) => {
    if (!lo || !hi) return;
    const a = Date.parse(`${lo}T00:00:00.000Z`);
    const b = Date.parse(`${hi}T23:59:59.999Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    onChange({ field, operator: 'between', values: [a, b] });
    onClose?.();
  };

  return (
    <div className="w-72 p-1.5">
      <div className="flex items-center gap-1 px-1.5 pb-1.5">
        <ModeTab active={mode === 'relative'} onClick={() => setMode('relative')}>
          Relative
        </ModeTab>
        <ModeTab active={mode === 'before'} onClick={() => setMode('before')}>
          Before
        </ModeTab>
        <ModeTab active={mode === 'after'} onClick={() => setMode('after')}>
          After
        </ModeTab>
        <ModeTab active={mode === 'between'} onClick={() => setMode('between')}>
          Between
        </ModeTab>
      </div>
      <DropdownMenuSeparator />

      {mode === 'relative' ? (
        <div className="flex flex-col gap-1.5 px-1.5 py-2">
          <DropdownMenuLabel className="px-0">Quick ranges</DropdownMenuLabel>
          <div className="flex flex-wrap gap-1">
            {RELATIVE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyRelative(p.unit, p.n)}
                className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-xs text-fg-primary hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {p.label}
              </button>
            ))}
          </div>
          <DropdownMenuLabel className="mt-1 px-0">Custom</DropdownMenuLabel>
          <div className="flex items-center gap-1">
            <span className="text-xs text-fg-tertiary">Last</span>
            <input
              type="number"
              min={1}
              max={9999}
              value={customN}
              onChange={(e) => setCustomN(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const n = Number.parseInt(customN, 10);
                  if (Number.isFinite(n) && n > 0) applyRelative(customUnit, n);
                }
              }}
              className="h-7 w-16 rounded-md border border-border bg-bg-elevated px-2 text-xs text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <select
              value={customUnit}
              onChange={(e) => setCustomUnit(e.target.value as DateUnit)}
              className="h-7 rounded-md border border-border bg-bg-elevated px-2 text-xs text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="minute">minutes</option>
              <option value="hour">hours</option>
              <option value="day">days</option>
              <option value="week">weeks</option>
            </select>
            <Button
              size="sm"
              variant="default"
              onClick={() => {
                const n = Number.parseInt(customN, 10);
                if (Number.isFinite(n) && n > 0) applyRelative(customUnit, n);
              }}
              className="h-7 px-2 text-xs"
            >
              Apply
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'before' || mode === 'after' ? (
        <div className="flex flex-col gap-1.5 px-1.5 py-2">
          <DropdownMenuLabel className="px-0">
            {mode === 'before' ? 'Before date' : 'After date'}
          </DropdownMenuLabel>
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={absolute1}
              onChange={(e) => setAbsolute1(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyAbsolute(mode, absolute1);
                }
              }}
              className="h-7 flex-1 rounded-md border border-border bg-bg-elevated px-2 text-xs text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              size="sm"
              variant="default"
              onClick={() => applyAbsolute(mode, absolute1)}
              className="h-7 px-2 text-xs"
            >
              Apply
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'between' ? (
        <div className="flex flex-col gap-1.5 px-1.5 py-2">
          <DropdownMenuLabel className="px-0">Between dates</DropdownMenuLabel>
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={absolute1}
              onChange={(e) => setAbsolute1(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyBetween(absolute1, absolute2);
                }
              }}
              className="h-7 flex-1 rounded-md border border-border bg-bg-elevated px-2 text-xs text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="text-xs text-fg-tertiary">→</span>
            <input
              type="date"
              value={absolute2}
              onChange={(e) => setAbsolute2(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyBetween(absolute1, absolute2);
                }
              }}
              className="h-7 flex-1 rounded-md border border-border bg-bg-elevated px-2 text-xs text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              size="sm"
              variant="default"
              onClick={() => applyBetween(absolute1, absolute2)}
              className="h-7 px-2 text-xs"
            >
              Apply
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-bg-elevated font-medium text-fg-primary'
          : 'text-fg-tertiary hover:bg-bg-elevated hover:text-fg-primary',
      )}
    >
      {children}
    </button>
  );
}

interface ModeReadout {
  mode: Mode;
  absolute1: string;
  absolute2: string;
  customN: number;
  customUnit: DateUnit;
}

function readMode(filter: Filter): ModeReadout {
  const fallback: ModeReadout = {
    mode: 'relative',
    absolute1: '',
    absolute2: '',
    customN: 7,
    customUnit: 'day',
  };
  if (filter.operator === 'inLast' || filter.operator === 'notInLast') {
    return {
      ...fallback,
      mode: 'relative',
      customN: filter.value.n,
      customUnit: filter.value.unit,
    };
  }
  if (filter.operator === 'before' || filter.operator === 'after') {
    return {
      ...fallback,
      mode: filter.operator,
      absolute1: epochToIsoDate(filter.value),
    };
  }
  if (filter.operator === 'between') {
    return {
      ...fallback,
      mode: 'between',
      absolute1: epochToIsoDate(filter.values[0]),
      absolute2: epochToIsoDate(filter.values[1]),
    };
  }
  return fallback;
}

function epochToIsoDate(epoch: number): string {
  if (!Number.isFinite(epoch)) return '';
  return new Date(epoch).toISOString().slice(0, 10);
}

/**
 * Render a date filter to a short human-readable form for the chip trigger.
 */
export function describeDateFilter(filter: Filter): string {
  if (filter.operator === 'inLast') return `last ${filter.value.n}${unitShort(filter.value.unit)}`;
  if (filter.operator === 'notInLast')
    return `not last ${filter.value.n}${unitShort(filter.value.unit)}`;
  if (filter.operator === 'before') return `before ${epochToShort(filter.value)}`;
  if (filter.operator === 'after') return `after ${epochToShort(filter.value)}`;
  if (filter.operator === 'between')
    return `${epochToShort(filter.values[0])}–${epochToShort(filter.values[1])}`;
  if (filter.operator === 'empty') return 'empty';
  if (filter.operator === 'nempty') return 'set';
  return 'any';
}

function unitShort(unit: DateUnit): string {
  return unit === 'minute' ? 'm' : unit === 'hour' ? 'h' : unit === 'day' ? 'd' : 'w';
}

function epochToShort(epoch: number): string {
  if (!Number.isFinite(epoch)) return '?';
  return new Date(epoch).toISOString().slice(0, 10);
}
