// Phase 40 — custom field post-filter.
//
// Custom field values are jsonb in Postgres and Zero materializes them as
// opaque parsed JSON in the client store. ZQL's `.where('value', op, …)`
// can't uniformly express predicates across the 14 different field types
// (esp. arrays for multi_select, objects for url/address). So we narrow
// at the Zero level by *existence* (ticket has a value for this field
// key) and apply the actual operator/value comparison here in JS, against
// the already-materialized rows.
//
// Performance: post-filter runs over the inbox window (≤2000 tickets) ×
// the chip filters in question (typically ≤5). It's a few thousand
// operations per render — well below the noise floor for a 60fps UI.

import type { Filter, FilterField } from '@opendesk/zero-schema';

/**
 * The minimum shape we need from a materialized ticket row. Matches the
 * `customFieldValues` and `tags` related rows that `ticketsForView`
 * ships. Both are optional because the loader gates `customFieldValues`
 * on chip presence; `tags` is always loaded but typed loose so unit
 * tests can pass a stripped row.
 */
export interface TicketWithCustomFieldValues {
  customFieldValues?: ReadonlyArray<{
    value: unknown;
    field?: { key: string; type?: string } | null;
  }> | null;
  tags?: ReadonlyArray<{ tagID: string }> | null;
}

/**
 * `customField:KEY` field guard. Returns the key (without prefix) if the
 * filter targets a custom field, undefined otherwise.
 */
export function customFieldKeyOf(field: FilterField): string | undefined {
  if (typeof field !== 'string') return undefined;
  if (!field.startsWith('customField:')) return undefined;
  return field.slice('customField:'.length);
}

/**
 * Decide if a ticket matches a single custom-field filter. Pure: takes a
 * `now` so date-relative filters are testable.
 */
export function matchesCustomFieldFilter(
  ticket: TicketWithCustomFieldValues,
  filter: Filter,
  now: number = Date.now(),
): boolean {
  const key = customFieldKeyOf(filter.field);
  if (!key) return true; // not a custom field filter — caller is wrong, fail-open

  const rows = ticket.customFieldValues ?? [];
  const matches = rows.filter((r) => r.field?.key === key);
  // For 'empty' / 'nempty' we just check existence.
  if (filter.operator === 'empty') return matches.length === 0;
  if (filter.operator === 'nempty') return matches.length > 0;
  if (matches.length === 0) return false; // ticket has no value to compare

  // Most types store a single row; multi-select still stores one row whose
  // `value` is an array. Compare against the first match.
  const value = matches[0]?.value;

  switch (filter.operator) {
    case 'eq':
      return scalarsEqual(value, filter.value);
    case 'neq':
      return !scalarsEqual(value, filter.value);
    case 'in':
      return filter.values.some((v) => scalarsEqual(value, v));
    case 'nin':
      return !filter.values.some((v) => scalarsEqual(value, v));
    case 'includesAny':
      return arrayIncludesAny(value, filter.values);
    case 'includesAll':
      return arrayIncludesAll(value, filter.values);
    case 'includesNone':
      return !arrayIncludesAny(value, filter.values);
    case 'contains':
      return stringContains(value, filter.value);
    case 'ncontains':
      return !stringContains(value, filter.value);
    case 'before':
      return numericLT(toComparable(value), toComparable(filter.value));
    case 'after':
      return numericGT(toComparable(value), toComparable(filter.value));
    case 'between': {
      const v = toComparable(value);
      const lo = toComparable(filter.values[0]);
      const hi = toComparable(filter.values[1]);
      return v != null && lo != null && hi != null && v >= lo && v <= hi;
    }
    case 'inLast': {
      const cutoff = relativeCutoff(now, filter.value.unit, filter.value.n);
      const v = toComparable(value);
      return v != null && v >= cutoff;
    }
    case 'notInLast': {
      const cutoff = relativeCutoff(now, filter.value.unit, filter.value.n);
      const v = toComparable(value);
      return v != null && v < cutoff;
    }
    default:
      return true;
  }
}

/**
 * Apply all custom-field filters from a list. Returns a predicate function
 * suitable for `Array.prototype.filter`. Filters that don't reference a
 * custom field are skipped here (they're handled server-side by Zero).
 */
export function customFieldPredicate(
  filters: ReadonlyArray<Filter>,
  now: number = Date.now(),
): (ticket: TicketWithCustomFieldValues) => boolean {
  const customFieldFilters = filters.filter((f) => customFieldKeyOf(f.field));
  if (customFieldFilters.length === 0) return () => true;
  return (ticket) =>
    customFieldFilters.every((filter) => matchesCustomFieldFilter(ticket, filter, now));
}

/**
 * Match a single tag filter against a materialized ticket. Returns true
 * for filters that aren't `tag.*` so callers can chain it with the
 * generic predicate. Only handles the operators that Zero couldn't
 * narrow server-side — `empty`, `includesNone`, `nin` — because the
 * client doesn't support `not(exists(...))` (rocicorp/issue/3438).
 * Other tag operators are filtered server-side and short-circuit here.
 */
export function matchesTagFilter(ticket: TicketWithCustomFieldValues, filter: Filter): boolean {
  if (filter.field !== 'tag') return true;
  const tagIDs = (ticket.tags ?? []).map((t) => t.tagID);
  if (filter.operator === 'empty') return tagIDs.length === 0;
  if (filter.operator === 'includesNone' || filter.operator === 'nin') {
    if (!('values' in filter)) return true;
    if (filter.values.length === 0) return true;
    const ban = new Set(filter.values.map(String));
    return !tagIDs.some((id) => ban.has(id));
  }
  // Server-side branches (`includesAny`, `includesAll`, `nempty`, etc.)
  // already narrowed; nothing to do client-side.
  return true;
}

/**
 * Combined client-side post-filter for the inbox. Custom-field filters
 * always run here (Zero can't express their type-aware comparisons),
 * plus the tag operators that need `not(exists)`. Caller should pass
 * the full filter list — non-applicable filters short-circuit to true.
 */
export function clientFilterPredicate(
  filters: ReadonlyArray<Filter>,
  now: number = Date.now(),
): (ticket: TicketWithCustomFieldValues) => boolean {
  const cf = customFieldPredicate(filters, now);
  const negationTagFilters = filters.filter(
    (f) =>
      f.field === 'tag' &&
      (f.operator === 'empty' || f.operator === 'includesNone' || f.operator === 'nin'),
  );
  if (negationTagFilters.length === 0) return cf;
  return (ticket) => {
    if (!cf(ticket)) return false;
    for (const f of negationTagFilters) {
      if (!matchesTagFilter(ticket, f)) return false;
    }
    return true;
  };
}

// ---------- helpers ----------

function scalarsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Number-string coercion for the common case where the chip ships a
  // numeric value as a string (URL-decoded JSON loses no info, but agent
  // pickers may emit strings for IDs and the value is also a string).
  if (typeof a === 'number' && typeof b === 'string') return String(a) === b;
  if (typeof a === 'string' && typeof b === 'number') return a === String(b);
  return false;
}

function arrayIncludesAny(value: unknown, candidates: ReadonlyArray<unknown>): boolean {
  if (Array.isArray(value)) {
    return candidates.some((c) => value.some((v) => scalarsEqual(v, c)));
  }
  // Field is configured as list/single but filter wants includesAny —
  // treat scalar value as a one-element array.
  return candidates.some((c) => scalarsEqual(value, c));
}

function arrayIncludesAll(value: unknown, required: ReadonlyArray<unknown>): boolean {
  if (Array.isArray(value)) {
    return required.every((r) => value.some((v) => scalarsEqual(v, r)));
  }
  // Scalar can only "contain all" if there's exactly one required value.
  return required.length === 1 && scalarsEqual(value, required[0]);
}

function stringContains(value: unknown, needle: string): boolean {
  const hay = stringifyForContains(value).toLowerCase();
  return hay.includes(needle.toLowerCase());
}

/**
 * Flatten a value for the `contains` operator. Strings ride through;
 * numbers/booleans get coerced; objects (url/address) get stringified so
 * the operator works against any meaningful field. Arrays get their items
 * joined with newline so a multi-select value is searchable too.
 */
function stringifyForContains(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(stringifyForContains).join('\n');
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map(stringifyForContains)
      .join(' ');
  }
  return '';
}

/**
 * Convert a value into something orderable. Returns:
 *   - number for numbers
 *   - epoch ms for date strings (`YYYY-MM-DD`)
 *   - epoch ms for ISO datetime strings
 *   - undefined otherwise (callers treat as "doesn't compare")
 */
function toComparable(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const t = Date.parse(`${value}T00:00:00.000Z`);
      return Number.isFinite(t) ? t : undefined;
    }
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

function numericLT(a: number | undefined, b: number | undefined): boolean {
  return a !== undefined && b !== undefined && a < b;
}

function numericGT(a: number | undefined, b: number | undefined): boolean {
  return a !== undefined && b !== undefined && a > b;
}

function relativeCutoff(now: number, unit: 'minute' | 'hour' | 'day' | 'week', n: number): number {
  const ms =
    unit === 'minute'
      ? 60_000
      : unit === 'hour'
        ? 3_600_000
        : unit === 'day'
          ? 86_400_000
          : 604_800_000;
  return now - n * ms;
}
