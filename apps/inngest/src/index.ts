// @salve/inngest — placeholder workspace.
//
// Phase 3a: the `outbound-email` function lives in
// `apps/api/src/inngest/functions/outbound-email.ts` because it needs the
// email-builder (envelope.ts, mailer.ts, reply-token.ts) and Drizzle client
// that the Hono process already loads. Inngest registers it via
// `serve()` mounted at `/api/inngest` on the Hono server.
//
// Phase 3b will start migrating function code here once the inbound pipeline
// stabilises (those functions are heavier and want their own deploy lane).

export const PLACEHOLDER = '@salve/inngest' as const;
