// Phase 40 — chip filter bar.
//
// Renders the active filter chips below the strip. Each chip is a
// `DropdownMenu` whose trigger shows `Field: value(s)` and whose content
// is a multi-select / single-select editor. The right-edge `+ Filter`
// button opens a field picker; chosen field appends a default chip.
//
// State source: the `f` URL search param (encoded array of `Filter`).
// All edits round-trip through `onFiltersChange` which encodes back into
// the URL via TanStack Router's `navigate({search})`.
//
// v1 supports: status, priority, assignee, tag. Date / custom-field chips
// land in the next slice.

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
  initialsFromName,
} from '@opendesk/ui';
import type { CustomField as CustomFieldDef, Filter, FilterField } from '@opendesk/zero-schema';
import { queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import {
  AlertTriangle,
  CheckCircle2,
  Filter as FilterIcon,
  Plus,
  Sparkles,
  Tag as TagIcon,
  UserRound,
  X,
} from 'lucide-react';
import { useMemo } from 'react';
import { CACHE_FOREVER } from '@/lib/zero-cache';
import { CustomFieldChip, defaultCustomFieldFilter } from './custom-field-chip';

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'snoozed', label: 'Snoozed' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
] as const;

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
] as const;

const FIELD_DEFS: ReadonlyArray<{
  field: FilterField;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { field: 'status', label: 'Status', icon: CheckCircle2 },
  { field: 'priority', label: 'Priority', icon: AlertTriangle },
  { field: 'assignee', label: 'Assignee', icon: UserRound },
  { field: 'tag', label: 'Tag', icon: TagIcon },
];

interface InboxFilterBarProps {
  filters: ReadonlyArray<Filter>;
  onFiltersChange: (filters: Filter[]) => void;
  currentUserID: string;
}

export function InboxFilterBar({ filters, onFiltersChange, currentUserID }: InboxFilterBarProps) {
  // Limit concurrent subscriptions: only fire `tags` and `workspaceMembers`
  // when the agent actually opens / has a chip for them.
  const needsMembers = useMemo(() => filters.some((f) => f.field === 'assignee'), [filters]);
  const needsTags = useMemo(() => filters.some((f) => f.field === 'tag'), [filters]);

  // Custom field definitions for ticket category. Cheap subscription —
  // bounded by SETTINGS_CATALOGUE_LIMIT in the queries.
  const [customFields] = useQuery(
    queries.customFieldsByCategory({ category: 'ticket' }),
    CACHE_FOREVER,
  ) as unknown as [ReadonlyArray<CustomFieldDef>, unknown];
  const customFieldByKey = useMemo(() => {
    const map = new Map<string, CustomFieldDef>();
    for (const f of customFields ?? []) map.set(f.key, f);
    return map;
  }, [customFields]);

  const updateAt = (index: number, next: Filter) => {
    const out = [...filters];
    out[index] = next;
    onFiltersChange(out);
  };
  const removeAt = (index: number) => {
    onFiltersChange(filters.filter((_, i) => i !== index));
  };
  const append = (filter: Filter) => {
    onFiltersChange([...filters, filter]);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.map((filter, index) => {
        // Custom field chip routes to a separate component because its
        // editor is type-aware. Static chips (status / priority / assignee
        // / tag) keep the lighter renderer below.
        if (typeof filter.field === 'string' && filter.field.startsWith('customField:')) {
          const key = filter.field.slice('customField:'.length);
          const def = customFieldByKey.get(key);
          if (!def) {
            // Field was archived or does not exist in this workspace — drop
            // the chip silently rather than render a broken placeholder.
            return null;
          }
          return (
            <CustomFieldChip
              // biome-ignore lint/suspicious/noArrayIndexKey: chip identity = field+index in URL order
              key={`${filter.field}-${index}`}
              field={def}
              filter={filter}
              onChange={(next) => updateAt(index, next)}
              onRemove={() => removeAt(index)}
              currentUserID={currentUserID}
            />
          );
        }
        return (
          <FilterChip
            // biome-ignore lint/suspicious/noArrayIndexKey: chips reorder by URL state, index is stable per render
            key={`${filter.field}-${index}`}
            filter={filter}
            onChange={(next) => updateAt(index, next)}
            onRemove={() => removeAt(index)}
            currentUserID={currentUserID}
            membersEnabled={needsMembers}
            tagsEnabled={needsTags}
          />
        );
      })}
      <AddFilterButton
        existing={filters}
        onAdd={(filter) => append(filter)}
        currentUserID={currentUserID}
        customFields={customFields ?? []}
      />
    </div>
  );
}

// ---------- Add-filter dropdown ----------

function AddFilterButton({
  existing,
  onAdd,
  currentUserID,
  customFields,
}: {
  existing: ReadonlyArray<Filter>;
  onAdd: (filter: Filter) => void;
  currentUserID: string;
  customFields: ReadonlyArray<CustomFieldDef>;
}) {
  const activeCustomFields = useMemo(() => customFields.filter((f) => f.active), [customFields]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="filter-add"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border px-2 text-xs text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-3 w-3" /> Filter
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Filter by</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {FIELD_DEFS.map((def) => {
          const Icon = def.icon;
          return (
            <DropdownMenuItem
              key={def.field}
              data-testid={`filter-add-${def.field}`}
              onSelect={() => onAdd(defaultFilterFor(def.field, existing, currentUserID))}
            >
              <Icon className="h-3.5 w-3.5 text-fg-tertiary" />
              {def.label}
            </DropdownMenuItem>
          );
        })}
        {activeCustomFields.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Custom fields</DropdownMenuLabel>
            <div className="max-h-64 overflow-y-auto">
              {activeCustomFields.map((cf) => (
                <DropdownMenuItem
                  key={cf.id}
                  data-testid={`filter-add-customField-${cf.key}`}
                  onSelect={() => onAdd(defaultCustomFieldFilter(cf))}
                >
                  <Sparkles className="h-3.5 w-3.5 text-fg-tertiary" />
                  <span className="truncate">{cf.displayName}</span>
                  <span className="ml-auto text-[10px] uppercase text-fg-tertiary">
                    {customFieldTypeShort(cf.type)}
                  </span>
                </DropdownMenuItem>
              ))}
            </div>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function customFieldTypeShort(type: CustomFieldDef['type']): string {
  switch (type) {
    case 'multi_select':
      return 'multi';
    case 'dynamic_list':
      return 'list';
    case 'dynamic_multi_select':
      return 'multi';
    default:
      return type;
  }
}

function defaultFilterFor(
  field: FilterField,
  existing: ReadonlyArray<Filter>,
  currentUserID: string,
): Filter {
  // If a chip for this field already exists, we still allow another (caller
  // may want OR-of-same-field) — but for v1 status / priority chips merge
  // with the existing one when present.
  const existingForField = existing.find((f) => f.field === field);
  if (field === 'status') {
    if (existingForField && 'values' in existingForField && existingForField.operator === 'in')
      return existingForField;
    return { field: 'status', operator: 'in', values: ['open', 'in_progress'] };
  }
  if (field === 'priority') {
    if (existingForField && 'values' in existingForField && existingForField.operator === 'in')
      return existingForField;
    return { field: 'priority', operator: 'in', values: ['high', 'urgent'] };
  }
  if (field === 'assignee') {
    return { field: 'assignee', operator: 'eq', value: currentUserID };
  }
  // tag
  return { field: 'tag', operator: 'includesAny', values: [] };
}

// ---------- Per-field chips ----------

function FilterChip({
  filter,
  onChange,
  onRemove,
  currentUserID,
  membersEnabled,
  tagsEnabled,
}: {
  filter: Filter;
  onChange: (next: Filter) => void;
  onRemove: () => void;
  currentUserID: string;
  membersEnabled: boolean;
  tagsEnabled: boolean;
}) {
  if (filter.field === 'status') {
    return (
      <MultiSelectChip
        testid="filter-chip-status"
        icon={CheckCircle2}
        label="Status"
        selected={asArray((filter as { values?: ReadonlyArray<string | number> }).values)}
        options={STATUS_OPTIONS as ReadonlyArray<{ value: string; label: string }>}
        onChange={(values) => onChange({ field: 'status', operator: 'in', values })}
        onRemove={onRemove}
      />
    );
  }
  if (filter.field === 'priority') {
    return (
      <MultiSelectChip
        testid="filter-chip-priority"
        icon={AlertTriangle}
        label="Priority"
        selected={asArray((filter as { values?: ReadonlyArray<string | number> }).values)}
        options={PRIORITY_OPTIONS as ReadonlyArray<{ value: string; label: string }>}
        onChange={(values) => onChange({ field: 'priority', operator: 'in', values })}
        onRemove={onRemove}
      />
    );
  }
  if (filter.field === 'assignee') {
    return (
      <AssigneeChip
        filter={filter}
        onChange={onChange}
        onRemove={onRemove}
        currentUserID={currentUserID}
        enabled={membersEnabled}
      />
    );
  }
  if (filter.field === 'tag') {
    return (
      <TagChip filter={filter} onChange={onChange} onRemove={onRemove} enabled={tagsEnabled} />
    );
  }
  return null;
}

function asArray(values: ReadonlyArray<string | number> | undefined): string[] {
  if (!values) return [];
  return values.map((v) => String(v));
}

// ---------- Multi-select chip (status, priority) ----------

function MultiSelectChip({
  testid,
  icon: Icon,
  label,
  selected,
  options,
  onChange,
  onRemove,
}: {
  testid: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  selected: string[];
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (values: string[]) => void;
  onRemove: () => void;
}) {
  const valueDisplay =
    selected.length === 0
      ? 'any'
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length} selected`;

  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-md border border-border bg-bg-elevated text-xs">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid={testid}
            className="inline-flex items-center gap-1.5 px-2 text-fg-primary hover:bg-bg-elevated-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon className="h-3 w-3 text-fg-tertiary" />
            <span className="text-fg-tertiary">{label}:</span>
            <span className="font-medium">{valueDisplay}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuLabel>{label} is any of</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {options.map((opt) => (
            <DropdownMenuCheckboxItem
              key={opt.value}
              checked={selected.includes(opt.value)}
              onCheckedChange={(checked) => {
                const next = checked
                  ? [...selected, opt.value]
                  : selected.filter((v) => v !== opt.value);
                onChange(next);
              }}
              onSelect={(e) => e.preventDefault()}
            >
              {opt.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label={`Remove ${label} filter`}
        data-testid={`${testid}-remove`}
        onClick={onRemove}
        className="border-l border-border px-1.5 text-fg-tertiary transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ---------- Assignee chip ----------

function AssigneeChip({
  filter,
  onChange,
  onRemove,
  currentUserID,
  enabled,
}: {
  filter: Filter;
  onChange: (next: Filter) => void;
  onRemove: () => void;
  currentUserID: string;
  enabled: boolean;
}) {
  const [members] = useQuery(
    queries.workspaceMembers(),
    enabled ? CACHE_FOREVER : { ttl: 0 },
  ) as unknown as [
    ReadonlyArray<{ userId: string; user?: { id: string; name?: string; email: string } }>,
    unknown,
  ];

  const memberByID = useMemo(() => {
    const map = new Map<string, { id: string; name?: string; email: string }>();
    for (const m of members ?? []) {
      if (m.user) map.set(m.user.id, m.user);
    }
    return map;
  }, [members]);

  const valueDisplay = useMemo(() => {
    if (filter.operator === 'empty') return 'Unassigned';
    if (filter.operator === 'eq') {
      const value = (filter as { value: string }).value;
      if (value === currentUserID) return 'Me';
      const member = memberByID.get(value);
      return member?.name ?? member?.email?.split('@')[0] ?? 'someone';
    }
    return 'any';
  }, [filter, memberByID, currentUserID]);

  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-md border border-border bg-bg-elevated text-xs">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="filter-chip-assignee"
            className="inline-flex items-center gap-1.5 px-2 text-fg-primary hover:bg-bg-elevated-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <UserRound className="h-3 w-3 text-fg-tertiary" />
            <span className="text-fg-tertiary">Assignee:</span>
            <span className="font-medium">{valueDisplay}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Assigned to</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid="filter-chip-assignee-me"
            onSelect={() => onChange({ field: 'assignee', operator: 'eq', value: currentUserID })}
          >
            <Avatar className="h-4 w-4">
              <AvatarFallback className="text-[9px]">Me</AvatarFallback>
            </Avatar>
            Me
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="filter-chip-assignee-unassigned"
            onSelect={() => onChange({ field: 'assignee', operator: 'empty' })}
          >
            <UserRound className="h-4 w-4 text-fg-tertiary" />
            Unassigned
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Teammates</DropdownMenuLabel>
          {Array.from(memberByID.values())
            .filter((m) => m.id !== currentUserID)
            .slice(0, 50)
            .map((m) => (
              <DropdownMenuItem
                key={m.id}
                onSelect={() => onChange({ field: 'assignee', operator: 'eq', value: m.id })}
              >
                <Avatar className="h-4 w-4">
                  <AvatarFallback className="text-[9px]">
                    {initialsFromName(m.name ?? m.email)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{m.name ?? m.email}</span>
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label="Remove Assignee filter"
        data-testid="filter-chip-assignee-remove"
        onClick={onRemove}
        className="border-l border-border px-1.5 text-fg-tertiary transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ---------- Tag chip ----------

function TagChip({
  filter,
  onChange,
  onRemove,
  enabled,
}: {
  filter: Filter;
  onChange: (next: Filter) => void;
  onRemove: () => void;
  enabled: boolean;
}) {
  const [tags] = useQuery(queries.tags(), enabled ? CACHE_FOREVER : { ttl: 0 }) as unknown as [
    ReadonlyArray<{ id: string; label: string; color?: string | null }>,
    unknown,
  ];

  const selected = asArray((filter as { values?: ReadonlyArray<string | number> }).values);
  const selectedLabels = selected
    .map((id) => (tags ?? []).find((t) => t.id === id)?.label)
    .filter(Boolean) as string[];
  const display =
    selected.length === 0
      ? 'any'
      : selected.length === 1
        ? (selectedLabels[0] ?? selected[0])
        : `${selected.length} tags`;

  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-md border border-border bg-bg-elevated text-xs">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="filter-chip-tag"
            className="inline-flex items-center gap-1.5 px-2 text-fg-primary hover:bg-bg-elevated-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <TagIcon className="h-3 w-3 text-fg-tertiary" />
            <span className="text-fg-tertiary">Tag:</span>
            <span className="font-medium">{display}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Tag includes any</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(tags ?? []).slice(0, 80).map((t) => (
            <DropdownMenuCheckboxItem
              key={t.id}
              checked={selected.includes(t.id)}
              onCheckedChange={(checked) => {
                const next = checked ? [...selected, t.id] : selected.filter((v) => v !== t.id);
                onChange({ field: 'tag', operator: 'includesAny', values: next });
              }}
              onSelect={(e) => e.preventDefault()}
            >
              <span
                className={cn('h-2 w-2 rounded-full', t.color ? '' : 'bg-fg-tertiary')}
                style={t.color ? { backgroundColor: t.color } : undefined}
                aria-hidden
              />
              {t.label}
            </DropdownMenuCheckboxItem>
          ))}
          {(!tags || tags.length === 0) && (
            <div className="px-2 py-1.5 text-xs text-fg-tertiary">No tags yet</div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label="Remove Tag filter"
        data-testid="filter-chip-tag-remove"
        onClick={onRemove}
        className="border-l border-border px-1.5 text-fg-tertiary transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// Re-export so the test can locate the chip type easily.
export { FilterIcon };
