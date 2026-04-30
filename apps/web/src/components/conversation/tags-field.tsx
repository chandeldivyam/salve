import { Button, cn, Input, Tooltip, TooltipContent, TooltipTrigger } from '@opendesk/ui';
import { useQuery } from '@rocicorp/zero/react';
import { Check, Plus, Search, Tag, X } from 'lucide-react';
import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import {
  rowsAs,
  sortedTagsFromRelations,
  supportMetadataMutators,
  supportMetadataQueries,
  type TagRow,
  tagPillStyle,
} from '@/lib/support-metadata';
import { useZero } from '@/lib/zero';

interface TagsFieldProps {
  ticketID: string;
  ticket?: unknown;
}

export function TagsField({ ticketID, ticket }: TagsFieldProps) {
  const z = useZero();
  const [rawTags] = useQuery(supportMetadataQueries.tags());
  const tags = rowsAs<TagRow>(rawTags).filter((tag) => !tag.archivedAt);
  const currentTags = sortedTagsFromRelations(objectValue(ticket, 'tags'));
  const currentIDs = useMemo(() => new Set(currentTags.map((tag) => tag.id)), [currentTags]);
  const availableTags = tags.filter((tag) => !currentIDs.has(tag.id));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const next = q
      ? availableTags.filter((tag) => tag.label.toLowerCase().includes(q))
      : availableTags;
    return next.sort((a, b) => {
      const groupA = a.group?.label ?? '';
      const groupB = b.group?.label ?? '';
      return (
        groupA.localeCompare(groupB) || a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)
      );
    });
  }, [availableTags, query]);

  const exactMatch = tags.some((tag) => tag.label.toLowerCase() === query.trim().toLowerCase());
  const canCreate = query.trim().length > 0 && !exactMatch;

  async function attach(tagID: string) {
    setError(null);
    await z.mutate(supportMetadataMutators.tag.attachToTicket({ ticketID, tagID }));
    setQuery('');
    setOpen(false);
  }

  async function remove(tagID: string) {
    setError(null);
    await z.mutate(supportMetadataMutators.tag.detachFromTicket({ ticketID, tagID }));
  }

  async function createAndAttach() {
    const label = query.trim();
    if (!label) {
      setError('Tag label is required.');
      return;
    }
    const id = crypto.randomUUID();
    await z.mutate(
      supportMetadataMutators.tag.create({
        id,
        label,
        groupID: null,
        color: null,
        sortOrder: tags.length + 1,
      }),
    );
    await attach(id);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const first = filtered[0];
      if (first) void attach(first.id);
      else if (canCreate) void createAndAttach();
      return;
    }
    if (event.key === 'Backspace' && query.length === 0 && currentTags.length > 0) {
      const last = currentTags[currentTags.length - 1];
      if (last) void remove(last.id);
    }
  }

  return (
    <section className="relative flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <Tag className="h-3.5 w-3.5" />
        Tags
      </span>
      {currentTags.map((tag) => (
        <span
          key={tag.id}
          className="group/tag inline-flex h-6 max-w-40 items-center gap-1 rounded-full border px-2 text-[11px] font-medium"
          style={tagPillStyle(tag)}
          title={tag.group?.label ?? undefined}
        >
          <span className="truncate">{tag.label}</span>
          <button
            type="button"
            aria-label={`Remove ${tag.label}`}
            onClick={() => remove(tag.id)}
            className="grid h-3.5 w-3.5 place-items-center rounded-full opacity-60 hover:bg-surface hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        onClick={() => {
          setOpen((next) => !next);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        <Plus className="h-3 w-3" />
        Tag
      </Button>

      {open ? (
        <div className="absolute left-0 top-8 z-40 w-[320px] rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setError(null);
              }}
              onKeyDown={onInputKeyDown}
              placeholder="Search or create tag"
              className="h-8 pl-7 text-xs"
              aria-invalid={Boolean(error)}
            />
          </div>
          {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
          <div className="mt-2 max-h-64 overflow-y-auto">
            {filtered.length === 0 && !canCreate ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">No available tags.</p>
            ) : null}
            {groupTags(filtered).map(([groupLabel, groupTags]) => (
              <div key={groupLabel} className="py-1">
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {groupLabel}
                </p>
                {groupTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => attach(tag.id)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-brand-soft hover:text-brand-soft-foreground"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full border"
                      style={tagPillStyle(tag)}
                    />
                    <span className="min-w-0 flex-1 truncate">{tag.label}</span>
                    <Check
                      className={cn(
                        'h-3.5 w-3.5',
                        currentIDs.has(tag.id) ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </button>
                ))}
              </div>
            ))}
            {canCreate ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={createAndAttach}
                    className="mt-1 flex w-full items-center gap-2 rounded-sm border border-dashed border-border px-2 py-1.5 text-left text-xs text-foreground hover:bg-surface-muted"
                  >
                    <Plus className="h-3.5 w-3.5 text-brand-600" />
                    Create "{query.trim()}"
                  </button>
                </TooltipTrigger>
                <TooltipContent>Create and attach this tag</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function groupTags(tags: TagRow[]) {
  const groups = new Map<string, TagRow[]>();
  for (const tag of tags) {
    const label = tag.group?.label ?? 'Ungrouped';
    groups.set(label, [...(groups.get(label) ?? []), tag]);
  }
  return [...groups.entries()];
}

function objectValue(source: unknown, key: string) {
  if (!source || typeof source !== 'object') return undefined;
  return (source as Record<string, unknown>)[key];
}
