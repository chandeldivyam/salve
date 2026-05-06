/// <reference path="../../.sst/platform/config.d.ts" />

/**
 * Vite SPA at app.usesalve.com.
 *
 * SST builds apps/web (`pnpm build` → dist/), uploads to a private S3 bucket,
 * fronts with CloudFront, and provisions an ACM cert in us-east-1 (required
 * for CloudFront).
 *
 * VITE_* env vars are baked into the bundle at build time. Each stage rebuilds.
 */

export const web = new sst.aws.StaticSite('Web', {
  path: 'apps/web',
  build: {
    command: 'pnpm build',
    output: 'dist',
  },
  domain: 'app.usesalve.com',
  environment: {
    VITE_API_URL: 'https://api.usesalve.com',
    VITE_ZERO_CACHE_URL: 'https://sync.usesalve.com',
    VITE_INBOUND_EMAIL_DOMAIN: 'in.usesalve.com',
    VITE_REPLY_EMAIL_DOMAIN: 'reply.usesalve.com',
  },
});

// TODO(launch): apex usesalve.com → 301 → app.usesalve.com. Lightweight
// CloudFront function attached to a placeholder StaticSite. Deferred until the
// API/web/zero-cache pipeline is stable.
