// /app/settings/custom-fields — single-column list of fields, with the
// in-page Ticket | Customer pill for category. Create + edit live in a side
// sheet (tier B). Key and type are locked after creation.

import {
  Badge,
  Button,
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
import { Archive, ChevronDown, Plus, RotateCcw, Settings2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { CustomFieldsBlock } from '@/components/conversation/custom-fields-block';
import { RouteErrorFeedback, RoutePendingFeedback } from '@/components/route-feedback';
import {
  EmptyState,
  ListSection,
  SettingsBody,
  SettingsHeader,
  SettingsSheet,
} from '@/components/settings';
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
import { CACHE_NAV } from '@/lib/zero-cache';

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

type SheetState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; field: CustomFieldRow };

function CustomFieldsSettingsPage() {
  const [category, setCategory] = useState<CustomFieldCategory>('ticket');
  const [sheet, setSheet] = useState<SheetState>({ kind: 'closed' });
  const [showArchived, setShowArchived] = useState(false);

  const [rawFields] = useQuery(
    supportMetadataQueries.customFieldsForSettings({ category }),
    CACHE_NAV,
  );
  const fields = rowsAs<CustomFieldRow>(rawFields).sort(
    (a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName),
  );
  const activeFields = fields.filter(isCustomFieldActive);
  const archivedFields = fields.filter((field) => !isCustomFieldActive(field));

  return (
    <>
      <SettingsHeader
        title="Custom fields"
        description="Define operational ticket and customer attributes for agents to maintain."
        actions={
          <>
            <CategoryToggle value={category} onChange={setCategory} />
            <Button size="sm" onClick={() => setSheet({ kind: 'create' })} className="h-8">
              <Plus className="h-3.5 w-3.5" />
              New field
            </Button>
          </>
        }
      />
      <SettingsBody>
        <div className="flex flex-col gap-4">
          {activeFields.length === 0 ? (
            <EmptyState
              icon={Settings2}
              title={`No ${category} fields yet`}
              description={`Add structured ${category} attributes — they appear in the ${category === 'ticket' ? 'conversation' : 'customer'} sidebar for agents.`}
              action={
                <Button size="sm" onClick={() => setSheet({ kind: 'create' })}>
                  <Plus className="h-3.5 w-3.5" />
                  New field
                </Button>
              }
            />
          ) : (
            <ListSection title="Active" count={activeFields.length}>
              {activeFields.map((field) => (
                <FieldRow
                  key={field.id}
                  field={field}
                  onEdit={() => setSheet({ kind: 'edit', field })}
                />
              ))}
            </ListSection>
          )}

          {archivedFields.length > 0 ? (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowArchived((s) => !s)}
                className="self-start text-[12px] text-fg-tertiary underline-offset-2 hover:text-fg-primary hover:underline"
              >
                {showArchived ? 'Hide archived' : `Show archived (${archivedFields.length})`}
              </button>
              {showArchived ? (
                <ListSection title="Archived" count={archivedFields.length}>
                  {archivedFields.map((field) => (
                    <FieldRow
                      key={field.id}
                      field={field}
                      onEdit={() => setSheet({ kind: 'edit', field })}
                    />
                  ))}
                </ListSection>
              ) : null}
            </div>
          ) : null}

          <PreviewSection category={category} />
        </div>
      </SettingsBody>

      <CreateFieldSheet
        open={sheet.kind === 'create'}
        category={category}
        existing={fields}
        onClose={() => setSheet({ kind: 'closed' })}
      />
      <EditFieldSheet
        open={sheet.kind === 'edit'}
        field={sheet.kind === 'edit' ? sheet.field : null}
        onClose={() => setSheet({ kind: 'closed' })}
      />
    </>
  );
}

function CategoryToggle({
  value,
  onChange,
}: {
  value: CustomFieldCategory;
  onChange: (next: CustomFieldCategory) => void;
}) {
  return (
    <div className="inline-flex h-8 rounded-md border border-line-default bg-surface p-0.5">
      {(['ticket', 'customer'] as const).map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={cn(
            'rounded px-2.5 text-[12px] font-medium capitalize transition-colors',
            value === item
              ? 'bg-bg-elevated text-fg-primary'
              : 'text-fg-tertiary hover:text-fg-primary',
          )}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function FieldRow({ field, onEdit }: { field: CustomFieldRow; onEdit: () => void }) {
  const z = useZero();
  const active = isCustomFieldActive(field);
  return (
    <div className="flex h-12 items-center gap-3 border-b border-line-quiet px-3 last:border-b-0">
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-[13px] font-medium text-fg-primary">{field.displayName}</p>
          <Badge variant="muted">{typeLabel(field.type)}</Badge>
          {field.required ? <Badge variant="warning">Required</Badge> : null}
          {!active ? <Badge variant="muted">Archived</Badge> : null}
        </div>
        <p className="mt-0.5 font-mono text-[11px] text-fg-tertiary">{field.key}</p>
      </button>
      {active ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          onClick={() => z.mutate(supportMetadataMutators.customField.archive({ id: field.id }))}
        >
          <Archive className="h-3 w-3" />
          Archive
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          onClick={() =>
            z.mutate(supportMetadataMutators.customField.update({ id: field.id, active: true }))
          }
        >
          <RotateCcw className="h-3 w-3" />
          Restore
        </Button>
      )}
    </div>
  );
}

function PreviewSection({ category }: { category: CustomFieldCategory }) {
  return (
    <section className="rounded-md border border-line-quiet bg-surface p-4">
      <p className="mb-2 text-[12px] font-semibold text-fg-primary">Input preview</p>
      <p className="mb-3 text-[11px] text-fg-tertiary">
        Live preview of how active fields render in the {category} sidebar.
      </p>
      <CustomFieldsBlock
        entity={category}
        entityID={null}
        record={{ customFieldValues: [] }}
        title={undefined}
      />
    </section>
  );
}

function CreateFieldSheet({
  open,
  category,
  existing,
  onClose,
}: {
  open: boolean;
  category: CustomFieldCategory;
  existing: CustomFieldRow[];
  onClose: () => void;
}) {
  const z = useZero();
  const [displayName, setDisplayName] = useState('');
  const [key, setKey] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setDisplayName('');
      setKey('');
      setType('text');
      setRequired(false);
      setOptions('');
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (key || !displayName) return;
    setKey(slugKey(displayName));
  }, [displayName, key]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextKey = slugKey(key);
    if (!displayName.trim()) return setError('Display name is required.');
    if (!nextKey) return setError('Key is required.');
    if (existing.some((f) => f.key === nextKey && f.category === category)) {
      return setError('Key already exists for this category.');
    }
    const nextOptions = optionLines(options);
    if (isOptionType(type) && nextOptions.length === 0) {
      return setError('List fields require at least one option.');
    }
    if (new Set(nextOptions).size !== nextOptions.length) {
      return setError('Options must be unique.');
    }
    await z.mutate(
      supportMetadataMutators.customField.create({
        id: crypto.randomUUID(),
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
    onClose();
  }

  return (
    <SettingsSheet
      open={open}
      onOpenChange={(next) => (next ? null : onClose())}
      title={`New ${category} field`}
      description="Key and type are locked after the field is created."
      footer={
        <>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form="create-field-form">
            Create field
          </Button>
        </>
      }
    >
      <form id="create-field-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
        <FormRow label="Display name">
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Customer tier"
            autoFocus
          />
        </FormRow>
        <FormRow label="Key">
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onBlur={() => setKey(slugKey(key))}
            placeholder="customer_tier"
            className="font-mono"
          />
        </FormRow>
        <FormRow label="Type">
          <FieldTypeMenu value={type} onChange={setType} />
        </FormRow>
        {isOptionType(type) ? (
          <FormRow label="Options">
            <Textarea
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              placeholder="One option per line"
              className="min-h-24"
            />
          </FormRow>
        ) : null}
        <label className="inline-flex items-center gap-2 text-[12px] text-fg-secondary">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="h-4 w-4 rounded border-line-default accent-brand-500"
          />
          Required
        </label>
        {error ? <p className="text-[12px] text-danger">{error}</p> : null}
      </form>
    </SettingsSheet>
  );
}

function EditFieldSheet({
  open,
  field,
  onClose,
}: {
  open: boolean;
  field: CustomFieldRow | null;
  onClose: () => void;
}) {
  const z = useZero();
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [required, setRequired] = useState(false);
  const [active, setActive] = useState(true);
  const [sortOrder, setSortOrder] = useState('0');
  const [options, setOptions] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (field) {
      setDisplayName(field.displayName);
      setDescription(field.description ?? '');
      setRequired(field.required);
      setActive(isCustomFieldActive(field));
      setSortOrder(String(field.sortOrder));
      setOptions((field.options ?? []).join('\n'));
      setError(null);
    }
  }, [field]);

  async function save() {
    if (!field || !displayName.trim()) return;
    const nextOptions = optionLines(options);
    if (isOptionType(field.type) && nextOptions.length === 0) {
      return setError('List fields require at least one option.');
    }
    if (new Set(nextOptions).size !== nextOptions.length) {
      return setError('Options must be unique.');
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
    onClose();
  }

  if (!field) {
    return (
      <SettingsSheet
        open={open}
        onOpenChange={(next) => (next ? null : onClose())}
        title="Edit field"
      >
        <span />
      </SettingsSheet>
    );
  }

  return (
    <SettingsSheet
      open={open}
      onOpenChange={(next) => (next ? null : onClose())}
      title={`Edit ${field.displayName}`}
      description="Key and type are locked after creation."
      footer={
        <>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={!displayName.trim()}>
            Save
          </Button>
        </>
      }
    >
      <FormRow label="Display name">
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </FormRow>
      <div className="grid grid-cols-2 gap-2">
        <ReadonlyValue label="Key" value={field.key} mono />
        <ReadonlyValue label="Type" value={typeLabel(field.type)} />
      </div>
      <FormRow label="Description">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-20"
        />
      </FormRow>
      {isOptionType(field.type) ? (
        <FormRow label="Options">
          <Textarea
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            className="min-h-24"
          />
        </FormRow>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <label className="inline-flex items-center gap-2 text-[12px] text-fg-secondary">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="h-4 w-4 rounded border-line-default accent-brand-500"
          />
          Required
        </label>
        <label className="inline-flex items-center gap-2 text-[12px] text-fg-secondary">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 rounded border-line-default accent-brand-500"
          />
          Active
        </label>
        <FormRow label="Sort order">
          <Input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="w-24"
          />
        </FormRow>
      </div>
      {error ? <p className="text-[12px] text-danger">{error}</p> : null}
    </SettingsSheet>
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
        <Button type="button" variant="outline" size="sm" className="h-8 justify-start">
          {typeLabel(value)}
          <ChevronDown className="ml-auto h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
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

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-fg-primary">{label}</span>
      {children}
    </label>
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
    <div className="rounded-md border border-line-quiet bg-bg-elevated/40 px-2 py-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-quaternary">
        {label}
      </p>
      <p className={cn('truncate text-[12px] text-fg-primary', mono && 'font-mono')}>{value}</p>
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
