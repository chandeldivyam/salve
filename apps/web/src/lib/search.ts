// Thin wrapper over `/api/search`. The endpoint is hardened to return
// empty for sub-floor queries; the client mirrors that floor so we don't
// burn a fetch round-trip for one-character keystrokes.

export interface TicketSearchResult {
  readonly id: string;
  readonly shortID: number;
  readonly title: string;
  readonly customerEmail: string | null;
  readonly score: number;
}

export interface CustomerSearchResult {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly score: number;
}

export interface SearchResponse {
  readonly tickets: ReadonlyArray<TicketSearchResult>;
  readonly customers: ReadonlyArray<CustomerSearchResult>;
}

const DEFAULT_LIMIT = 10;
export const SEARCH_MIN_QUERY_CHARS = 2;

const EMPTY_RESPONSE: SearchResponse = { tickets: [], customers: [] };

const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export async function searchAll(
  query: string,
  signal?: AbortSignal,
  limit = DEFAULT_LIMIT,
): Promise<SearchResponse> {
  const trimmed = query.trim();
  if (trimmed.length < SEARCH_MIN_QUERY_CHARS) return EMPTY_RESPONSE;

  const params = new URLSearchParams({
    q: trimmed,
    types: 'ticket,customer',
    limit: String(limit),
  });
  const res = await fetch(`${apiBase}/api/search?${params.toString()}`, {
    credentials: 'include',
    signal,
  });
  if (!res.ok) {
    throw new Error(`Search failed: ${res.status}`);
  }
  return (await res.json()) as SearchResponse;
}
