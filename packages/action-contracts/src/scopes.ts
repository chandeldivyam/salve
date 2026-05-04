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
