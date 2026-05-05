// @salve/core — domain types, validators, utilities shared across the monorepo.
// Phase 0 placeholder: real entities (SLA math, ticket validators, etc.) land in Phase 2+.

export const SERVICE_NAME = 'salve' as const;
export const PUBLIC_BRAND = 'Salve' as const;

export * from './email/index.js';
