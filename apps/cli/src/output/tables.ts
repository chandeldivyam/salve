import type { OutputContext } from './format.js';

type ObjectRow = Record<string, unknown>;

export function simpleTable(rows: readonly ObjectRow[], columns: readonly string[]) {
  return {
    head: columns.map((column) => column.toUpperCase()),
    rows: rows.map((row) => columns.map((column) => formatCell(row[column]))),
  };
}

export function ticketTable(value: unknown, _context: OutputContext) {
  const rows = rowsFrom(value);
  return simpleTable(rows, ['shortId', 'title', 'status', 'priority', 'updatedAt']);
}

export function customerTable(value: unknown, _context: OutputContext) {
  const rows = rowsFrom(value);
  return simpleTable(rows, ['email', 'name', 'lastSeenAt', 'updatedAt']);
}

export function workspaceTable(value: unknown, _context: OutputContext) {
  const rows = rowsFrom(value);
  return {
    head: ['ACTIVE', 'SLUG', 'NAME', 'ROLE'],
    rows: rows.map((row) => [
      row.active ? '*' : '',
      formatCell(row.slug),
      formatCell(row.name),
      formatCell(row.role),
    ]),
  };
}

export function tagTable(value: unknown, _context: OutputContext) {
  const object = value as { tags?: ObjectRow[]; data?: ObjectRow[] };
  return simpleTable(object.tags ?? object.data ?? rowsFrom(value), [
    'label',
    'color',
    'archivedAt',
  ]);
}

export function defaultTable(value: unknown, _context: OutputContext) {
  return simpleTable(rowsFrom(value), ['id', 'name', 'label', 'status']);
}

function rowsFrom(value: unknown): ObjectRow[] {
  if (Array.isArray(value)) return value.filter(isObject);
  if (isObject(value) && Array.isArray(value.data)) return value.data.filter(isObject);
  if (isObject(value)) {
    const firstArray = Object.values(value).find(Array.isArray);
    if (Array.isArray(firstArray)) return firstArray.filter(isObject);
    return [value];
  }
  return [];
}

function isObject(value: unknown): value is ObjectRow {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function formatCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
