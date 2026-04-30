import { Badge, Button, Card, CardContent, Input } from '@opendesk/ui';
import { useQuery } from '@rocicorp/zero/react';
import { createFileRoute } from '@tanstack/react-router';
import { Archive, Check, Folder, Plus, RotateCcw, Tags, X } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { RouteErrorFeedback, RoutePendingFeedback } from '@/components/route-feedback';
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

type Selection = { kind: 'group'; id: string } | { kind: 'tag'; id: string } | null;

function TagsSettingsPage() {
  const z = useZero();
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
  const [selection, setSelection] = useState<Selection>(null);
  const [groupLabel, setGroupLabel] = useState('');
  const [groupColor, setGroupColor] = useState('#0f766e');
  const [tagLabel, setTagLabel] = useState('');
  const [tagGroupID, setTagGroupID] = useState<string | null>(null);
  const [tagColor, setTagColor] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selection) return;
    const firstGroup = groups[0];
    const firstTag = tags[0];
    if (firstGroup) setSelection({ kind: 'group', id: firstGroup.id });
    else if (firstTag) setSelection({ kind: 'tag', id: firstTag.id });
  }, [groups, selection, tags]);

  const tagsByGroup = useMemo(() => {
    const map = new Map<string, TagRow[]>();
    for (const tag of tags) {
      const id = tag.groupID && activeGroupIDs.has(tag.groupID) ? tag.groupID : 'ungrouped';
      map.set(id, [...(map.get(id) ?? []), tag]);
    }
    return map;
  }, [activeGroupIDs, tags]);

  const selectedGroup =
    selection?.kind === 'group' ? groups.find((group) => group.id === selection.id) : null;
  const selectedTag =
    selection?.kind === 'tag' ? tags.find((tag) => tag.id === selection.id) : null;

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = groupLabel.trim();
    if (!label) {
      setError('Group label is required.');
      return;
    }
    if (!isHexColor(groupColor)) {
      setError('Use a hex color like #0f766e.');
      return;
    }
    const id = crypto.randomUUID();
    await z.mutate(
      supportMetadataMutators.tagGroup.create({
        id,
        label,
        color: groupColor,
        sortOrder: groups.length + 1,
      }),
    );
    setGroupLabel('');
    setError(null);
    setSelection({ kind: 'group', id });
  }

  async function createTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = tagLabel.trim();
    const color = tagColor.trim();
    if (!label) {
      setError('Tag label is required.');
      return;
    }
    if (color && !isHexColor(color)) {
      setError('Use a hex color like #0f766e.');
      return;
    }
    const id = crypto.randomUUID();
    await z.mutate(
      supportMetadataMutators.tag.create({
        id,
        label,
        groupID: tagGroupID,
        color: color || null,
        sortOrder: tags.length + 1,
      }),
    );
    setTagLabel('');
    setTagColor('');
    setError(null);
    setSelection({ kind: 'tag', id });
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 sm:px-8">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-foreground">Tags</h1>
          <p className="text-xs text-muted-foreground">
            Organize tickets with grouped labels that agents can apply from the conversation view.
          </p>
        </div>
        <Badge variant="muted">{tags.length} active tags</Badge>
      </div>

      {error ? (
        <div className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-xs text-danger-soft-foreground">
          {error}
        </div>
      ) : null}

      {groups.length === 0 && tags.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-soft text-brand-soft-foreground">
              <Tags className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No tags yet</p>
              <p className="text-xs text-muted-foreground">Create your first tag group.</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid min-h-[520px] gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-3 py-2">
            <p className="text-xs font-semibold text-foreground">Groups</p>
          </div>
          <div className="max-h-[520px] overflow-y-auto p-2">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => setSelection({ kind: 'group', id: group.id })}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                  selection?.kind === 'group' && selection.id === group.id
                    ? 'bg-brand-soft text-brand-soft-foreground'
                    : 'text-foreground hover:bg-surface-muted'
                }`}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full border"
                  style={{
                    backgroundColor: normalizeHexColor(group.color),
                    borderColor: group.color,
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{group.label}</span>
                <span className="text-[10px] text-muted-foreground">
                  {tagsByGroup.get(group.id)?.length ?? 0}
                </span>
              </button>
            ))}
            <div className="mt-3 border-t border-border pt-3">
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Ungrouped
              </p>
              {(tagsByGroup.get('ungrouped') ?? []).map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => setSelection({ kind: 'tag', id: tag.id })}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-surface-muted"
                >
                  <span className="h-2.5 w-2.5 rounded-full border" style={tagPillStyle(tag)} />
                  <span className="min-w-0 flex-1 truncate">{tag.label}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-lg border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <p className="text-xs font-semibold text-foreground">
                {selectedGroup ? selectedGroup.label : selectedTag ? selectedTag.label : 'Tags'}
              </p>
            </div>
            <div className="divide-y divide-border">
              {selectedGroup ? (
                <>
                  <GroupEditor group={selectedGroup} />
                  {(tagsByGroup.get(selectedGroup.id) ?? []).map((tag) => (
                    <TagEditor
                      key={tag.id}
                      tag={tag}
                      groups={groups}
                      onSelect={() => setSelection({ kind: 'tag', id: tag.id })}
                    />
                  ))}
                </>
              ) : selectedTag ? (
                <TagEditor tag={selectedTag} groups={groups} expanded />
              ) : (
                <p className="px-3 py-6 text-xs text-muted-foreground">Select a group or tag.</p>
              )}
            </div>
          </section>

          <aside className="grid content-start gap-4">
            <form
              noValidate
              onSubmit={createGroup}
              className="rounded-lg border border-border bg-surface p-3"
            >
              <div className="mb-3 flex items-center gap-2">
                <Folder className="h-4 w-4 text-brand-600" />
                <p className="text-xs font-semibold text-foreground">Create group</p>
              </div>
              <div className="grid gap-2">
                <Input
                  value={groupLabel}
                  onChange={(event) => setGroupLabel(event.target.value)}
                  placeholder="Billing"
                  className="h-8 text-xs"
                  aria-invalid={error?.includes('Group') ?? false}
                />
                <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-2">
                  <input
                    type="color"
                    value={groupColor}
                    onChange={(event) => setGroupColor(event.target.value)}
                    className="h-8 w-11 rounded-md border border-input bg-surface p-1"
                    aria-label="Group color"
                  />
                  <Input
                    value={groupColor}
                    onChange={(event) => setGroupColor(event.target.value)}
                    className="h-8 font-mono text-xs"
                  />
                </div>
                <Button type="submit" size="sm" className="h-8">
                  <Plus className="h-3.5 w-3.5" />
                  Create group
                </Button>
              </div>
            </form>

            <form
              noValidate
              onSubmit={createTag}
              className="rounded-lg border border-border bg-surface p-3"
            >
              <div className="mb-3 flex items-center gap-2">
                <Tags className="h-4 w-4 text-brand-600" />
                <p className="text-xs font-semibold text-foreground">Create tag</p>
              </div>
              <div className="grid gap-2">
                <Input
                  value={tagLabel}
                  onChange={(event) => setTagLabel(event.target.value)}
                  placeholder="Refund"
                  className="h-8 text-xs"
                  aria-invalid={error?.includes('Tag') ?? false}
                />
                <GroupPicker groups={groups} value={tagGroupID} onChange={setTagGroupID} />
                <Input
                  value={tagColor}
                  onChange={(event) => setTagColor(event.target.value)}
                  placeholder="Optional color override"
                  className="h-8 font-mono text-xs"
                  aria-invalid={Boolean(tagColor && !isHexColor(tagColor))}
                />
                <Button type="submit" size="sm" className="h-8">
                  <Plus className="h-3.5 w-3.5" />
                  Create tag
                </Button>
              </div>
            </form>
          </aside>
        </main>
      </div>

      {archivedGroups.length > 0 || archivedTags.length > 0 ? (
        <section className="rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-xs font-semibold text-foreground">Archived</p>
            <Badge variant="muted">{archivedGroups.length + archivedTags.length}</Badge>
          </div>
          <div className="divide-y divide-border">
            {archivedGroups.map((group) => (
              <ArchivedRow
                key={group.id}
                label={group.label}
                meta="Group"
                color={group.color}
                onRestore={() =>
                  z.mutate(supportMetadataMutators.tagGroup.restore({ id: group.id }))
                }
              />
            ))}
            {archivedTags.map((tag) => (
              <ArchivedRow
                key={tag.id}
                label={tag.label}
                meta={tag.group?.label ?? 'Tag'}
                color={tag.color || tag.group?.color || '#0f766e'}
                onRestore={() => z.mutate(supportMetadataMutators.tag.restore({ id: tag.id }))}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function GroupEditor({ group }: { group: TagGroupRow }) {
  const z = useZero();
  const [label, setLabel] = useState(group.label);
  const [color, setColor] = useState(group.color);
  const [sortOrder, setSortOrder] = useState(String(group.sortOrder));
  const invalid = !label.trim() || !isHexColor(color);

  useEffect(() => {
    setLabel(group.label);
    setColor(group.color);
    setSortOrder(String(group.sortOrder));
  }, [group]);

  async function save() {
    if (invalid) return;
    await z.mutate(
      supportMetadataMutators.tagGroup.update({
        id: group.id,
        label: label.trim(),
        color,
        sortOrder: Number.parseInt(sortOrder, 10) || 0,
      }),
    );
  }

  return (
    <div className="grid gap-3 p-3">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_120px_110px]">
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          aria-invalid={!label.trim()}
        />
        <Input
          value={color}
          onChange={(event) => setColor(event.target.value)}
          className="font-mono"
          aria-invalid={!isHexColor(color)}
        />
        <Input
          type="number"
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value)}
          aria-label="Sort order"
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => z.mutate(supportMetadataMutators.tagGroup.archive({ id: group.id }))}
        >
          <Archive className="h-3.5 w-3.5" />
          Archive
        </Button>
        <Button size="sm" onClick={save} disabled={invalid}>
          <Check className="h-3.5 w-3.5" />
          Save group
        </Button>
      </div>
    </div>
  );
}

function TagEditor({
  tag,
  groups,
  expanded = false,
  onSelect,
}: {
  tag: TagRow;
  groups: TagGroupRow[];
  expanded?: boolean;
  onSelect?: () => void;
}) {
  const z = useZero();
  const activeGroupIDs = useMemo(() => new Set(groups.map((group) => group.id)), [groups]);
  const [label, setLabel] = useState(tag.label);
  const [groupID, setGroupID] = useState<string | null>(
    tag.groupID && activeGroupIDs.has(tag.groupID) ? tag.groupID : null,
  );
  const [color, setColor] = useState(tag.color ?? '');
  const [sortOrder, setSortOrder] = useState(String(tag.sortOrder));
  const invalid = !label.trim() || Boolean(color && !isHexColor(color));

  useEffect(() => {
    setLabel(tag.label);
    setGroupID(tag.groupID && activeGroupIDs.has(tag.groupID) ? tag.groupID : null);
    setColor(tag.color ?? '');
    setSortOrder(String(tag.sortOrder));
  }, [activeGroupIDs, tag]);

  async function save() {
    if (invalid) return;
    await z.mutate(
      supportMetadataMutators.tag.update({
        id: tag.id,
        label: label.trim(),
        groupID,
        color: color.trim() || null,
        sortOrder: Number.parseInt(sortOrder, 10) || 0,
      }),
    );
  }

  return (
    <div className="grid gap-2 p-3">
      <button
        type="button"
        onClick={onSelect}
        className="flex w-fit max-w-full items-center gap-2 text-left"
      >
        <span
          className="rounded-full border px-2 py-0.5 text-[11px] font-medium"
          style={tagPillStyle(tag)}
        >
          {tag.label}
        </span>
        {!expanded ? <span className="text-[11px] text-muted-foreground">Edit</span> : null}
      </button>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          aria-invalid={!label.trim()}
        />
        <GroupPicker groups={groups} value={groupID} onChange={setGroupID} />
        <Input
          value={color}
          onChange={(event) => setColor(event.target.value)}
          placeholder="Tag color"
          className="font-mono"
          aria-invalid={Boolean(color && !isHexColor(color))}
        />
        <Input
          type="number"
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value)}
          aria-label="Sort order"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => z.mutate(supportMetadataMutators.tag.archive({ id: tag.id }))}
        >
          <Archive className="h-3.5 w-3.5" />
          Archive
        </Button>
        <Button size="sm" onClick={save} disabled={invalid}>
          <Check className="h-3.5 w-3.5" />
          Save tag
        </Button>
      </div>
    </div>
  );
}

function ArchivedRow({
  label,
  meta,
  color,
  onRestore,
}: {
  label: string;
  meta: string;
  color: string;
  onRestore: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full border"
          style={{
            backgroundColor: `${normalizeHexColor(color)}1f`,
            borderColor: normalizeHexColor(color),
          }}
        />
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">{label}</p>
          <p className="text-[11px] text-muted-foreground">{meta}</p>
        </div>
      </div>
      <Button size="sm" variant="outline" className="h-8" onClick={onRestore}>
        <RotateCcw className="h-3.5 w-3.5" />
        Restore
      </Button>
    </div>
  );
}

function GroupPicker({
  groups,
  value,
  onChange,
}: {
  groups: TagGroupRow[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const selected = groups.find((group) => group.id === value);
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 flex-1 justify-start px-2 text-xs"
        onClick={() => {
          const currentIndex = groups.findIndex((group) => group.id === value);
          const next = groups[currentIndex + 1] ?? null;
          onChange(next?.id ?? null);
        }}
      >
        {selected ? selected.label : 'Ungrouped'}
      </Button>
      {value ? (
        <button
          type="button"
          aria-label="Clear group"
          onClick={() => onChange(null)}
          className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground hover:bg-surface-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
