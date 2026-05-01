// Workspace-scoped full-text search across tickets and customers. Used by
// the command palette's free-text search.
//
// Performance contract (intentionally conservative):
//   1. Every search query is GIN-index-bound. The WHERE clause uses only
//      `search_vector @@ tsq`. We never fall back to ILIKE / similarity in
//      the WHERE, because those paths can land on sequential scans for
//      short queries and OR-with-multi-index plans add planner cost without
//      meaningfully improving recall at this stage.
//   2. The tsquery is built from sanitized alphanumeric tokens of length
//      ≥ 2. Single-character queries return early. The tokens are
//      AND-combined with `:*` prefix matching, so typing "amel" matches
//      "amelia". Special characters can never reach `to_tsquery`.
//   3. Each statement runs inside a transaction with
//      `SET LOCAL statement_timeout = '500ms'`. A pathological query is
//      cancelled rather than holding a pool connection.
//   4. The connection pool is `max=10`. With two parallel queries per
//      request, ~5 concurrent searches saturate it — the debounce
//      (150 ms) + abort-on-keystroke on the client keeps that comfortably
//      below the ceiling.
//
// If we need fuzzier matching (typo tolerance, substring middle-of-word),
// add a second query that uses `pg_trgm.word_similarity` with a high
// similarity threshold and a separate trigram-only WHERE — keep it
// behind a feature flag and re-measure before shipping.

import { getClient } from '@opendesk/db';
import type { Context } from 'hono';
import { authOf } from '../middleware.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const MIN_QUERY_CHARS = 2;
const MAX_QUERY_CHARS = 200;
const STATEMENT_TIMEOUT_MS = 500;
const SEARCH_TYPES = ['ticket', 'customer'] as const;

type SearchType = (typeof SEARCH_TYPES)[number];

interface TicketSearchRow {
  readonly id: string;
  readonly short_id: number;
  readonly title: string;
  readonly customer_email: string | null;
  readonly score: number | string | null;
}

interface CustomerSearchRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly score: number | string | null;
}

interface TicketSearchResult {
  readonly id: string;
  readonly shortID: number;
  readonly title: string;
  readonly customerEmail: string | null;
  readonly score: number;
}

interface CustomerSearchResult {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly score: number;
}

function parseLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 0), MAX_LIMIT);
}

function parseTypes(value: string | undefined): ReadonlySet<SearchType> {
  if (!value?.trim()) return new Set<SearchType>(SEARCH_TYPES);
  const parsed = new Set<SearchType>();
  for (const rawType of value.split(',')) {
    const type = rawType.trim();
    if (type === 'ticket' || type === 'customer') parsed.add(type);
  }
  return parsed;
}

function normalizeQuery(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_CHARS);
}

// Builds a `to_tsquery`-safe prefix-AND tsquery string from sanitized
// alphanumeric tokens. Returns null when no token meets the floor.
//
// The output is fed into `to_tsquery('simple', $1)`. Because we strip
// every non-`a-z0-9` character before joining with our own ` & ` and
// `:*`, the result cannot contain a `to_tsquery` syntax error or an
// injection vector.
function buildTsQuery(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter((token) => token.length >= MIN_QUERY_CHARS);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `${token}:*`).join(' & ');
}

function toScore(value: number | string | null): number {
  const score = Number(value ?? 0);
  return Number.isFinite(score) ? score : 0;
}

async function searchTickets(args: {
  readonly workspaceID: string;
  readonly tsquery: string;
  readonly limit: number;
}): Promise<TicketSearchResult[]> {
  const sql = getClient();
  const rows = await sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
    return tx<TicketSearchRow[]>`
      SELECT
        t.id::text,
        t.short_id,
        t.title,
        c.email AS customer_email,
        ts_rank(t.search_vector, to_tsquery('simple', ${args.tsquery}))::double precision AS score
      FROM ticket t
      LEFT JOIN customer c
        ON c.id = t.customer_id
        AND c.workspace_id = t.workspace_id
      WHERE t.workspace_id = ${args.workspaceID}
        AND t.search_vector @@ to_tsquery('simple', ${args.tsquery})
      ORDER BY score DESC, t.updated_at DESC
      LIMIT ${args.limit}
    `;
  });

  return rows.map((row) => ({
    id: row.id,
    shortID: row.short_id,
    title: row.title,
    customerEmail: row.customer_email,
    score: toScore(row.score),
  }));
}

async function searchCustomers(args: {
  readonly workspaceID: string;
  readonly tsquery: string;
  readonly limit: number;
}): Promise<CustomerSearchResult[]> {
  const sql = getClient();
  const rows = await sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
    return tx<CustomerSearchRow[]>`
      SELECT
        c.id::text,
        coalesce(c.display_name, c.name, c.email) AS name,
        c.email,
        ts_rank(c.search_vector, to_tsquery('simple', ${args.tsquery}))::double precision AS score
      FROM customer c
      WHERE c.workspace_id = ${args.workspaceID}
        AND c.search_vector @@ to_tsquery('simple', ${args.tsquery})
      ORDER BY score DESC, c.updated_at DESC
      LIMIT ${args.limit}
    `;
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    score: toScore(row.score),
  }));
}

export async function handleSearch(c: Context) {
  const auth = authOf(c);
  if (!auth.workspaceID) return c.json({ error: 'no-workspace' }, 403);

  const query = normalizeQuery(c.req.query('q'));
  const tsquery = buildTsQuery(query);
  if (!tsquery) return c.json({ tickets: [], customers: [] });

  const limit = parseLimit(c.req.query('limit'));
  const types = parseTypes(c.req.query('types'));
  if (limit === 0 || types.size === 0) {
    return c.json({ tickets: [], customers: [] });
  }

  const args = { workspaceID: auth.workspaceID, tsquery, limit };
  try {
    const [tickets, customers] = await Promise.all([
      types.has('ticket') ? searchTickets(args) : Promise.resolve([]),
      types.has('customer') ? searchCustomers(args) : Promise.resolve([]),
    ]);
    return c.json({ tickets, customers });
  } catch (err) {
    // Statement timeout fires as `query_canceled` (SQLSTATE 57014). Surface
    // empty results rather than an error so the palette stays usable; log so
    // we can spot a regression that exceeds the budget.
    if (isQueryCanceled(err)) {
      console.warn('[search] query cancelled by statement_timeout', {
        workspaceID: auth.workspaceID,
        tsquery,
      });
      return c.json({ tickets: [], customers: [] });
    }
    throw err;
  }
}

function isQueryCanceled(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return code === '57014';
}
