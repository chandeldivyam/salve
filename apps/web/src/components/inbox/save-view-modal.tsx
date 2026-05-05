// Phase 40 — save-view modal.
//
// Triggered by the [+] in `<InboxViewStrip>`, the drift banner's
// "Save as new view" button, or `Alt+V`. Captures the current effective
// view (baseline merged with chip-filter overrides) as a new saved view.
//
// Auto-name comes from chip filters first; if none, suggests "Copy of
// <active view>". A read-only chip preview shows what's being saved.

import { useQuery } from '@rocicorp/zero/react';
import { mutators } from '@salve/mutators';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@salve/ui';
import type {
  CustomField as CustomFieldDef,
  Filter,
  ViewQuery,
  ViewSort,
} from '@salve/zero-schema';
import { queries } from '@salve/zero-schema';
import { useNavigate } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, Sparkles, Tag as TagIcon, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useZero } from '@/lib/zero';
import { CACHE_FOREVER } from '@/lib/zero-cache';

interface SaveViewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The merged effective query (baseline + chip overrides). Saved as-is. */
  baseQuery: ViewQuery;
  baseSort: ViewSort;
  baseGroupBy: string | null;
  /** Live chip filters (drift from baseline). Used for the auto-name. */
  driftFilters: ReadonlyArray<Filter>;
  /** Active view label so we can suggest "Copy of …" when there's no drift. */
  activeViewLabel: string;
  /**
   * Edit mode: when present, the modal updates the existing view instead of
   * creating a new one. Filters / sort / groupBy come from the live state
   * just like the create flow — that's deliberate, edit means "save what
   * I'm looking at right now to this view".
   */
  editing?: {
    id: string;
    label: string;
    scope: 'workspace' | 'personal';
  } | null;
}

type Scope = 'workspace' | 'personal';

export function SaveViewModal({
  open,
  onOpenChange,
  baseQuery,
  baseSort,
  baseGroupBy,
  driftFilters,
  activeViewLabel,
  editing,
}: SaveViewModalProps) {
  const isEdit = !!editing;
  const z = useZero();
  const navigate = useNavigate();

  // Subscribe once at the modal level so both the auto-name and the
  // filters preview share the same custom-field-key→displayName map.
  const [customFields] = useQuery(
    queries.customFieldsByCategory({ category: 'ticket' }),
    CACHE_FOREVER,
  ) as unknown as [ReadonlyArray<CustomFieldDef>, unknown];
  const cfByKey = useMemo(() => {
    const map = new Map<string, CustomFieldDef>();
    for (const f of customFields ?? []) map.set(f.key, f);
    return map;
  }, [customFields]);

  const suggested = useMemo(() => {
    if (driftFilters.length > 0) return suggestViewName(driftFilters, cfByKey);
    return `Copy of ${activeViewLabel}`;
  }, [driftFilters, activeViewLabel, cfByKey]);

  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<Scope>('personal');
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setLabel(editing ? editing.label : suggested);
      setScope(editing ? editing.scope : 'personal');
      setTouched(false);
      setSubmitting(false);
    }
  }, [open, suggested, editing]);

  const trimmed = label.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      if (editing) {
        // Edit mode: update the existing view in place. Scope changes are
        // not exposed in v1 (would require a re-permission check); we keep
        // the original scope. Filters / sort / groupBy reflect the live
        // state — saving means "lock in what I'm looking at".
        await z.mutate(
          mutators.view.update({
            id: editing.id,
            label: trimmed,
            query: baseQuery,
            sort: baseSort,
            groupBy: baseGroupBy,
          }),
        );
        onOpenChange(false);
        // Stay on the view we just saved; URL chip filters become the new
        // baseline so we drop the `f` param.
        navigate({ to: '/app/inbox', search: { view: editing.id } });
      } else {
        const id = crypto.randomUUID();
        await z.mutate(
          mutators.view.create({
            id,
            scope,
            label: trimmed,
            query: baseQuery,
            sort: baseSort,
            groupBy: baseGroupBy,
          }),
        );
        onOpenChange(false);
        // Drop chip filters from URL — the saved view *is* the new baseline.
        navigate({ to: '/app/inbox', search: { view: id } });
      }
    } catch (err) {
      console.error(editing ? 'view.update failed' : 'view.create failed', err);
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Override the Dialog default width (`min(100vw-2rem, 36rem)`) with an
          explicit narrow card. The bang on `!w-[420px]` wins the tw-merge
          conflict against the base `w-[min(...)]` from the Dialog primitive. */}
      <DialogContent className="!w-[420px] !max-w-[calc(100vw-2rem)] gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-[15px]">{isEdit ? 'Edit view' : 'Save view'}</DialogTitle>
          <DialogDescription className="text-xs">
            {isEdit
              ? 'Update the name and lock in the current filters.'
              : 'Saved views appear in your inbox tab strip.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-3 px-5 pb-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="view-label" className="text-xs font-medium text-fg-secondary">
              Name
            </label>
            <Input
              id="view-label"
              autoFocus
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                setTouched(true);
              }}
              placeholder="Untitled view"
              maxLength={120}
              data-testid="save-view-label"
              className="h-9 text-sm"
            />
            {touched && trimmed.length === 0 ? (
              <p className="text-[11px] text-destructive">Name is required.</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-secondary">Filters</span>
            <FilterPreview filters={baseQuery.filters} cfByKey={cfByKey} />
          </div>

          {isEdit ? null : (
            <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Visibility">
              <span className="text-xs font-medium text-fg-secondary">Visibility</span>
              <div className="grid grid-cols-2 gap-1.5">
                <ScopeOption
                  checked={scope === 'personal'}
                  onSelect={() => setScope('personal')}
                  title="Personal"
                  subtitle="Only you"
                  testid="save-view-scope-personal"
                />
                <ScopeOption
                  checked={scope === 'workspace'}
                  onSelect={() => setScope('workspace')}
                  title="Workspace"
                  subtitle="Everyone"
                  testid="save-view-scope-workspace"
                />
              </div>
            </div>
          )}

          <DialogFooter className="!flex-row !justify-end mt-1 gap-2 border-t border-border pt-3 px-0 pb-0">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit} data-testid="save-view-submit">
              {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Save view'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ScopeOption({
  checked,
  onSelect,
  title,
  subtitle,
  testid,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
  testid: string;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      data-checked={checked}
      onClick={onSelect}
      className={cn(
        'flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        checked
          ? 'border-ring bg-bg-elevated ring-1 ring-ring/30'
          : 'border-border hover:border-border-strong hover:bg-bg-elevated',
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] font-medium leading-tight text-fg-primary">{title}</span>
        <span className="text-[11px] leading-tight text-fg-tertiary">{subtitle}</span>
      </span>
      <span
        className={cn(
          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
          checked ? 'border-ring bg-ring' : 'border-border',
        )}
        aria-hidden
      >
        {checked ? <span className="h-1.5 w-1.5 rounded-full bg-bg-elevated" /> : null}
      </span>
    </button>
  );
}

function FilterPreview({
  filters,
  cfByKey,
}: {
  filters: ReadonlyArray<Filter>;
  cfByKey: Map<string, CustomFieldDef>;
}) {
  if (filters.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-2.5 py-1.5 text-[11px] text-fg-tertiary">
        No filters — this view will show every ticket in your workspace.
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1 rounded-md border border-border bg-bg-subtle/40 px-1.5 py-1.5">
      {filters.map((f, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: filters render once per modal-open
          key={`${f.field}-${i}`}
          className="inline-flex items-center gap-1 rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-[11px] text-fg-primary"
        >
          {chipIconFor(f.field)}
          {describeFilterShort(f, cfByKey)}
        </span>
      ))}
    </div>
  );
}

function chipIconFor(field: string) {
  if (field === 'status') return <CheckCircle2 className="h-3 w-3 text-fg-tertiary" />;
  if (field === 'priority') return <AlertTriangle className="h-3 w-3 text-fg-tertiary" />;
  if (field === 'assignee') return <UserRound className="h-3 w-3 text-fg-tertiary" />;
  if (field === 'tag') return <TagIcon className="h-3 w-3 text-fg-tertiary" />;
  if (field.startsWith('customField:')) return <Sparkles className="h-3 w-3 text-fg-tertiary" />;
  return null;
}

function describeFilterShort(filter: Filter, cfByKey?: Map<string, CustomFieldDef>): string {
  const head = humanizeField(filter.field, cfByKey);
  switch (filter.operator) {
    case 'eq':
    case 'neq':
      return `${head}: ${String(filter.value)}`;
    case 'in':
    case 'includesAny':
      return filter.values.length === 1
        ? `${head}: ${String(filter.values[0])}`
        : `${head} (${filter.values.length})`;
    case 'nin':
    case 'includesNone':
      return `${head} ≠ ${filter.values.length}`;
    case 'includesAll':
      return `${head} ∋ ${filter.values.length}`;
    case 'contains':
      return `${head} ⊃ "${filter.value}"`;
    case 'before':
      return `${head} <`;
    case 'after':
      return `${head} >`;
    case 'between':
      return `${head} ↔`;
    case 'inLast':
      return `${head}: last ${filter.value.n}${filter.value.unit[0]}`;
    case 'notInLast':
      return `${head}: not last ${filter.value.n}${filter.value.unit[0]}`;
    case 'empty':
      return head === 'Assignee' ? 'Unassigned' : `${head}: empty`;
    case 'nempty':
      return `${head}: any`;
    default:
      return head;
  }
}

/**
 * Auto-name from active chip filters. `cfByKey` lets us substitute custom
 * field display names; without it the auto-name falls back to the field key.
 */
export function suggestViewName(
  filters: ReadonlyArray<Filter>,
  cfByKey?: Map<string, CustomFieldDef>,
): string {
  const parts: string[] = [];
  for (const f of filters) {
    const segment = describeFilterShort(f, cfByKey);
    if (segment) parts.push(segment);
  }
  if (parts.length === 0) return 'New view';
  return parts.slice(0, 3).join(' · ');
}

function humanizeField(field: string, cfByKey?: Map<string, CustomFieldDef>): string {
  if (field.startsWith('customField:')) {
    const key = field.slice('customField:'.length);
    return cfByKey?.get(key)?.displayName ?? key;
  }
  switch (field) {
    case 'status':
      return 'Status';
    case 'priority':
      return 'Priority';
    case 'channel':
      return 'Channel';
    case 'mailbox':
      return 'Mailbox';
    case 'assignee':
      return 'Assignee';
    case 'tag':
      return 'Tag';
    case 'customer':
      return 'Customer';
    case 'createdAt':
      return 'Created';
    case 'updatedAt':
      return 'Updated';
    case 'firstResponseAt':
      return 'First response';
    case 'resolvedAt':
      return 'Resolved';
    default:
      return field;
  }
}
