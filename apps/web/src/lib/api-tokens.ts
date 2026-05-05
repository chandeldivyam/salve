// Phase A — write-only client for token endpoints. Reads come from Zero
// (`queries.apiTokensForCurrentUser`, `queries.serviceAccounts`,
// `queries.serviceAccountTokens`). Plaintext is server-only and shown once
// at create time, so create stays POST.

const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export const API_SCOPES = [
  'tickets:read',
  'tickets:write',
  'customers:read',
  'customers:write',
  'views:read',
  'views:write',
  'settings:read',
  'settings:write',
  'settings:email:write',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export interface CreatedToken {
  id: string;
  token: string;
  name: string | null;
  prefix: string;
  principalKind: 'user' | 'service_account';
  scopes: ApiScope[];
  expiresAt: string | null;
  createdAt: string;
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const payload = (await res.json().catch(() => null)) as T | { error?: string } | null;
  if (!res.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `${res.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export function createPat(input: {
  name: string;
  scopes: ApiScope[];
  expiresInDays?: number;
}): Promise<CreatedToken> {
  return jsonFetch('/api/settings/api-tokens', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function revokePat(id: string): Promise<void> {
  return jsonFetch(`/api/settings/api-tokens/${id}`, { method: 'DELETE' });
}

export function createServiceAccount(input: {
  name: string;
  scopes: ApiScope[];
}): Promise<CreatedToken & { memberID: string }> {
  return jsonFetch('/api/settings/service-accounts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteServiceAccount(memberID: string): Promise<void> {
  return jsonFetch(`/api/settings/service-accounts/${memberID}`, { method: 'DELETE' });
}
