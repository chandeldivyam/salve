// Phase 40 — view query DSL.
//
// Shared types and helpers for the saved-view system. Used by:
//   - `queries.ts` — `ticketsForView` composes filters via `applyFilterToQuery`
//   - `view-mutators.ts` — `viewQueryZ` / `viewSortZ` validate stored shapes
//   - `apps/web/src/components/inbox/*` — chip filter bar, save modal,
//     drift detection, group-by renderer.

import { z } from 'zod';

// ---------- Filter DSL ----------

export const FILTER_FIELDS = [
  'status',
  'priority',
  'channel',
  'mailbox',
  'assignee',
  'tag',
  'customer',
  'createdAt',
  'updatedAt',
  'firstResponseAt',
  'resolvedAt',
] as const;

export type StaticFilterField = (typeof FILTER_FIELDS)[number];
export type FilterField = StaticFilterField | `customField:${string}`;

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'nin'
  | 'includesAny'
  | 'includesAll'
  | 'includesNone'
  | 'contains'
  | 'ncontains'
  | 'before'
  | 'after'
  | 'between'
  | 'inLast'
  | 'notInLast'
  | 'empty'
  | 'nempty';

/**
 * Discriminated-union shape for a single filter chip. The (operator, value
 * shape) pairing is structural so callers can never construct an `'in'` filter
 * with a single `value` instead of `values`.
 */
export type Filter =
  | {
      field: FilterField;
      operator: 'eq' | 'neq';
      value: string | number | boolean;
    }
  | {
      field: FilterField;
      operator: 'in' | 'nin' | 'includesAny' | 'includesAll' | 'includesNone';
      values: Array<string | number>;
    }
  | {
      field: FilterField;
      operator: 'contains' | 'ncontains';
      value: string;
    }
  | {
      field: FilterField;
      operator: 'before' | 'after';
      value: number;
    }
  | {
      field: FilterField;
      operator: 'between';
      values: [number, number];
    }
  | {
      field: FilterField;
      operator: 'inLast' | 'notInLast';
      value: { unit: 'minute' | 'hour' | 'day' | 'week'; n: number };
    }
  | {
      field: FilterField;
      operator: 'empty' | 'nempty';
    };

export interface ViewQuery {
  filters: Filter[];
  search?: string;
  matchAll?: boolean;
}

export interface ViewSort {
  field:
    | 'updatedAt'
    | 'createdAt'
    | 'priority'
    | 'shortID'
    | 'firstResponseAt'
    | 'resolvedAt'
    | `customField:${string}`;
  direction: 'asc' | 'desc';
}

export type GroupByAxis =
  | 'assignee'
  | 'priority'
  | 'status'
  | 'channel'
  | 'mailbox'
  | 'tag'
  | `customField:${string}`
  | null;

export type DisplayPropKey = 'customer' | 'channel' | 'tags' | 'priority' | 'updatedAt' | 'shortID';

export interface DisplayProps {
  show: DisplayPropKey[];
}

export const DEFAULT_DISPLAY_PROPS: DisplayProps = {
  show: ['customer', 'priority', 'tags', 'updatedAt'],
};

export const DEFAULT_VIEW_SORT: ViewSort = {
  field: 'updatedAt',
  direction: 'desc',
};

// ---------- Zod schemas (server-side validation) ----------

const filterFieldZ = z
  .string()
  .refine((v) => (FILTER_FIELDS as readonly string[]).includes(v) || v.startsWith('customField:'), {
    message: 'unknown filter field',
  }) as z.ZodType<FilterField>;

const dateUnitZ = z.enum(['minute', 'hour', 'day', 'week']);
const relativeRangeZ = z.object({ unit: dateUnitZ, n: z.number().int().min(1).max(10000) });

export const filterZ: z.ZodType<Filter> = z.discriminatedUnion('operator', [
  z.object({
    field: filterFieldZ,
    operator: z.literal('eq'),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
  z.object({
    field: filterFieldZ,
    operator: z.literal('neq'),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
  z.object({
    field: filterFieldZ,
    operator: z.literal('in'),
    values: z.array(z.union([z.string(), z.number()])).max(200),
  }),
  z.object({
    field: filterFieldZ,
    operator: z.literal('nin'),
    values: z.array(z.union([z.string(), z.number()])).max(200),
  }),
  z.object({
    field: filterFieldZ,
    operator: z.literal('includesAny'),
    values: z.array(z.union([z.string(), z.number()])).max(200),
  }),
  z.object({
    field: filterFieldZ,
    operator: z.literal('includesAll'),
    values: z.array(z.union([z.string(), z.number()])).max(200),
  }),
  z.object({
    field: filterFieldZ,
    operator: z.literal('includesNone'),
    values: z.array(z.union([z.string(), z.number()])).max(200),
  }),
  z.object({
    field: filterFieldZ,
    operator: z.literal('contains'),
    value: z.string().max(500),
  }),
  z.object({
    field: filterFieldZ,
    operator: z.literal('ncontains'),
    value: z.string().max(500),
  }),
  z.object({
    field: filterFieldZ,
    operator: z.literal('before'),
    value: z.number(),
  }),
  z.object({
    field: filterFieldZ,
    operator: z.literal('after'),
    value: z.number(),
  }),
  z.object({
    field: filterFieldZ,
    operator: z.literal('between'),
    values: z.tuple([z.number(), z.number()]),
  }),
  z.object({
    field: filterFieldZ,
    operator: z.literal('inLast'),
    value: relativeRangeZ,
  }),
  z.object({
    field: filterFieldZ,
    operator: z.literal('notInLast'),
    value: relativeRangeZ,
  }),
  z.object({ field: filterFieldZ, operator: z.literal('empty') }),
  z.object({ field: filterFieldZ, operator: z.literal('nempty') }),
]);

// `matchAll` is restricted to `true` (or omitted) because the v1 query
// path only implements AND semantics — accepting `false` and silently
// AND-ing it would let an agent save a view that returns wrong results.
// When OR support lands, broaden this to `z.boolean().optional()` and
// implement the OR branch in `ticketsForView`.
export const viewQueryZ: z.ZodType<ViewQuery> = z.object({
  filters: z.array(filterZ).max(40),
  search: z.string().trim().max(500).optional(),
  matchAll: z.literal(true).optional(),
}) as z.ZodType<ViewQuery>;

export const viewSortZ: z.ZodType<ViewSort> = z.object({
  field: z.union([
    z.enum(['updatedAt', 'createdAt', 'priority', 'shortID', 'firstResponseAt', 'resolvedAt']),
    z.string().regex(/^customField:/) as unknown as z.ZodType<`customField:${string}`>,
  ]),
  direction: z.enum(['asc', 'desc']),
});

export const groupByZ: z.ZodType<GroupByAxis> = z.union([
  z.enum(['assignee', 'priority', 'status', 'channel', 'mailbox', 'tag']),
  z.string().regex(/^customField:/) as unknown as z.ZodType<`customField:${string}`>,
  z.null(),
]);

export const displayPropsZ: z.ZodType<DisplayProps> = z.object({
  show: z
    .array(z.enum(['customer', 'channel', 'tags', 'priority', 'updatedAt', 'shortID']))
    .max(10),
});

// ---------- Resolved-filter helpers ----------

/**
 * `$ME` is a magic value resolved client-side at query time. Built-in views
 * use it for `assignee.eq.$ME` so the same definition serves every agent.
 */
export const ME_TOKEN = '$ME' as const;

/**
 * Resolve `$ME` placeholders into the caller's user id. Pure — never reads
 * `auth` directly so it stays trivially unit-testable.
 */
export function resolveMeTokens(viewQuery: ViewQuery, userID: string): ViewQuery {
  if (!viewQuery.filters.some(filterUsesMe)) return viewQuery;
  return {
    ...viewQuery,
    filters: viewQuery.filters.map((f) => resolveFilter(f, userID)),
  };
}

function filterUsesMe(filter: Filter): boolean {
  if ('value' in filter && filter.value === ME_TOKEN) return true;
  if (
    'values' in filter &&
    Array.isArray(filter.values) &&
    (filter.values as unknown[]).includes(ME_TOKEN)
  )
    return true;
  return false;
}

function resolveFilter(filter: Filter, userID: string): Filter {
  if ('value' in filter && filter.value === ME_TOKEN) {
    return { ...filter, value: userID } as Filter;
  }
  if (
    'values' in filter &&
    Array.isArray(filter.values) &&
    (filter.values as unknown[]).includes(ME_TOKEN)
  ) {
    return {
      ...filter,
      values: (filter.values as Array<string | number>).map((v) => (v === ME_TOKEN ? userID : v)),
    } as Filter;
  }
  return filter;
}

// ---------- Filter→Zero-where translation ----------

/** Status enum literal — mirrors `ticket.status` in `schema.ts`. */
export type TicketStatus = 'open' | 'in_progress' | 'snoozed' | 'resolved' | 'closed';
const TICKET_STATUSES: ReadonlyArray<TicketStatus> = [
  'open',
  'in_progress',
  'snoozed',
  'resolved',
  'closed',
];

/** Priority enum literal — mirrors `ticket.priority`. */
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
const TICKET_PRIORITIES: ReadonlyArray<TicketPriority> = ['low', 'normal', 'high', 'urgent'];

/**
 * Map a logical `FilterField` to the column key on the `ticket` table. Returns
 * undefined for fields that need a related-table predicate (e.g. `tag`,
 * `customField:*`) — those branches are handled by the caller.
 */
function ticketColumnFor(field: FilterField): string | undefined {
  switch (field) {
    case 'status':
      return 'status';
    case 'priority':
      return 'priority';
    case 'assignee':
      return 'assigneeID';
    case 'customer':
      return 'customerID';
    case 'createdAt':
      return 'createdAt';
    case 'updatedAt':
      return 'updatedAt';
    case 'firstResponseAt':
      return 'firstResponseAt';
    case 'resolvedAt':
      return 'resolvedAt';
    default:
      return undefined;
  }
}

/**
 * Convert a relative range like `{ unit: 'day', n: 7 }` into an absolute epoch
 * cutoff (now minus N units). Pure: takes `now` so unit tests can pin time.
 */
export function relativeCutoff(now: number, unit: 'minute' | 'hour' | 'day' | 'week', n: number) {
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

/**
 * Apply a single `Filter` to a Zero query builder. Mirrors zbugs's
 * `buildListQuery` (`shared/queries.ts:358-449`) — imperative,
 * field-by-field. The caller has already chosen AND vs OR semantics; this
 * helper only knows how to translate one filter into one .where() clause.
 *
 * Generic over the query type so it returns the same builder type back —
 * the caller can keep chaining `.related()` / `.orderBy()` after.
 */
// biome-ignore lint/suspicious/noExplicitAny: ZQL builder; matches zbugs queries.ts
export function applyFilterToQuery<TQuery extends { where: any }>(
  q: TQuery,
  filter: Filter,
  now: number = Date.now(),
): TQuery {
  // Tag and custom-field branches need related-table predicates.
  if (filter.field === 'tag') {
    return applyTagFilter(q, filter);
  }
  if (typeof filter.field === 'string' && filter.field.startsWith('customField:')) {
    // Server side narrows by *existence* of a value for this field key.
    // The actual operator/value comparison happens in `customFieldPredicate`
    // (apps/web/src/lib/inbox/custom-field-filter) against the materialized
    // `customFieldValues` rows. The two-stage approach lets us support every
    // operator across all 14 field types without imposing jsonb-shape
    // constraints on Zero's `.where()` operators.
    return applyCustomFieldExistence(q, filter);
  }
  if (filter.field === 'channel' || filter.field === 'mailbox') {
    // No FK from ticket → channel/mailbox yet; reserved for future phase.
    return q;
  }

  const column = ticketColumnFor(filter.field);
  if (!column) return q;

  // "any" semantics: a multi-value chip with zero values means the user
  // hasn't picked yet — it must be a *no-op*, not a never-match. The
  // previous code returned `or()` (a no-arg disjunction = false) which
  // caused chips like `Status: any` to silently empty the inbox. Detect
  // here and bail before hitting the where-builder.
  if (
    'values' in filter &&
    Array.isArray((filter as { values?: unknown }).values) &&
    (filter as { values: unknown[] }).values.length === 0 &&
    (filter.operator === 'in' ||
      filter.operator === 'nin' ||
      filter.operator === 'includesAny' ||
      filter.operator === 'includesAll' ||
      filter.operator === 'includesNone')
  ) {
    return q;
  }

  // biome-ignore lint/suspicious/noExplicitAny: dynamic where helpers
  return q.where(({ cmp, and, not, or }: any) => {
    switch (filter.operator) {
      case 'eq':
        return cmp(column, '=', filter.value);
      case 'neq':
        return not(cmp(column, '=', filter.value));
      case 'in':
        // values.length > 0 guaranteed by the early-return above.
        return or(...filter.values.map((v: string | number) => cmp(column, '=', v)));
      case 'nin':
        return and(...filter.values.map((v: string | number) => not(cmp(column, '=', v))));
      case 'before':
        return cmp(column, '<', filter.value);
      case 'after':
        return cmp(column, '>', filter.value);
      case 'between':
        return and(cmp(column, '>=', filter.values[0]), cmp(column, '<=', filter.values[1]));
      case 'inLast': {
        const cutoff = relativeCutoff(now, filter.value.unit, filter.value.n);
        return cmp(column, '>=', cutoff);
      }
      case 'notInLast': {
        const cutoff = relativeCutoff(now, filter.value.unit, filter.value.n);
        return cmp(column, '<', cutoff);
      }
      case 'empty':
        return cmp(column, 'IS', null);
      case 'nempty':
        return cmp(column, 'IS NOT', null);
      case 'contains':
      case 'ncontains':
        // ILIKE the column — only meaningful on `title` / `description`,
        // neither of which is a FilterField yet. Reserved.
        return cmp(column, '=', column);
      default:
        return cmp(column, '=', column);
    }
  });
}

/**
 * Apply tag filtering via the `tags` related-row whereExists.
 * `includesAny` / `includesAll` use `exists()` directly — those work on
 * the client. `includesNone` and `empty` require `not(exists(...))`,
 * which Zero on the client does not support
 * (https://bugs.rocicorp.dev/issue/3438). For those we leave the server
 * query unfiltered and rely on the inbox post-filter (`tagPredicate` in
 * `apps/web/src/lib/inbox/tag-filter.ts`) to narrow client-side. The
 * `tags` relation is already loaded on every inbox row.
 */
// biome-ignore lint/suspicious/noExplicitAny: ZQL builder
function applyTagFilter<TQuery extends { where: any }>(q: TQuery, filter: Filter): TQuery {
  // "any" — a chip that hasn't picked any tag is a no-op, not a never-match.
  if (
    'values' in filter &&
    Array.isArray((filter as { values?: unknown }).values) &&
    (filter as { values: unknown[] }).values.length === 0
  ) {
    return q;
  }

  // biome-ignore lint/suspicious/noExplicitAny: dynamic helpers
  const includesAny = (values: ReadonlyArray<string | number>) =>
    q.where(({ exists, or }: any) =>
      or(...values.map((tagID) => exists('tags', (t: any) => t.where('tagID', '=', tagID)))),
    ) as TQuery;

  // biome-ignore lint/suspicious/noExplicitAny: dynamic helpers
  const includesAll = (values: ReadonlyArray<string | number>) =>
    q.where(({ exists, and }: any) =>
      and(...values.map((tagID) => exists('tags', (t: any) => t.where('tagID', '=', tagID)))),
    ) as TQuery;

  if (filter.operator === 'includesAny' || filter.operator === 'in') {
    return includesAny(filter.values);
  }
  if (filter.operator === 'includesAll') return includesAll(filter.values);
  if (filter.operator === 'nempty') {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic helpers
    return q.where(({ exists }: any) => exists('tags')) as TQuery;
  }
  // includesNone / nin / empty → client-side post-filter.
  return q;
}

// biome-ignore lint/suspicious/noExplicitAny: ZQL builder
function applyCustomFieldExistence<TQuery extends { where: any }>(
  q: TQuery,
  filter: Filter,
): TQuery {
  if (filter.field.startsWith('customField:') === false) return q;
  const fieldKey = filter.field.slice('customField:'.length);
  // `empty`, `neq`, `nin`, `includesNone`, `notInLast` all want a
  // not-exists / negation predicate which Zero on the client doesn't
  // support (rocicorp/issue/3438). We leave the server query unfiltered
  // and rely on `customFieldPredicate` (apps/web) to narrow client-side
  // against the materialized `customFieldValues` rows.
  const isNegation =
    filter.operator === 'empty' ||
    filter.operator === 'neq' ||
    filter.operator === 'nin' ||
    filter.operator === 'includesNone' ||
    filter.operator === 'ncontains' ||
    filter.operator === 'notInLast';
  if (isNegation) return q;

  // For positive operators, narrow at the Zero layer to tickets that
  // have *some* value for this field key. The exact operator + value
  // comparison happens client-side in `customFieldPredicate` because
  // value shapes (arrays, objects) can't be uniformly expressed in ZQL.
  return q.where(
    // biome-ignore lint/suspicious/noExplicitAny: dynamic helpers
    ({ exists }: any) =>
      exists('customFieldValues', (v: any) =>
        v.whereExists('field', (f: any) => f.where('key', '=', fieldKey)),
      ),
  ) as TQuery;
}

/**
 * Convert a `ViewSort` into the (column, direction) tuple `Zero.orderBy()`
 * accepts. Custom-field sort lands on the parent ticket's `updatedAt` for
 * v1 (custom-field-aware ordering needs a join we don't ship yet).
 */
export function viewSortToOrderBy(sort: ViewSort | undefined): [string, 'asc' | 'desc'] {
  const s = sort ?? DEFAULT_VIEW_SORT;
  if (s.field.startsWith('customField:')) return ['updatedAt', s.direction];
  // shortID exists on ticket; map known sort fields through.
  const FIELD_MAP: Record<string, string> = {
    updatedAt: 'updatedAt',
    createdAt: 'createdAt',
    priority: 'priority',
    shortID: 'shortID',
    firstResponseAt: 'firstResponseAt',
    resolvedAt: 'resolvedAt',
  };
  return [FIELD_MAP[s.field] ?? 'updatedAt', s.direction];
}

// ---------- Validity helpers (used in mutator validation) ----------

/**
 * Return the static valid status values, used by URL filter parsers and
 * by the chip filter bar's value editor.
 */
export function ticketStatuses(): ReadonlyArray<TicketStatus> {
  return TICKET_STATUSES;
}

export function ticketPriorities(): ReadonlyArray<TicketPriority> {
  return TICKET_PRIORITIES;
}
