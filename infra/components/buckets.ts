/// <reference path="../../.sst/platform/config.d.ts" />

/**
 * S3 buckets owned by salve. CloudFront-fronted buckets (the web SPA) are
 * managed by their own component (web.ts via sst.aws.StaticSite).
 *
 * - Attachments: customer-uploaded files; signed-URL access only.
 * - Raw email: SES inbound RFC822 archive (compliance + replay).
 * - Zero replicas: Litestream backup of zero-cache's SQLite replica file.
 *
 * All buckets block public access by default (SST sets this via the Bucket
 * component). Versioning + lifecycle are switched on at launch (see plan §12).
 */

export const attachmentsBucket = new sst.aws.Bucket('Attachments');
export const rawEmailBucket = new sst.aws.Bucket('RawEmail');
export const zeroReplicasBucket = new sst.aws.Bucket('ZeroReplicas');
