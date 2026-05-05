import { mutators } from '@salve/mutators';
import { queries } from '@salve/zero-schema';

// Pick any cheap workspace-scoped list query — this is a structural
// alias used only to coerce `queries` into a flexible map shape; it
// doesn't actually run.
type SupportMetadataQuery = ReturnType<typeof queries.tags>;
type SupportMetadataMutation = ReturnType<typeof mutators.ticket.close>;

export type CustomFieldCategory = 'ticket' | 'customer';

export type CustomFieldType =
  | 'text'
  | 'number'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'list'
  | 'multi_select'
  | 'agent'
  | 'customer'
  | 'ticket'
  | 'url'
  | 'address'
  | 'dynamic_list'
  | 'dynamic_multi_select';

export interface TagGroupRow {
  id: string;
  label: string;
  color: string;
  sortOrder: number;
  archivedAt?: number | null;
}

export interface TagRow {
  id: string;
  groupID?: string | null;
  label: string;
  color?: string | null;
  sortOrder: number;
  archivedAt?: number | null;
  group?: TagGroupRow | null;
}

export interface TicketTagRow {
  ticketID?: string;
  customerID?: string;
  tagID?: string;
  addedAt?: number | null;
  tag?: TagRow | null;
}

export interface CustomFieldRow {
  id: string;
  key: string;
  displayName: string;
  description?: string | null;
  category: CustomFieldCategory;
  type: CustomFieldType;
  required: boolean;
  active: boolean;
  archivedAt?: number | null;
  options?: readonly string[] | null;
  defaultValue?: unknown;
  dynamicConfig?: unknown;
  rules?: unknown;
  dependsOn?: readonly string[] | null;
  sortOrder: number;
}

export interface CustomFieldValueRow {
  id?: string;
  fieldID: string;
  ticketID?: string | null;
  customerID?: string | null;
  value: unknown;
  field?: CustomFieldRow | null;
}

export const supportMetadataQueries = queries as typeof queries & {
  tagGroups: () => SupportMetadataQuery;
  tagGroupsForSettings: () => SupportMetadataQuery;
  tags: () => SupportMetadataQuery;
  tagsForSettings: () => SupportMetadataQuery;
  customFieldsByCategory: (args: { category: CustomFieldCategory }) => SupportMetadataQuery;
  customFieldsForSettings: (args: { category: CustomFieldCategory }) => SupportMetadataQuery;
};

export const supportMetadataMutators = mutators as typeof mutators & {
  tagGroup: {
    create: (args: Record<string, unknown>) => SupportMetadataMutation;
    update: (args: Record<string, unknown>) => SupportMetadataMutation;
    archive: (args: { id: string }) => SupportMetadataMutation;
    restore: (args: { id: string }) => SupportMetadataMutation;
  };
  tag: {
    create: (args: Record<string, unknown>) => SupportMetadataMutation;
    update: (args: Record<string, unknown>) => SupportMetadataMutation;
    archive: (args: { id: string }) => SupportMetadataMutation;
    restore: (args: { id: string }) => SupportMetadataMutation;
    attachToTicket: (args: { ticketID: string; tagID: string }) => SupportMetadataMutation;
    detachFromTicket: (args: { ticketID: string; tagID: string }) => SupportMetadataMutation;
    attachToCustomer: (args: { customerID: string; tagID: string }) => SupportMetadataMutation;
    detachFromCustomer: (args: { customerID: string; tagID: string }) => SupportMetadataMutation;
  };
  customField: {
    create: (args: Record<string, unknown>) => SupportMetadataMutation;
    update: (args: Record<string, unknown>) => SupportMetadataMutation;
    archive: (args: { id: string }) => SupportMetadataMutation;
    setValueOnTicket: (args: Record<string, unknown>) => SupportMetadataMutation;
    clearValueOnTicket: (args: { fieldID: string; ticketID: string }) => SupportMetadataMutation;
    setValueOnCustomer: (args: Record<string, unknown>) => SupportMetadataMutation;
    clearValueOnCustomer?: (args: {
      fieldID: string;
      customerID: string;
    }) => SupportMetadataMutation;
  };
};

export function isHexColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

export function normalizeHexColor(value: string, fallback = '#0f766e') {
  const next = value.trim();
  return isHexColor(next) ? next : fallback;
}

export function tagColor(tag: TagRow | null | undefined) {
  return tag?.color || tag?.group?.color || '#0f766e';
}

export function tagPillStyle(tag: TagRow | null | undefined) {
  const color = normalizeHexColor(tagColor(tag));
  return {
    backgroundColor: `${color}1f`,
    borderColor: `${color}66`,
    color,
  };
}

export function rowsAs<T>(rows: unknown): T[] {
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export function sortedTagsFromRelations(relations: unknown): TagRow[] {
  return rowsAs<TicketTagRow>(relations)
    .filter((row) => row.tag && !row.tag.archivedAt)
    .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
    .map((row) => row.tag as TagRow);
}

export function fieldValuesByFieldID(values: unknown) {
  const map = new Map<string, CustomFieldValueRow>();
  for (const row of rowsAs<CustomFieldValueRow>(values)) {
    if (row.fieldID) map.set(row.fieldID, row);
  }
  return map;
}

export function isCustomFieldActive(field: CustomFieldRow) {
  return field.active !== false && !field.archivedAt;
}
