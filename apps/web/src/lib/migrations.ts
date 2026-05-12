// Atlas migration write-only client. Reads come from Zero
// (`queries.atlasMigrationRuns`, `queries.atlasWebhookSubscriptions`); only
// writes that hit a third-party (Atlas) need a REST round-trip.

const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export type AtlasWebhookEvent =
  | 'conversation.message'
  | 'conversation.status'
  | 'conversation.priority'
  | 'conversation.tags';

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await res.json().catch(() => null)) as
    | T
    | { error?: string; message?: string; causeCode?: string }
    | null;
  if (!res.ok) {
    const message = formatApiError(payload, res.status);
    throw new Error(message);
  }
  return payload as T;
}

function formatApiError(
  payload: { error?: string; message?: string; causeCode?: string } | null | unknown,
  status: number,
): string {
  if (!payload || typeof payload !== 'object') return `${status}`;
  const p = payload as { error?: string; message?: string; causeCode?: string };
  const head = p.error ?? `${status}`;
  // `fetch failed` is undici's generic message; the actual reason is in causeCode
  // (e.g. ENOTFOUND on DNS failure). Surface it so the toast is actionable.
  if ((head === 'atlas-auth-failed' || head === 'atlas-unreachable') && p.causeCode) {
    return `Atlas unreachable (${p.causeCode}). Check your network/DNS and retry.`;
  }
  if (p.message && p.message !== head) return `${head}: ${p.message}`;
  return head;
}

export interface StartAtlasMigrationInput {
  apiKey: string;
  baseUrl?: string;
  maxTickets?: number;
  sinceDays?: number;
  startDate?: string;
  endDate?: string;
}

export function startAtlasMigration(
  input: StartAtlasMigrationInput,
): Promise<{ runId: string; status: string }> {
  return jsonFetch('/api/migrations/atlas/start', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function subscribeAtlasWebhook(input: {
  event: AtlasWebhookEvent;
  runId?: string;
}): Promise<{ ok: true; alreadySubscribed?: boolean }> {
  return jsonFetch('/api/migrations/atlas/webhooks/subscribe', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function unsubscribeAtlasWebhook(
  event: AtlasWebhookEvent,
): Promise<{ ok: true; alreadyUnsubscribed?: boolean }> {
  return jsonFetch('/api/migrations/atlas/webhooks/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ event }),
  });
}

export function setAtlasRunApiKey(input: {
  apiKey: string;
  baseUrl?: string;
}): Promise<{ ok: true; runId: string }> {
  return jsonFetch('/api/migrations/atlas/api-key', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export const ATLAS_WEBHOOK_EVENTS: readonly AtlasWebhookEvent[] = [
  'conversation.message',
  'conversation.status',
  'conversation.priority',
  'conversation.tags',
] as const;

export const ATLAS_WEBHOOK_EVENT_LABELS: Record<AtlasWebhookEvent, string> = {
  'conversation.message': 'New message',
  'conversation.status': 'Status change',
  'conversation.priority': 'Priority change',
  'conversation.tags': 'Tag change',
};

export const ATLAS_WEBHOOK_EVENT_DESCRIPTIONS: Record<AtlasWebhookEvent, string> = {
  'conversation.message':
    'Stream new replies into Salve as they arrive in Atlas. Lazy-expands the ticket if it was outside your initial backfill window.',
  'conversation.status':
    'Mirror status changes (open/closed/snoozed/pending) onto imported tickets.',
  'conversation.priority': 'Mirror priority changes onto imported tickets.',
  'conversation.tags': 'Mirror tag additions and removals onto imported tickets.',
};
