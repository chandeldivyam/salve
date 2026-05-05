import { isScope as isActionScope, SCOPES, type Scope } from '@opendesk/action-contracts';

export const API_SCOPES = SCOPES;

export type ApiScope = Scope;

type PermissionStatements = Record<string, string[]>;

export function isApiScope(value: string): value is ApiScope {
  return isActionScope(value);
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
  if (typeof value === 'string') {
    try {
      return scopesFromPermissionStatements(JSON.parse(value));
    } catch {
      return [];
    }
  }

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
