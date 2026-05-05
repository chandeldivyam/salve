export const SCOPES = [
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

export type Scope = (typeof SCOPES)[number];

const SCOPE_SET = new Set<string>(SCOPES);

export function isScope(value: string): value is Scope {
  return SCOPE_SET.has(value);
}

export function scopeImplies(granted: Scope, required: Scope): boolean {
  return granted === required;
}

export type RoleForScopes = 'owner' | 'admin' | 'agent' | null;

// Maximum scope envelope a workspace role is allowed to grant when minting
// an API token. Cookie-auth callers (the dashboard) don't carry an explicit
// scope set; they get capped against this. Bearer-auth callers (PAT or
// service-account) are capped against their own granted scopes — never
// against this table — because their effective privilege is already <= role.
export function scopesForRole(role: RoleForScopes): readonly Scope[] {
  if (role === 'owner' || role === 'admin') return SCOPES;
  if (role === 'agent') {
    return SCOPES.filter((scope) => scope !== 'settings:write' && scope !== 'settings:email:write');
  }
  return [];
}

// Returns the requested scopes that exceed the granted envelope. Caller
// decides whether to 403 or filter. Accepts arbitrary strings on the
// `requested` side because the contract input may be `z.string().enum(...)`
// which TypeScript widens to `string[]` at the boundary; the inclusion
// check is a string compare anyway.
export function scopesExceeding(
  requested: readonly string[],
  granted: readonly Scope[],
): readonly string[] {
  const grantedSet = new Set<string>(granted);
  return requested.filter((scope) => !grantedSet.has(scope));
}
