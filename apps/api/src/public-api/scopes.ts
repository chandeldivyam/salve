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

type PermissionStatements = Record<string, string[]>;

const API_SCOPE_SET = new Set<string>(API_SCOPES);

export function isApiScope(value: string): value is ApiScope {
  return API_SCOPE_SET.has(value);
}

export function permissionStatementsFromScopes(scopes: readonly ApiScope[]): PermissionStatements {
  const permissions: PermissionStatements = {};
  for (const scope of scopes) {
    const separator = scope.lastIndexOf(':');
    const resource = scope.slice(0, separator);
    const action = scope.slice(separator + 1);
    permissions[resource] = [...(permissions[resource] ?? []), action];
  }
  return permissions;
}

export function scopesFromPermissionStatements(value: unknown): ApiScope[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];

  const scopes: ApiScope[] = [];
  for (const [resource, actions] of Object.entries(value)) {
    if (!Array.isArray(actions)) continue;
    for (const action of actions) {
      if (typeof action !== 'string') continue;
      const scope = `${resource}:${action}`;
      if (isApiScope(scope)) scopes.push(scope);
    }
  }
  return [...new Set(scopes)];
}

export function hasScope(scopes: readonly ApiScope[] | undefined, required: ApiScope): boolean {
  return scopes?.includes(required) ?? false;
}

export function hasScopes(
  scopes: readonly ApiScope[] | undefined,
  required: readonly ApiScope[],
): boolean {
  return required.every((scope) => hasScope(scopes, scope));
}
