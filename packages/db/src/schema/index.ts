// Drizzle schema barrel — what `drizzle-kit` reads to generate migrations.
// Split by concern.
//   - auth.ts   : better-auth core + organization plugin tables
//   - domain.ts : help-desk entities (Phase 2a — customer, ticket, message,
//                 attachment, audit_event); all carry workspace_id.

export * from './api.js';
export * from './auth.js';
export * from './custom-field.js';
export * from './domain.js';
export * from './email.js';
export * from './migration.js';
export * from './tag.js';
export * from './view.js';
export * from './workspace.js';
