// Drizzle schema barrel — what `drizzle-kit` reads to generate migrations.
// Split by concern.
//   - auth.ts   : better-auth core + organization plugin tables
//   - domain.ts : help-desk entities (Phase 2a — customer, ticket, message,
//                 attachment, audit_event); all carry workspace_id.
export * from './auth.js';
export * from './custom-field.js';
export * from './domain.js';
export * from './email.js';
export * from './tag.js';
export * from './workspace.js';
