// Phase 40 — type-aware custom field filter chip.
//
// The chip's editor switches on `field.type` from the `customField` row.
// The trigger always shows `<displayName>: <short value summary>` plus an
// X to remove. The dropdown content is built per type:
//
//   text / url / address                  → "contains" input
//   number / decimal                      → range editor (eq / lt / gt / between)
//   boolean                               → True / False radio
//   date                                  → DatePickerPopover (relative + absolute)
//   list / dynamic_list                   → multi-select from options (or text for dynamic)
//   multi_select / dynamic_multi_select   → multi-select from options (or text for dynamic)
//   agent                                 → workspace-member combobox
//   customer                              → customer search combobox
//   ticket                                → not yet — chip soft-fails
//
// All edits route back through `onChange(filter)` with the right `Filter`
// shape. The matching predicate runs in `customFieldPredicate` over the
// materialized `customFieldValues` rows.

import {
  Avatar,
  AvatarFallback,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  initialsFromName,
} from '@opendesk/ui';
import type { CustomField as CustomFieldDef, CustomFieldType, Filter } from '@opendesk/zero-schema';
import { queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { ChevronDown, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CACHE_FOREVER } from '@/lib/zero-cache';
import { DatePickerPopover, describeDateFilter } from './date-picker-popover';

interface CustomFieldChipProps {
  field: CustomFieldDef;
  filter: Filter;
  onChange: (next: Filter) => void;
  onRemove: () => void;
  currentUserID: string;
}

export function CustomFieldChip({
  field,
  filter,
  onChange,
  onRemove,
  currentUserID,
}: CustomFieldChipProps) {
  const [open, setOpen] = useState(false);
  const triggerLabel = useMemo(
    () => describeFilterValue(filter, field, currentUserID),
    [filter, field, currentUserID],
  );

  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-md border border-border bg-bg-elevated text-xs">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid={`filter-chip-customField-${field.key}`}
            className="inline-flex items-center gap-1.5 px-2 text-fg-primary hover:bg-bg-elevated-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-fg-tertiary">{field.displayName}:</span>
            <span className="font-medium">{triggerLabel}</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-auto">
          <Editor
            field={field}
            filter={filter}
            onChange={onChange}
            currentUserID={currentUserID}
            onClose={() => setOpen(false)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label={`Remove ${field.displayName} filter`}
        data-testid={`filter-chip-customField-${field.key}-remove`}
        onClick={onRemove}
        className="border-l border-border px-1.5 text-fg-tertiary transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ---------- Per-type editors ----------

function Editor({
  field,
  filter,
  onChange,
  currentUserID,
  onClose,
}: {
  field: CustomFieldDef;
  filter: Filter;
  onChange: (next: Filter) => void;
  currentUserID: string;
  onClose: () => void;
}) {
  const fieldKey = `customField:${field.key}` as const;
  const type = field.type as CustomFieldType;

  if (type === 'text' || type === 'url' || type === 'address') {
    return (
      <TextLikeEditor field={fieldKey} filter={filter} onChange={onChange} onClose={onClose} />
    );
  }
  if (type === 'number' || type === 'decimal') {
    return (
      <NumberEditor
        field={fieldKey}
        filter={filter}
        onChange={onChange}
        integerOnly={type === 'number'}
        onClose={onClose}
      />
    );
  }
  if (type === 'boolean') {
    return <BooleanEditor field={fieldKey} filter={filter} onChange={onChange} />;
  }
  if (type === 'date') {
    return (
      <DatePickerPopover field={fieldKey} filter={filter} onChange={onChange} onClose={onClose} />
    );
  }
  if (type === 'list' || type === 'multi_select') {
    return (
      <ListEditor
        field={fieldKey}
        filter={filter}
        onChange={onChange}
        options={field.options}
        multi={type === 'multi_select'}
      />
    );
  }
  if (type === 'agent') {
    return (
      <AgentEditor
        field={fieldKey}
        filter={filter}
        onChange={onChange}
        currentUserID={currentUserID}
      />
    );
  }
  if (type === 'customer') {
    return <CustomerEditor field={fieldKey} filter={filter} onChange={onChange} />;
  }
  if (type === 'dynamic_list' || type === 'dynamic_multi_select') {
    // Dynamic options aren't statically known on the client; the most
    // reliable v1 surface is a text "contains" filter — agents typically
    // know the value they're searching for.
    return (
      <TextLikeEditor field={fieldKey} filter={filter} onChange={onChange} onClose={onClose} />
    );
  }
  // ticket type — soft-fail with a presence toggle.
  return <PresenceEditor field={fieldKey} filter={filter} onChange={onChange} />;
}

function TextLikeEditor({
  field,
  filter,
  onChange,
  onClose,
}: {
  field: `customField:${string}`;
  filter: Filter;
  onChange: (next: Filter) => void;
  onClose: () => void;
}) {
  const initial = filter.operator === 'contains' ? (filter.value as string) : '';
  const [text, setText] = useState(initial);
  const apply = () => {
    if (text.trim().length === 0) {
      onChange({ field, operator: 'nempty' });
    } else {
      onChange({ field, operator: 'contains', value: text });
    }
    onClose();
  };
  return (
    <div className="flex w-64 flex-col gap-1.5 p-1.5">
      <DropdownMenuLabel className="px-1">Contains</DropdownMenuLabel>
      <div className="flex items-center gap-1 px-1">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            }
          }}
          placeholder="Search…"
          autoFocus
          className="h-7 text-xs"
        />
        <Button size="sm" variant="default" onClick={apply} className="h-7 px-2 text-xs">
          Apply
        </Button>
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onChange({ field, operator: 'empty' })}>
        Is empty
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onChange({ field, operator: 'nempty' })}>
        Is set
      </DropdownMenuItem>
    </div>
  );
}

function NumberEditor({
  field,
  filter,
  onChange,
  integerOnly,
  onClose,
}: {
  field: `customField:${string}`;
  filter: Filter;
  onChange: (next: Filter) => void;
  integerOnly: boolean;
  onClose: () => void;
}) {
  const [op, setOp] = useState<'eq' | 'before' | 'after' | 'between'>(() => {
    if (filter.operator === 'eq') return 'eq';
    if (filter.operator === 'before') return 'before';
    if (filter.operator === 'after') return 'after';
    if (filter.operator === 'between') return 'between';
    return 'eq';
  });
  const [a, setA] = useState<string>(() => firstNumber(filter));
  const [b, setB] = useState<string>(() => secondNumber(filter));

  const parse = (s: string): number | undefined => {
    if (s.trim() === '') return undefined;
    const n = integerOnly ? Number.parseInt(s, 10) : Number.parseFloat(s);
    return Number.isFinite(n) ? n : undefined;
  };

  // `apply` is invoked from Enter, blur, and the Apply button. It commits
  // unconditionally when the input parses; `closeAfter` controls whether
  // the popover closes after committing. We close on Enter / Apply, but
  // leave the popover open on blur (so tabbing between the two `between`
  // inputs doesn't slam the popover shut between keystrokes).
  const apply = (closeAfter: boolean) => {
    const av = parse(a);
    let committed = false;
    if (op === 'eq' && av !== undefined) {
      onChange({ field, operator: 'eq', value: av });
      committed = true;
    } else if ((op === 'before' || op === 'after') && av !== undefined) {
      onChange({ field, operator: op, value: av });
      committed = true;
    } else if (op === 'between') {
      const bv = parse(b);
      if (av !== undefined && bv !== undefined) {
        onChange({ field, operator: 'between', values: [Math.min(av, bv), Math.max(av, bv)] });
        committed = true;
      }
    }
    if (committed && closeAfter) onClose();
  };

  return (
    <div className="flex w-64 flex-col gap-1.5 p-1.5">
      <div className="flex items-center gap-1 px-1">
        <select
          value={op}
          onChange={(e) => setOp(e.target.value as typeof op)}
          className="h-7 rounded-md border border-border bg-bg-elevated px-2 text-xs text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="eq">=</option>
          <option value="before">&lt;</option>
          <option value="after">&gt;</option>
          <option value="between">between</option>
        </select>
        <Input
          type="number"
          value={a}
          onChange={(e) => setA(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply(true);
            }
          }}
          onBlur={() => apply(false)}
          step={integerOnly ? 1 : 'any'}
          autoFocus
          className="h-7 flex-1 text-xs"
        />
        {op === 'between' ? (
          <>
            <span className="text-xs text-fg-tertiary">→</span>
            <Input
              type="number"
              value={b}
              onChange={(e) => setB(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  apply(true);
                }
              }}
              onBlur={() => apply(false)}
              step={integerOnly ? 1 : 'any'}
              className="h-7 flex-1 text-xs"
            />
          </>
        ) : null}
        <Button
          size="sm"
          variant="default"
          onClick={() => apply(true)}
          className="h-7 px-2 text-xs"
        >
          Apply
        </Button>
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onChange({ field, operator: 'empty' })}>
        Is empty
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onChange({ field, operator: 'nempty' })}>
        Is set
      </DropdownMenuItem>
    </div>
  );
}

function BooleanEditor({
  field,
  filter,
  onChange,
}: {
  field: `customField:${string}`;
  filter: Filter;
  onChange: (next: Filter) => void;
}) {
  const value = filter.operator === 'eq' ? (filter.value as boolean) : null;
  return (
    <div className="flex w-44 flex-col p-1">
      <DropdownMenuItem onSelect={() => onChange({ field, operator: 'eq', value: true })}>
        <span
          className={cn(
            'inline-block h-3.5 w-3.5 rounded-full border',
            value === true ? 'border-ring bg-ring' : 'border-border',
          )}
        />
        True
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onChange({ field, operator: 'eq', value: false })}>
        <span
          className={cn(
            'inline-block h-3.5 w-3.5 rounded-full border',
            value === false ? 'border-ring bg-ring' : 'border-border',
          )}
        />
        False
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onChange({ field, operator: 'empty' })}>
        Is empty
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onChange({ field, operator: 'nempty' })}>
        Is set
      </DropdownMenuItem>
    </div>
  );
}

function ListEditor({
  field,
  filter,
  onChange,
  options,
  multi,
}: {
  field: `customField:${string}`;
  filter: Filter;
  onChange: (next: Filter) => void;
  options: ReadonlyArray<string>;
  multi: boolean;
}) {
  const selected = useMemo(() => readSelectedValues(filter), [filter]);
  return (
    <div className="w-56 p-0">
      <DropdownMenuLabel>{multi ? 'Includes any' : 'Is any of'}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <div className="max-h-60 overflow-y-auto">
        {options.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-fg-tertiary">No options configured</div>
        ) : null}
        {options.map((opt) => {
          const checked = selected.includes(opt);
          return (
            <DropdownMenuCheckboxItem
              key={opt}
              checked={checked}
              onCheckedChange={(c) => {
                const next = c ? [...selected, opt] : selected.filter((v) => v !== opt);
                onChange(
                  multi
                    ? { field, operator: 'includesAny', values: next }
                    : { field, operator: 'in', values: next },
                );
              }}
              onSelect={(e) => e.preventDefault()}
            >
              {opt}
            </DropdownMenuCheckboxItem>
          );
        })}
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onChange({ field, operator: 'empty' })}>
        Is empty
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onChange({ field, operator: 'nempty' })}>
        Is set
      </DropdownMenuItem>
    </div>
  );
}

function AgentEditor({
  field,
  filter,
  onChange,
  currentUserID,
}: {
  field: `customField:${string}`;
  filter: Filter;
  onChange: (next: Filter) => void;
  currentUserID: string;
}) {
  const [members] = useQuery(queries.workspaceMembers(), CACHE_FOREVER) as unknown as [
    ReadonlyArray<{ userId: string; user?: { id: string; name?: string; email: string } }>,
    unknown,
  ];
  const list = useMemo(
    () =>
      (members ?? [])
        .map((m) => m.user)
        .filter(Boolean)
        .slice(0, 50) as Array<{ id: string; name?: string; email: string }>,
    [members],
  );
  return (
    <div className="w-56 p-0">
      <DropdownMenuLabel>Agent</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onChange({ field, operator: 'eq', value: currentUserID })}>
        <Avatar className="h-4 w-4">
          <AvatarFallback className="text-[9px]">Me</AvatarFallback>
        </Avatar>
        Me
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <div className="max-h-60 overflow-y-auto">
        {list.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onSelect={() => onChange({ field, operator: 'eq', value: m.id })}
          >
            <Avatar className="h-4 w-4">
              <AvatarFallback className="text-[9px]">
                {initialsFromName(m.name ?? m.email)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{m.name ?? m.email}</span>
          </DropdownMenuItem>
        ))}
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onChange({ field, operator: 'empty' })}>
        Is empty
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onChange({ field, operator: 'nempty' })}>
        Is set
      </DropdownMenuItem>
    </div>
  );
}

function CustomerEditor({
  field,
  filter,
  onChange,
}: {
  field: `customField:${string}`;
  filter: Filter;
  onChange: (next: Filter) => void;
}) {
  const [search, setSearch] = useState('');
  const [customers] = useQuery(
    queries.customerList({ search: search.trim() || undefined, limit: 25 }),
    CACHE_FOREVER,
  ) as unknown as [ReadonlyArray<{ id: string; name?: string; email: string }>, unknown];
  return (
    <div className="w-64 p-0">
      <DropdownMenuLabel>Customer</DropdownMenuLabel>
      <div className="px-1.5 pb-1.5">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customers…"
          autoFocus
          className="h-7 text-xs"
        />
      </div>
      <DropdownMenuSeparator />
      <div className="max-h-60 overflow-y-auto">
        {(customers ?? []).slice(0, 25).map((c) => (
          <DropdownMenuItem
            key={c.id}
            onSelect={() => onChange({ field, operator: 'eq', value: c.id })}
          >
            <Avatar className="h-4 w-4">
              <AvatarFallback className="text-[9px]">
                {initialsFromName(c.name ?? c.email)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{c.name ?? c.email}</span>
          </DropdownMenuItem>
        ))}
        {customers && customers.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-fg-tertiary">No customers found</div>
        ) : null}
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onChange({ field, operator: 'empty' })}>
        Is empty
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onChange({ field, operator: 'nempty' })}>
        Is set
      </DropdownMenuItem>
    </div>
  );
}

function PresenceEditor({
  field,
  onChange,
}: {
  field: `customField:${string}`;
  filter: Filter;
  onChange: (next: Filter) => void;
}) {
  return (
    <div className="w-44 p-1">
      <DropdownMenuItem onSelect={() => onChange({ field, operator: 'nempty' })}>
        Is set
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onChange({ field, operator: 'empty' })}>
        Is empty
      </DropdownMenuItem>
    </div>
  );
}

// ---------- Helpers ----------

function readSelectedValues(filter: Filter): string[] {
  if ('values' in filter && Array.isArray(filter.values)) {
    return (filter.values as Array<string | number>).map(String);
  }
  if ('value' in filter && filter.value !== undefined) {
    return [String(filter.value)];
  }
  return [];
}

function firstNumber(filter: Filter): string {
  if (filter.operator === 'eq' && typeof filter.value === 'number') return String(filter.value);
  if (
    (filter.operator === 'before' || filter.operator === 'after') &&
    typeof filter.value === 'number'
  )
    return String(filter.value);
  if (filter.operator === 'between' && typeof filter.values?.[0] === 'number')
    return String(filter.values[0]);
  return '';
}

function secondNumber(filter: Filter): string {
  if (filter.operator === 'between' && typeof filter.values?.[1] === 'number')
    return String(filter.values[1]);
  return '';
}

function describeFilterValue(filter: Filter, field: CustomFieldDef, currentUserID: string): string {
  if (filter.operator === 'empty') return 'empty';
  if (filter.operator === 'nempty') return 'set';
  const type = field.type as CustomFieldType;
  // `before` / `after` / `between` are *operators*, not types — number and
  // decimal fields reuse them as `<` / `>` / range. The describer used to
  // call `describeDateFilter` unconditionally, which treats the numeric
  // `value` as a Unix-epoch ms (so `< 100` rendered as `before
  // 1970-01-01`). Branch on field type before formatting.
  const isNumeric = type === 'number' || type === 'decimal';
  if (type === 'date') return describeDateFilter(filter);
  if (isNumeric) {
    if (filter.operator === 'before') return `< ${String(filter.value)}`;
    if (filter.operator === 'after') return `> ${String(filter.value)}`;
    if (filter.operator === 'between')
      return `${String(filter.values[0])}–${String(filter.values[1])}`;
  }
  if (filter.operator === 'eq') {
    const v = filter.value;
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    if (type === 'agent' && v === currentUserID) return 'Me';
    return String(v);
  }
  if (filter.operator === 'neq') return `not ${String(filter.value)}`;
  if (filter.operator === 'in' || filter.operator === 'includesAny') {
    if (filter.values.length === 0) return 'any';
    if (filter.values.length === 1) return String(filter.values[0]);
    return `${filter.values.length} selected`;
  }
  if (filter.operator === 'contains') return `"${filter.value}"`;
  // Date-shaped fallthrough for non-numeric, non-date fields that
  // somehow ended up with a date-style operator (shouldn't happen with
  // the current editors, but the describer must not crash).
  if (filter.operator === 'before') return describeDateFilter(filter);
  if (filter.operator === 'after') return describeDateFilter(filter);
  if (filter.operator === 'between') return describeDateFilter(filter);
  return 'any';
}

/**
 * Default `Filter` shape for a freshly-added custom field chip. Caller
 * uses this when the agent picks the field from the `+ Filter` dropdown.
 */
export function defaultCustomFieldFilter(field: CustomFieldDef): Filter {
  const fieldKey = `customField:${field.key}` as const;
  const type = field.type as CustomFieldType;
  if (type === 'list') return { field: fieldKey, operator: 'in', values: [] };
  if (type === 'multi_select') return { field: fieldKey, operator: 'includesAny', values: [] };
  if (type === 'boolean') return { field: fieldKey, operator: 'eq', value: true };
  if (type === 'date') return { field: fieldKey, operator: 'inLast', value: { unit: 'day', n: 7 } };
  if (type === 'number' || type === 'decimal') return { field: fieldKey, operator: 'nempty' };
  // text / url / address / dynamic_* / agent / customer / ticket — start with
  // a presence chip so the agent can refine it from the popover.
  return { field: fieldKey, operator: 'nempty' };
}
