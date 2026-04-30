import {
  Badge,
  Button,
  Card,
  CardContent,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Input,
  Textarea,
} from '@opendesk/ui';
import { useQuery } from '@rocicorp/zero/react';
import { createFileRoute } from '@tanstack/react-router';
import { Archive, Check, ChevronDown, Plus, RotateCcw, Settings2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { CustomFieldsBlock } from '@/components/conversation/custom-fields-block';
import { RouteErrorFeedback, RoutePendingFeedback } from '@/components/route-feedback';
import {
  type CustomFieldCategory,
  type CustomFieldRow,
  type CustomFieldType,
  isCustomFieldActive,
  rowsAs,
  supportMetadataMutators,
  supportMetadataQueries,
} from '@/lib/support-metadata';
import { useZero } from '@/lib/zero';

export const Route = createFileRoute('/app/settings/custom-fields')({
  component: CustomFieldsSettingsPage,
  pendingComponent: RoutePendingFeedback,
  errorComponent: RouteErrorFeedback,
});

const FIELD_TYPES: CustomFieldType[] = [
  'text',
  'number',
  'decimal',
  'boolean',
  'date',
  'list',
  'multi_select',
  'agent',
  'customer',
  'ticket',
  'url',
  'address',
  'dynamic_list',
  'dynamic_multi_select',
];

function CustomFieldsSettingsPage() {
  const [category, setCategory] = useState<CustomFieldCategory>('ticket');

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 sm:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-foreground">Custom fields</h1>
          <p className="text-xs text-muted-foreground">
            Define operational ticket and customer attributes for agents to maintain.
          </p>
        </div>
        <div className="inline-flex w-fit rounded-md border border-border bg-surface p-0.5">
          {(['ticket', 'customer'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              className={cn(
                'rounded px-3 py-1.5 text-xs font-medium capitalize',
                category === item
                  ? 'bg-brand-soft text-brand-soft-foreground'
                  : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
              )}
            >
              {item} fields
            </button>
          ))}
        </div>
      </div>
      <CustomFieldCategoryPanel category={category} />
    </div>
  );
}

function CustomFieldCategoryPanel({ category }: { category: CustomFieldCategory }) {
  const z = useZero();
  const [rawFields] = useQuery(supportMetadataQueries.customFieldsForSettings({ category }));
  const fields = rowsAs<CustomFieldRow>(rawFields).sort(
    (a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName),
  );
  const activeFields = fields.filter(isCustomFieldActive);
  const archivedFields = fields.filter((field) => !isCustomFieldActive(field));
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const selected = fields.find((field) => field.id === selectedID) ?? activeFields[0] ?? null;

  useEffect(() => {
    if (selectedID && fields.some((field) => field.id === selectedID)) return;
    setSelectedID(activeFields[0]?.id ?? null);
  }, [activeFields, fields, selectedID]);

  async function archive(field: CustomFieldRow) {
    await z.mutate(supportMetadataMutators.customField.archive({ id: field.id }));
  }

  async function restore(field: CustomFieldRow) {
    await z.mutate(supportMetadataMutators.customField.update({ id: field.id, active: true }));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <main className="grid content-start gap-4">
        <CreateFieldForm category={category} existing={fields} onCreated={setSelectedID} />

        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b border-border bg-surface-muted px-4 py-2">
              <p className="text-xs font-semibold text-foreground">Active fields</p>
              <Badge variant="muted">{activeFields.length}</Badge>
            </div>
            {activeFields.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                No active {category} fields.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {activeFields.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    selected={field.id === selected?.id}
                    onSelect={() => setSelectedID(field.id)}
                    onArchive={() => archive(field)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b border-border bg-surface-muted px-4 py-2">
              <p className="text-xs font-semibold text-foreground">Archived fields</p>
              <Badge variant="muted">{archivedFields.length}</Badge>
            </div>
            {archivedFields.length === 0 ? (
              <div className="px-4 py-4 text-xs text-muted-foreground">No archived fields.</div>
            ) : (
              <div className="divide-y divide-border">
                {archivedFields.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    selected={field.id === selected?.id}
                    onSelect={() => setSelectedID(field.id)}
                    onRestore={() => restore(field)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <aside className="grid content-start gap-4">
        {selected ? (
          <FieldDetail field={selected} />
        ) : (
          <Card>
            <CardContent className="flex items-center gap-3 p-4 text-xs text-muted-foreground">
              <Settings2 className="h-4 w-4" />
              Select a field to edit.
            </CardContent>
          </Card>
        )}
        <CustomFieldsBlock
          entity={category}
          entityID={null}
          record={{ customFieldValues: [] }}
          title="Input preview"
        />
      </aside>
    </div>
  );
}

function CreateFieldForm({
  category,
  existing,
  onCreated,
}: {
  category: CustomFieldCategory;
  existing: CustomFieldRow[];
  onCreated: (id: string) => void;
}) {
  const z = useZero();
  const [displayName, setDisplayName] = useState('');
  const [key, setKey] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (key || !displayName) return;
    setKey(slugKey(displayName));
  }, [displayName, key]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextKey = slugKey(key);
    if (!displayName.trim()) {
      setError('Display name is required.');
      return;
    }
    if (!nextKey) {
      setError('Key is required.');
      return;
    }
    if (existing.some((field) => field.key === nextKey && field.category === category)) {
      setError('Key already exists for this category.');
      return;
    }
    const nextOptions = optionLines(options);
    if ((type === 'list' || type === 'multi_select') && nextOptions.length === 0) {
      setError('List fields require at least one option.');
      return;
    }
    if (new Set(nextOptions).size !== nextOptions.length) {
      setError('Options must be unique.');
      return;
    }
    const id = crypto.randomUUID();
    await z.mutate(
      supportMetadataMutators.customField.create({
        id,
        key: nextKey,
        displayName: displayName.trim(),
        category,
        type,
        required,
        active: true,
        options: nextOptions,
        sortOrder: existing.length + 1,
      }),
    );
    setDisplayName('');
    setKey('');
    setOptions('');
    setRequired(false);
    setType('text');
    setError(null);
    onCreated(id);
  }

  return (
    <form noValidate onSubmit={create} className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-brand-600" />
          <p className="text-xs font-semibold text-foreground">Create {category} field</p>
        </div>
        <FieldTypeMenu value={type} onChange={setType} />
      </div>
      {error ? <p className="mb-2 text-xs text-danger">{error}</p> : null}
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px]">
        <Input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Customer tier"
          className="h-8 text-xs"
          aria-invalid={error?.includes('Display') ?? false}
        />
        <Input
          value={key}
          onChange={(event) => setKey(event.target.value)}
          onBlur={() => setKey(slugKey(key))}
          placeholder="customer_tier"
          className="h-8 font-mono text-xs"
          aria-invalid={error?.includes('Key') ?? false}
        />
      </div>
      {isOptionType(type) ? (
        <Textarea
          value={options}
          onChange={(event) => setOptions(event.target.value)}
          placeholder="One option per line"
          className="mt-2 min-h-20 text-xs"
        />
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={required}
            onChange={(event) => setRequired(event.target.checked)}
            className="h-4 w-4 rounded border-border accent-brand-600"
          />
          Required
        </label>
        <Button type="submit" size="sm" className="h-8">
          <Plus className="h-3.5 w-3.5" />
          Create field
        </Button>
      </div>
    </form>
  );
}

function FieldRow({
  field,
  selected,
  onSelect,
  onArchive,
  onRestore,
}: {
  field: CustomFieldRow;
  selected: boolean;
  onSelect: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
}) {
  return (
    <div
      className={cn(
        'grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]',
        selected && 'bg-brand-soft/50',
      )}
    >
      <button type="button" onClick={onSelect} className="min-w-0 text-left">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-medium text-foreground">{field.displayName}</p>
          <Badge variant="muted">{typeLabel(field.type)}</Badge>
          {field.required ? <Badge variant="warning">Required</Badge> : null}
          {!isCustomFieldActive(field) ? <Badge variant="muted">Archived</Badge> : null}
        </div>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">{field.key}</p>
      </button>
      <div className="flex items-center justify-end gap-2">
        {onArchive ? (
          <Button size="sm" variant="outline" className="h-8" onClick={onArchive}>
            <Archive className="h-3.5 w-3.5" />
            Archive
          </Button>
        ) : null}
        {onRestore ? (
          <Button size="sm" variant="outline" className="h-8" onClick={onRestore}>
            <RotateCcw className="h-3.5 w-3.5" />
            Restore
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function FieldDetail({ field }: { field: CustomFieldRow }) {
  const z = useZero();
  const [displayName, setDisplayName] = useState(field.displayName);
  const [description, setDescription] = useState(field.description ?? '');
  const [required, setRequired] = useState(field.required);
  const [active, setActive] = useState(isCustomFieldActive(field));
  const [sortOrder, setSortOrder] = useState(String(field.sortOrder));
  const [options, setOptions] = useState((field.options ?? []).join('\n'));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(field.displayName);
    setDescription(field.description ?? '');
    setRequired(field.required);
    setActive(isCustomFieldActive(field));
    setSortOrder(String(field.sortOrder));
    setOptions((field.options ?? []).join('\n'));
    setError(null);
  }, [field]);

  async function save() {
    if (!displayName.trim()) return;
    const nextOptions = optionLines(options);
    if ((field.type === 'list' || field.type === 'multi_select') && nextOptions.length === 0) {
      setError('List fields require at least one option.');
      return;
    }
    if (new Set(nextOptions).size !== nextOptions.length) {
      setError('Options must be unique.');
      return;
    }
    await z.mutate(
      supportMetadataMutators.customField.update({
        id: field.id,
        displayName: displayName.trim(),
        description: description.trim() || null,
        required,
        active,
        sortOrder: Number.parseInt(sortOrder, 10) || 0,
        options: nextOptions,
      }),
    );
    setError(null);
  }

  return (
    <Card>
      <CardContent className="grid gap-3 p-4">
        <div>
          <p className="text-xs font-semibold text-foreground">Field detail</p>
          <p className="text-[11px] text-muted-foreground">
            Key and type are locked after creation.
          </p>
        </div>
        {error ? (
          <p className="rounded-md bg-danger-soft px-2 py-1 text-xs text-danger">{error}</p>
        ) : null}
        <div className="grid gap-1.5">
          <label htmlFor="field-display-name" className="text-xs font-medium text-foreground">
            Display name
          </label>
          <Input
            id="field-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            aria-invalid={!displayName.trim()}
            className="h-8 text-xs"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ReadonlyValue label="Key" value={field.key} mono />
          <ReadonlyValue label="Type" value={typeLabel(field.type)} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="field-description" className="text-xs font-medium text-foreground">
            Description
          </label>
          <Textarea
            id="field-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="min-h-20 text-xs"
          />
        </div>
        {isOptionType(field.type) ? (
          <div className="grid gap-1.5">
            <label htmlFor="field-options" className="text-xs font-medium text-foreground">
              Options
            </label>
            <Textarea
              id="field-options"
              value={options}
              onChange={(event) => setOptions(event.target.value)}
              className="min-h-24 text-xs"
            />
          </div>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={required}
              onChange={(event) => setRequired(event.target.checked)}
              className="h-4 w-4 rounded border-border accent-brand-600"
            />
            Required
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
              className="h-4 w-4 rounded border-border accent-brand-600"
            />
            Active
          </label>
          <Input
            type="number"
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
            aria-label="Sort order"
            className="h-8 text-xs"
          />
        </div>
        <Button size="sm" onClick={save} disabled={!displayName.trim()}>
          <Check className="h-3.5 w-3.5" />
          Save changes
        </Button>
      </CardContent>
    </Card>
  );
}

function FieldTypeMenu({
  value,
  onChange,
}: {
  value: CustomFieldType;
  onChange: (value: CustomFieldType) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs">
          {typeLabel(value)}
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        <DropdownMenuLabel>Field type</DropdownMenuLabel>
        {FIELD_TYPES.map((type) => (
          <DropdownMenuItem key={type} onSelect={() => onChange(type)}>
            {typeLabel(type)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ReadonlyValue({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-muted px-2 py-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn('truncate text-xs text-foreground', mono && 'font-mono')}>{value}</p>
    </div>
  );
}

function isOptionType(type: CustomFieldType) {
  return type === 'list' || type === 'multi_select' || type === 'dynamic_multi_select';
}

function optionLines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function slugKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function typeLabel(type: CustomFieldType) {
  return type.replaceAll('_', ' ');
}
