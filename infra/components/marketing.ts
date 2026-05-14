/// <reference path="../../.sst/platform/config.d.ts" />

/**
 * Marketing site at the apex usesalve.com (prod) — Next.js 15 deployed via
 * sst.aws.Nextjs (OpenNext): server Lambdas + CloudFront + image optimization.
 *
 *   prod    → usesalve.com, with www.usesalve.com 301-redirecting to apex.
 *   <other> → <stage>.usesalve.com (e.g. staging.usesalve.com), no redirect.
 *
 * SST auto-detects the existing Route 53 zone for usesalve.com, provisions an
 * ACM cert in us-east-1 (CloudFront requirement, SANs for apex + www on prod),
 * and creates the A/AAAA alias records. No env/link wiring yet — the site is
 * self-contained today. Add `NEXT_PUBLIC_*` build-time vars here if/when we
 * need to point at api.usesalve.com or app.usesalve.com from the marketing
 * bundle.
 */

const isProd = $app.stage === 'prod';

export const marketing = new sst.aws.Nextjs('Marketing', {
  path: 'apps/marketing',
  domain: {
    name: isProd ? 'usesalve.com' : `${$app.stage}.usesalve.com`,
    redirects: isProd ? ['www.usesalve.com'] : [],
  },
});
