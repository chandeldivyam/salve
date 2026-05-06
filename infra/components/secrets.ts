/// <reference path="../../.sst/platform/config.d.ts" />

/**
 * Runtime secrets declared as SST Secrets. Values are stored in AWS SSM
 * Parameter Store (encrypted) and must be set per-stage via:
 *
 *   pnpm sst secret set <Name> "<value>" --stage prod
 *
 * SST `Linkable.link()` injects these into Service tasks as env vars and
 * grants the task role read access automatically. Never log these values
 * in CI — see docs/cicd-plan.md §6.
 *
 * Set helper script: scripts/sst-bootstrap-secrets.sh — pulls from local
 * .env (dev convenience) and pushes to the stage's secret store.
 */

export const authSecret = new sst.Secret('AuthSecret');

// Inngest Cloud — Event Key (publish), Signing Key (serve verification),
// Management API Key (CI sync). All three live in the user's local .env
// and are pushed to SST secrets via scripts/sst-bootstrap-secrets.sh.
export const inngestEventKey = new sst.Secret('InngestEventKey');
export const inngestSigningKey = new sst.Secret('InngestSigningKey');
export const inngestApiKey = new sst.Secret('InngestApiKey');

// better-auth Google OAuth — optional. The auth route disables Google login
// when these are unset, so leaving them as empty strings is safe.
export const googleClientId = new sst.Secret('GoogleClientId', '');
export const googleClientSecret = new sst.Secret('GoogleClientSecret', '');

// SES inbound webhook signature — wired up at PR 10. Stub for now.
export const sesWebhookSecret = new sst.Secret('SesWebhookSecret', '');
