import {
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Textarea,
} from '@opendesk/ui';
import { useQuery } from '@rocicorp/zero/react';
import { ChevronDown, Settings2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type CustomFieldCategory,
  type CustomFieldRow,
  fieldValuesByFieldID,
  isCustomFieldActive,
  rowsAs,
  supportMetadataMutators,
  supportMetadataQueries,
} from '@/lib/support-metadata';
import { useZero } from '@/lib/zero';
import { CACHE_FOREVER } from '@/lib/zero-cache';

interface CustomFieldsBlockProps {
  entity: CustomFieldCategory;
  entityID: string | null | undefined;
  record?: unknown;
  title?: string;
}

export function CustomFieldsBlock({ entity, entityID, record, title }: CustomFieldsBlockProps) {
  const z = useZero();
  const [rawFields] = useQuery(
    supportMetadataQueries.customFieldsByCategory({ category: entity }),
    CACHE_FOREVER,
  );
  const fields = rowsAs<CustomFieldRow>(rawFields)
    .filter(isCustomFieldActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName));
  const valuesByID = fieldValuesByFieldID(objectValue(record, 'customFieldValues'));
  const valuesByKey = useMemo(() => {
    const map = new Map<string, unknown>();
    for (const field of fields) {
      map.set(field.key, valuesByID.get(field.id)?.value ?? field.defaultValue ?? null);
    }
    return map;
  }, [fields, valuesByID]);

  async function commit(field: CustomFieldRow, value: unknown) {
    if (!entityID) return;
    const empty = isEmptyValue(value);
    if (entity === 'ticket') {
      if (empty) {
        await z.mutate(
          supportMetadataMutators.customField.clearValueOnTicket({
            fieldID: field.id,
            ticketID: entityID,
          }),
        );
        return;
      }
      await z.mutate(
        supportMetadataMutators.customField.setValueOnTicket({
          id: valuesByID.get(field.id)?.id ?? crypto.randomUUID(),
          fieldID: field.id,
          ticketID: entityID,
          value,
        }),
      );
      return;
    }

    const clearCustomer = supportMetadataMutators.customField.clearValueOnCustomer;
    if (empty && clearCustomer) {
      await z.mutate(clearCustomer({ fieldID: field.id, customerID: entityID }));
      return;
    }
    await z.mutate(
      supportMetadataMutators.customField.setValueOnCustomer({
        id: valuesByID.get(field.id)?.id ?? crypto.randomUUID(),
        fieldID: field.id,
        customerID: entityID,
        value: empty ? null : value,
      }),
    );
  }

  const visibleFields = fields.filter((field) => fieldIsVisible(field, valuesByKey));

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold text-foreground">
            {title ?? labelForEntity(entity)}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {visibleFields.length} active {visibleFields.length === 1 ? 'field' : 'fields'}
          </p>
        </div>
        <a
          href="/app/settings/custom-fields"
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-surface-muted hover:text-foreground"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Configure
        </a>
      </div>
      {visibleFields.length === 0 ? (
        <div className="px-3 py-4 text-xs text-muted-foreground">
          No {entity} fields configured.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {visibleFields.map((field) => {
            const value = valuesByID.get(field.id)?.value ?? field.defaultValue ?? null;
            return (
              <CustomFieldControl
                key={field.id}
                field={field}
                value={value}
                onCommit={(next) => commit(field, next)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function CustomFieldControl({
  field,
  value,
  onCommit,
}: {
  field: CustomFieldRow;
  value: unknown;
  onCommit: (value: unknown) => void;
}) {
  const [local, setLocal] = useState(valueToInput(value));
  const [dirty, setDirty] = useState(false);
  const onCommitRef = useRef(onCommit);

  useEffect(() => {
    setLocal(valueToInput(value));
    setDirty(false);
  }, [value]);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    if (field.type !== 'text' && field.type !== 'dynamic_list') return;
    if (!dirty) return;
    const handle = window.setTimeout(() => {
      onCommitRef.current(local.trim() ? local : null);
      setDirty(false);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [dirty, field.type, local]);

  const requiredMissing = field.required && isEmptyValue(value);

  return (
    <div className="grid gap-1.5 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={field.id} className="truncate text-xs font-medium text-foreground">
          {field.displayName}
          {field.required ? <span className="ml-1 text-danger">*</span> : null}
        </label>
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {typeLabel(field.type)}
        </span>
      </div>
      {renderFieldInput(field, value, local, setLocal, setDirty, onCommit, requiredMissing)}
      {field.description ? (
        <p className="text-[11px] text-muted-foreground">{field.description}</p>
      ) : null}
      {requiredMissing ? <p className="text-[11px] text-danger">Required field.</p> : null}
    </div>
  );
}

function renderFieldInput(
  field: CustomFieldRow,
  value: unknown,
  local: string,
  setLocal: (value: string) => void,
  setDirty: (value: boolean) => void,
  onCommit: (value: unknown) => void,
  invalid: boolean,
) {
  const common = {
    id: field.id,
    'aria-invalid': invalid,
    className: 'h-8 text-xs',
  };

  switch (field.type) {
    case 'text':
    case 'dynamic_list':
      return (
        <Input
          {...common}
          value={local}
          onChange={(event) => {
            setLocal(event.target.value);
            setDirty(true);
          }}
          placeholder="Empty"
        />
      );
    case 'number':
      return (
        <Input
          {...common}
          type="number"
          step={1}
          value={local}
          onChange={(event) => setLocal(event.target.value)}
          onBlur={() => onCommit(local.trim() ? Number.parseInt(local, 10) : null)}
        />
      );
    case 'decimal':
      return (
        <Input
          {...common}
          type="number"
          step="any"
          value={local}
          onChange={(event) => setLocal(event.target.value)}
          onBlur={() => onCommit(local.trim() ? Number.parseFloat(local) : null)}
        />
      );
    case 'boolean':
      return (
        <button
          type="button"
          aria-pressed={value === true}
          aria-invalid={invalid}
          onClick={() => onCommit(value !== true)}
          className={cn(
            'flex h-8 w-fit items-center gap-2 rounded-md border border-border px-2 text-xs',
            value === true
              ? 'bg-brand-soft text-brand-soft-foreground'
              : 'bg-surface text-muted-foreground',
          )}
        >
          <span
            className={cn(
              'grid h-4 w-4 place-items-center rounded border',
              value === true
                ? 'border-brand-600 bg-brand-600 text-brand-foreground'
                : 'border-border-strong',
            )}
          >
            {value === true ? '✓' : ''}
          </span>
          {value === true ? 'Yes' : 'No'}
        </button>
      );
    case 'date':
      return (
        <Input
          {...common}
          type="date"
          value={local}
          onChange={(event) => {
            setLocal(event.target.value);
            onCommit(event.target.value || null);
          }}
        />
      );
    case 'list':
      return <SingleSelect field={field} value={value} invalid={invalid} onCommit={onCommit} />;
    case 'multi_select':
    case 'dynamic_multi_select':
      return <MultiSelect field={field} value={value} invalid={invalid} onCommit={onCommit} />;
    case 'url':
      return <UrlInput field={field} value={value} invalid={invalid} onCommit={onCommit} />;
    case 'address':
      return <JsonFallback field={field} value={value} invalid={invalid} onCommit={onCommit} />;
    case 'agent':
    case 'customer':
    case 'ticket':
      return (
        <Input
          {...common}
          value={local}
          onChange={(event) => setLocal(event.target.value)}
          onBlur={() => onCommit(local.trim() || null)}
          placeholder={`${typeLabel(field.type)} ID`}
        />
      );
  }
}

function SingleSelect({
  field,
  value,
  invalid,
  onCommit,
}: {
  field: CustomFieldRow;
  value: unknown;
  invalid: boolean;
  onCommit: (value: unknown) => void;
}) {
  const options = fieldOptions(field);
  const label = typeof value === 'string' && value ? value : 'Select value';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-invalid={invalid}
          className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-surface px-2 text-left text-xs text-surface-foreground aria-[invalid=true]:border-danger"
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{field.displayName}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onCommit(null)}>
          <X className="h-3.5 w-3.5" />
          Clear
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.length === 0 ? (
          <DropdownMenuItem disabled>No options configured</DropdownMenuItem>
        ) : (
          options.map((option) => (
            <DropdownMenuItem key={option} onSelect={() => onCommit(option)}>
              {option}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MultiSelect({
  field,
  value,
  invalid,
  onCommit,
}: {
  field: CustomFieldRow;
  value: unknown;
  invalid: boolean;
  onCommit: (value: unknown) => void;
}) {
  const options = fieldOptions(field);
  const selected = new Set(
    Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [],
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-invalid={invalid}
          className="flex min-h-8 w-full items-center justify-between rounded-md border border-input bg-surface px-2 py-1 text-left text-xs text-surface-foreground aria-[invalid=true]:border-danger"
        >
          <span className={cn('line-clamp-1', selected.size === 0 && 'text-muted-foreground')}>
            {selected.size > 0 ? [...selected].join(', ') : 'Select values'}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{field.displayName}</DropdownMenuLabel>
        {options.length === 0 ? (
          <DropdownMenuItem disabled>No options configured</DropdownMenuItem>
        ) : (
          options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option}
              checked={selected.has(option)}
              onSelect={(event) => {
                event.preventDefault();
                const next = new Set(selected);
                if (next.has(option)) next.delete(option);
                else next.add(option);
                onCommit([...next]);
              }}
            >
              {option}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UrlInput({
  field,
  value,
  invalid,
  onCommit,
}: {
  field: CustomFieldRow;
  value: unknown;
  invalid: boolean;
  onCommit: (value: unknown) => void;
}) {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const [url, setUrl] = useState(typeof record.url === 'string' ? record.url : '');
  const [title, setTitle] = useState(typeof record.title === 'string' ? record.title : '');

  useEffect(() => {
    setUrl(typeof record.url === 'string' ? record.url : '');
    setTitle(typeof record.title === 'string' ? record.title : '');
  }, [record.title, record.url]);

  return (
    <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-1.5">
      <Input
        id={field.id}
        value={url}
        aria-invalid={invalid}
        onChange={(event) => setUrl(event.target.value)}
        onBlur={() =>
          onCommit(url.trim() ? { url: url.trim(), title: title.trim() || undefined } : null)
        }
        placeholder="https://"
        className="h-8 text-xs"
      />
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() =>
          onCommit(url.trim() ? { url: url.trim(), title: title.trim() || undefined } : null)
        }
        placeholder="Title"
        className="h-8 text-xs"
      />
    </div>
  );
}

function JsonFallback({
  field,
  value,
  invalid,
  onCommit,
}: {
  field: CustomFieldRow;
  value: unknown;
  invalid: boolean;
  onCommit: (value: unknown) => void;
}) {
  const [local, setLocal] = useState(value ? JSON.stringify(value, null, 2) : '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocal(value ? JSON.stringify(value, null, 2) : '');
  }, [value]);

  return (
    <div className="grid gap-1">
      <Textarea
        id={field.id}
        value={local}
        aria-invalid={invalid || Boolean(error)}
        onChange={(event) => {
          setLocal(event.target.value);
          setError(null);
        }}
        onBlur={() => {
          if (!local.trim()) {
            onCommit(null);
            return;
          }
          try {
            onCommit(JSON.parse(local));
          } catch {
            setError('Use valid JSON for this advanced field.');
          }
        }}
        className="min-h-20 text-xs"
        placeholder='{"street1": "..."}'
      />
      {error ? <p className="text-[11px] text-danger">{error}</p> : null}
    </div>
  );
}

function fieldOptions(field: CustomFieldRow) {
  return Array.isArray(field.options)
    ? field.options.filter((item) => typeof item === 'string')
    : [];
}

function valueToInput(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return '';
}

function isEmptyValue(value: unknown) {
  return (
    value == null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
  );
}

function fieldIsVisible(field: CustomFieldRow, valuesByKey: Map<string, unknown>) {
  const condition = firstCondition(field.rules);
  if (!condition) return true;
  const actual = valuesByKey.get(condition.field);
  if (condition.operator === 'not_equals')
    return String(actual ?? '') !== String(condition.value ?? '');
  return String(actual ?? '') === String(condition.value ?? '');
}

function firstCondition(
  rules: unknown,
): { field: string; operator?: string; value: unknown } | null {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return null;
  const record = rules as Record<string, unknown>;
  if (typeof record.field === 'string') {
    return {
      field: record.field,
      operator: typeof record.operator === 'string' ? record.operator : 'equals',
      value: record.value,
    };
  }
  const conditions = Array.isArray(record.conditions) ? record.conditions : null;
  const first = conditions?.find((item) => item && typeof item === 'object');
  if (!first) return null;
  const condition = first as Record<string, unknown>;
  return typeof condition.field === 'string'
    ? {
        field: condition.field,
        operator: typeof condition.operator === 'string' ? condition.operator : 'equals',
        value: condition.value,
      }
    : null;
}

function labelForEntity(entity: CustomFieldCategory) {
  return entity === 'ticket' ? 'Ticket fields' : 'Customer fields';
}

function typeLabel(type: CustomFieldRow['type']) {
  return type.replaceAll('_', ' ');
}

function objectValue(source: unknown, key: string) {
  if (!source || typeof source !== 'object') return undefined;
  return (source as Record<string, unknown>)[key];
}
