// /app/settings/tags — single-column groups with inline tags and add-rows.
// Group + tag creation use a side sheet (tier B). Renames auto-save on blur.
// Color and group changes happen via the row's menu → edit sheet.

import { useQuery } from '@rocicorp/zero/react';
import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  FieldError,
  FieldLabel,
  Input,
} from '@salve/ui';
import { createFileRoute } from '@tanstack/react-router';
import { Archive, ChevronDown, MoreHorizontal, Plus, RotateCcw, Tags } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { RouteErrorFeedback, RoutePendingFeedback } from '@/components/route-feedback';
import {
  EmptyState,
  ListSection,
  SettingsBody,
  SettingsHeader,
  SettingsSheet,
} from '@/components/settings';
import {
  isHexColor,
  normalizeHexColor,
  rowsAs,
  supportMetadataMutators,
  supportMetadataQueries,
  type TagGroupRow,
  type TagRow,
  tagPillStyle,
} from '@/lib/support-metadata';
import { useZero } from '@/lib/zero';
import { CACHE_NAV } from '@/lib/zero-cache';

export const Route = createFileRoute('/app/settings/tags')({
  component: TagsSettingsPage,
  pendingComponent: RoutePendingFeedback,
  errorComponent: RouteErrorFeedback,
});

type SheetState =
  | { kind: 'closed' }
  | { kind: 'create-group' }
  | { kind: 'edit-group'; group: TagGroupRow }
  | { kind: 'create-tag'; groupID: string | null }
  | { kind: 'edit-tag'; tag: TagRow };

function TagsSettingsPage() {
  const [rawGroups] = useQuery(supportMetadataQueries.tagGroupsForSettings(), CACHE_NAV);
  const [rawTags] = useQuery(supportMetadataQueries.tagsForSettings(), CACHE_NAV);
  const allGroups = useMemo(
    () =>
      [...rowsAs<TagGroupRow>(rawGroups)].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
      ),
    [rawGroups],
  );
  const allTags = useMemo(
    () =>
      [...rowsAs<TagRow>(rawTags)].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
      ),
    [rawTags],
  );
  const groups = useMemo(() => allGroups.filter((group) => !group.archivedAt), [allGroups]);
  const archivedGroups = useMemo(() => allGroups.filter((group) => group.archivedAt), [allGroups]);
  const tags = useMemo(() => allTags.filter((tag) => !tag.archivedAt), [allTags]);
  const archivedTags = useMemo(() => allTags.filter((tag) => tag.archivedAt), [allTags]);
  const activeGroupIDs = useMemo(() => new Set(groups.map((group) => group.id)), [groups]);

  const [sheet, setSheet] = useState<SheetState>({ kind: 'closed' });
  const [showArchived, setShowArchived] = useState(false);

  const tagsByGroup = useMemo(() => {
    const map = new Map<string, TagRow[]>();
    for (const tag of tags) {
      const id = tag.groupID && activeGroupIDs.has(tag.groupID) ? tag.groupID : 'ungrouped';
      map.set(id, [...(map.get(id) ?? []), tag]);
    }
    return map;
  }, [activeGroupIDs, tags]);

  const empty = groups.length === 0 && tags.length === 0;

  return (
    <>
      <SettingsHeader
        title="Tags"
        description="Organize tickets with grouped labels that agents can apply from the conversation view."
        actions={
          <>
            {archivedGroups.length + archivedTags.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowArchived((s) => !s)}
                className="h-8"
              >
                {showArchived
                  ? 'Hide archived'
                  : `Show archived (${archivedGroups.length + archivedTags.length})`}
              </Button>
            ) : null}
            <Button size="sm" onClick={() => setSheet({ kind: 'create-group' })} className="h-8">
              <Plus className="h-3.5 w-3.5" />
              New group
            </Button>
          </>
        }
      />
      <SettingsBody>
        <div className="flex flex-col gap-4">
          {empty ? (
            <EmptyState
              icon={Tags}
              title="No tags"
              description="Tag tickets so agents can filter the inbox and macros can target work."
              action={
                <Button size="sm" onClick={() => setSheet({ kind: 'create-group' })}>
                  <Plus className="h-3.5 w-3.5" />
                  New tag group
                </Button>
              }
            />
          ) : null}

          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              tags={tagsByGroup.get(group.id) ?? []}
              onAddTag={() => setSheet({ kind: 'create-tag', groupID: group.id })}
              onEditGroup={() => setSheet({ kind: 'edit-group', group })}
              onEditTag={(tag) => setSheet({ kind: 'edit-tag', tag })}
            />
          ))}

          {(tagsByGroup.get('ungrouped') ?? []).length > 0 ? (
            <UngroupedCard
              tags={tagsByGroup.get('ungrouped') ?? []}
              onAddTag={() => setSheet({ kind: 'create-tag', groupID: null })}
              onEditTag={(tag) => setSheet({ kind: 'edit-tag', tag })}
            />
          ) : null}

          {showArchived && (archivedGroups.length > 0 || archivedTags.length > 0) ? (
            <ArchivedSection groups={archivedGroups} tags={archivedTags} />
          ) : null}
        </div>
      </SettingsBody>

      <CreateGroupSheet
        open={sheet.kind === 'create-group'}
        onClose={() => setSheet({ kind: 'closed' })}
        existingCount={groups.length}
      />
      <EditGroupSheet
        open={sheet.kind === 'edit-group'}
        group={sheet.kind === 'edit-group' ? sheet.group : null}
        onClose={() => setSheet({ kind: 'closed' })}
      />
      <CreateTagSheet
        open={sheet.kind === 'create-tag'}
        groups={groups}
        defaultGroupID={sheet.kind === 'create-tag' ? sheet.groupID : null}
        existingCount={tags.length}
        onClose={() => setSheet({ kind: 'closed' })}
      />
      <EditTagSheet
        open={sheet.kind === 'edit-tag'}
        tag={sheet.kind === 'edit-tag' ? sheet.tag : null}
        groups={groups}
        onClose={() => setSheet({ kind: 'closed' })}
      />
    </>
  );
}

function GroupCard({
  group,
  tags,
  onAddTag,
  onEditGroup,
  onEditTag,
}: {
  group: TagGroupRow;
  tags: TagRow[];
  onAddTag: () => void;
  onEditGroup: () => void;
  onEditTag: (tag: TagRow) => void;
}) {
  const z = useZero();
  return (
    <section className="flex flex-col">
      <header className="flex h-7 items-center gap-2 px-1 pb-1">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: normalizeHexColor(group.color) }}
        />
        <h3 className="contents">
          <InlineLabel
            value={group.label}
            onSave={async (label) => {
              if (!label.trim() || label === group.label) return;
              await z.mutate(
                supportMetadataMutators.tagGroup.update({
                  id: group.id,
                  label: label.trim(),
                  color: group.color,
                  sortOrder: group.sortOrder,
                }),
              );
            }}
          />
        </h3>
        <span className="ml-auto tabular-nums text-[11px] text-fg-quaternary">{tags.length}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Group actions"
              className="grid h-6 w-6 place-items-center rounded-md text-fg-tertiary hover:bg-bg-elevated/60 hover:text-fg-primary"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEditGroup}>Edit group…</DropdownMenuItem>
            <DropdownMenuItem onSelect={onAddTag}>
              <Plus className="h-3.5 w-3.5" />
              Add tag
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => z.mutate(supportMetadataMutators.tagGroup.archive({ id: group.id }))}
            >
              <Archive className="h-3.5 w-3.5" />
              Archive group
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div className="flex flex-col">
        {tags.map((tag) => (
          <TagRowItem key={tag.id} tag={tag} onEdit={() => onEditTag(tag)} />
        ))}
        <button
          type="button"
          onClick={onAddTag}
          className="flex h-8 items-center gap-2 rounded-md px-2 text-[12px] text-fg-tertiary transition-colors hover:bg-bg-elevated/40 hover:text-fg-primary"
        >
          <Plus className="h-3.5 w-3.5" />
          Add tag
        </button>
      </div>
    </section>
  );
}

function UngroupedCard({
  tags,
  onAddTag,
  onEditTag,
}: {
  tags: TagRow[];
  onAddTag: () => void;
  onEditTag: (tag: TagRow) => void;
}) {
  return (
    <ListSection title="Ungrouped" count={tags.length}>
      {tags.map((tag) => (
        <TagRowItem key={tag.id} tag={tag} onEdit={() => onEditTag(tag)} />
      ))}
      <button
        type="button"
        onClick={onAddTag}
        className="flex h-8 items-center gap-2 rounded-md px-2 text-[12px] text-fg-tertiary transition-colors hover:bg-bg-elevated/40 hover:text-fg-primary"
      >
        <Plus className="h-3.5 w-3.5" />
        Add tag
      </button>
    </ListSection>
  );
}

function TagRowItem({ tag, onEdit }: { tag: TagRow; onEdit: () => void }) {
  const z = useZero();
  return (
    <div className="group/row flex h-8 items-center gap-2 rounded-md px-2 transition-colors hover:bg-bg-elevated/40">
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex max-w-[60%] items-center"
        aria-label={`Edit ${tag.label}`}
      >
        <span
          className="truncate rounded-full border px-2 py-0.5 text-[11px] font-medium"
          style={tagPillStyle(tag)}
        >
          {tag.label}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Tag actions"
            className="ml-auto grid h-6 w-6 place-items-center rounded-md text-fg-tertiary hover:bg-bg-elevated/60 hover:text-fg-primary"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>Edit tag…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => z.mutate(supportMetadataMutators.tag.archive({ id: tag.id }))}
          >
            <Archive className="h-3.5 w-3.5" />
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function InlineLabel({
  value,
  onSave,
  compact = false,
}: {
  value: string;
  onSave: (next: string) => Promise<void>;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(
          'min-w-0 truncate rounded-sm px-1 text-left text-[13px] text-fg-primary hover:bg-bg-elevated/60',
          compact && 'text-[12px] text-fg-tertiary',
        )}
      >
        {value}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={async () => {
        setEditing(false);
        await onSave(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          inputRef.current?.blur();
        } else if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      className={cn(
        'min-w-0 flex-1 rounded-sm bg-bg-elevated px-1 text-[13px] text-fg-primary outline-none ring-1 ring-line-default',
        compact && 'text-[12px]',
      )}
    />
  );
}

function CreateGroupSheet({
  open,
  onClose,
  existingCount,
}: {
  open: boolean;
  onClose: () => void;
  existingCount: number;
}) {
  const z = useZero();
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('#0f766e');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setLabel('');
      setColor('#0f766e');
      setError(null);
    }
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!label.trim()) {
      setError('Label is required.');
      return;
    }
    if (!isHexColor(color)) {
      setError('Use a hex color like #0f766e.');
      return;
    }
    await z.mutate(
      supportMetadataMutators.tagGroup.create({
        id: crypto.randomUUID(),
        label: label.trim(),
        color,
        sortOrder: existingCount + 1,
      }),
    );
    onClose();
  }

  return (
    <SettingsSheet
      open={open}
      onOpenChange={(next) => (next ? null : onClose())}
      title="New tag group"
      description="Groups let agents see related tags together when filtering tickets."
      footer={
        <>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form="create-group-form">
            Create group
          </Button>
        </>
      }
    >
      <form id="create-group-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
        <Field hasError={Boolean(error?.toLowerCase().includes('label'))}>
          <FieldLabel>Label</FieldLabel>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Billing"
            autoFocus
          />
          <FieldError>{error?.toLowerCase().includes('label') ? error : null}</FieldError>
        </Field>
        <Field>
          <FieldLabel>Color</FieldLabel>
          <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-8 w-11 rounded-md border border-line-default bg-surface p-1"
              aria-label="Group color"
            />
            <Input value={color} onChange={(e) => setColor(e.target.value)} className="font-mono" />
          </div>
          <FieldError>{error && !error.toLowerCase().includes('label') ? error : null}</FieldError>
        </Field>
      </form>
    </SettingsSheet>
  );
}

function EditGroupSheet({
  open,
  group,
  onClose,
}: {
  open: boolean;
  group: TagGroupRow | null;
  onClose: () => void;
}) {
  const z = useZero();
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('#0f766e');
  const [sortOrder, setSortOrder] = useState('0');

  useEffect(() => {
    if (group) {
      setLabel(group.label);
      setColor(group.color);
      setSortOrder(String(group.sortOrder));
    }
  }, [group]);

  async function save() {
    if (!group || !label.trim() || !isHexColor(color)) return;
    await z.mutate(
      supportMetadataMutators.tagGroup.update({
        id: group.id,
        label: label.trim(),
        color,
        sortOrder: Number.parseInt(sortOrder, 10) || 0,
      }),
    );
    onClose();
  }

  return (
    <SettingsSheet
      open={open}
      onOpenChange={(next) => (next ? null : onClose())}
      title="Edit tag group"
      footer={
        <>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={!label.trim() || !isHexColor(color)}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field>
          <FieldLabel>Label</FieldLabel>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel>Color</FieldLabel>
          <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-8 w-11 rounded-md border border-line-default bg-surface p-1"
            />
            <Input value={color} onChange={(e) => setColor(e.target.value)} className="font-mono" />
          </div>
        </Field>
        <Field>
          <FieldLabel>Sort order</FieldLabel>
          <Input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="w-24"
          />
        </Field>
      </div>
    </SettingsSheet>
  );
}

function CreateTagSheet({
  open,
  groups,
  defaultGroupID,
  existingCount,
  onClose,
}: {
  open: boolean;
  groups: TagGroupRow[];
  defaultGroupID: string | null;
  existingCount: number;
  onClose: () => void;
}) {
  const z = useZero();
  const [label, setLabel] = useState('');
  const [groupID, setGroupID] = useState<string | null>(defaultGroupID);
  const [color, setColor] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLabel('');
      setGroupID(defaultGroupID);
      setColor('');
      setError(null);
    }
  }, [open, defaultGroupID]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!label.trim()) {
      setError('Label is required.');
      return;
    }
    if (color && !isHexColor(color)) {
      setError('Use a hex color like #0f766e.');
      return;
    }
    await z.mutate(
      supportMetadataMutators.tag.create({
        id: crypto.randomUUID(),
        label: label.trim(),
        groupID: groupID,
        color: color.trim() || null,
        sortOrder: existingCount + 1,
      }),
    );
    onClose();
  }

  return (
    <SettingsSheet
      open={open}
      onOpenChange={(next) => (next ? null : onClose())}
      title="New tag"
      footer={
        <>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form="create-tag-form">
            Create tag
          </Button>
        </>
      }
    >
      <form id="create-tag-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
        <Field hasError={Boolean(error?.toLowerCase().includes('label'))}>
          <FieldLabel>Label</FieldLabel>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Refund"
            autoFocus
          />
          <FieldError>{error?.toLowerCase().includes('label') ? error : null}</FieldError>
        </Field>
        <Field>
          <FieldLabel>Group</FieldLabel>
          <GroupSelect groups={groups} value={groupID} onChange={setGroupID} />
        </Field>
        <Field hasError={Boolean(error && !error.toLowerCase().includes('label'))}>
          <FieldLabel>Color (optional)</FieldLabel>
          <Input
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="Inherits from group"
            className="font-mono"
          />
          <FieldError>{error && !error.toLowerCase().includes('label') ? error : null}</FieldError>
        </Field>
      </form>
    </SettingsSheet>
  );
}

function EditTagSheet({
  open,
  tag,
  groups,
  onClose,
}: {
  open: boolean;
  tag: TagRow | null;
  groups: TagGroupRow[];
  onClose: () => void;
}) {
  const z = useZero();
  const [label, setLabel] = useState('');
  const [groupID, setGroupID] = useState<string | null>(null);
  const [color, setColor] = useState('');
  const [sortOrder, setSortOrder] = useState('0');

  useEffect(() => {
    if (tag) {
      setLabel(tag.label);
      setGroupID(tag.groupID ?? null);
      setColor(tag.color ?? '');
      setSortOrder(String(tag.sortOrder));
    }
  }, [tag]);

  async function save() {
    if (!tag || !label.trim()) return;
    if (color && !isHexColor(color)) return;
    await z.mutate(
      supportMetadataMutators.tag.update({
        id: tag.id,
        label: label.trim(),
        groupID,
        color: color.trim() || null,
        sortOrder: Number.parseInt(sortOrder, 10) || 0,
      }),
    );
    onClose();
  }

  return (
    <SettingsSheet
      open={open}
      onOpenChange={(next) => (next ? null : onClose())}
      title="Edit tag"
      footer={
        <>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={!label.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field>
          <FieldLabel>Label</FieldLabel>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel>Group</FieldLabel>
          <GroupSelect groups={groups} value={groupID} onChange={setGroupID} />
        </Field>
        <Field>
          <FieldLabel>Color (optional)</FieldLabel>
          <Input
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="Inherits from group"
            className="font-mono"
          />
        </Field>
        <Field>
          <FieldLabel>Sort order</FieldLabel>
          <Input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="w-24"
          />
        </Field>
      </div>
    </SettingsSheet>
  );
}

function GroupSelect({
  groups,
  value,
  onChange,
}: {
  groups: TagGroupRow[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const selected = groups.find((g) => g.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 justify-start gap-2">
          {selected ? (
            <>
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: normalizeHexColor(selected.color) }}
              />
              {selected.label}
            </>
          ) : (
            'Ungrouped'
          )}
          <ChevronDown className="ml-auto h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => onChange(null)}>Ungrouped</DropdownMenuItem>
        <DropdownMenuSeparator />
        {groups.map((group) => (
          <DropdownMenuItem key={group.id} onSelect={() => onChange(group.id)}>
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: normalizeHexColor(group.color) }}
            />
            {group.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ArchivedSection({ groups, tags }: { groups: TagGroupRow[]; tags: TagRow[] }) {
  const z = useZero();
  return (
    <ListSection title="Archived" count={groups.length + tags.length}>
      {groups.map((group) => (
        <div
          key={group.id}
          className="flex h-8 items-center gap-2 rounded-md px-2 transition-colors hover:bg-bg-elevated/40"
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: normalizeHexColor(group.color) }}
          />
          <span className="truncate text-[13px] text-fg-secondary">{group.label}</span>
          <Badge variant="muted" className="ml-1">
            Group
          </Badge>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7"
            onClick={() => z.mutate(supportMetadataMutators.tagGroup.restore({ id: group.id }))}
          >
            <RotateCcw className="h-3 w-3" />
            Restore
          </Button>
        </div>
      ))}
      {tags.map((tag) => (
        <div
          key={tag.id}
          className="flex h-8 items-center gap-2 rounded-md px-2 transition-colors hover:bg-bg-elevated/40"
        >
          <span className="rounded-full border px-2 py-0.5 text-[11px]" style={tagPillStyle(tag)}>
            {tag.label}
          </span>
          <Badge variant="muted">{tag.group?.label ?? 'Tag'}</Badge>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7"
            onClick={() => z.mutate(supportMetadataMutators.tag.restore({ id: tag.id }))}
          >
            <RotateCcw className="h-3 w-3" />
            Restore
          </Button>
        </div>
      ))}
    </ListSection>
  );
}
