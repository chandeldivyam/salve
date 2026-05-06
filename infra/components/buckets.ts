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

// rawEmailBucket: SES inbound writes RFC822 blobs here. We extend the
// SST-generated bucket policy via transform.policy to add an SES PutObject
// allow statement (S3 only allows one policy per bucket).
const accountId = aws.getCallerIdentityOutput({}).accountId;
export const rawEmailBucket = new sst.aws.Bucket('RawEmail', {
  transform: {
    policy: (args) => {
      args.policy = $resolve([args.policy, accountId]).apply(([existing, acct]) => {
        const parsed =
          typeof existing === 'string' && existing.length > 0
            ? (JSON.parse(existing) as { Version: string; Statement: unknown[] })
            : { Version: '2012-10-17', Statement: [] };
        // Find the bucket ARN from the existing TLS-enforce statement; fall
        // back to a wildcard if SST's default policy ever changes shape.
        const firstStmt = parsed.Statement[0] as { Resource?: string | string[] } | undefined;
        const resource = Array.isArray(firstStmt?.Resource)
          ? firstStmt.Resource[0]
          : firstStmt?.Resource;
        const bucketArn = (resource ?? '*').replace(/\/?\*$/, '');
        parsed.Statement.push({
          Sid: 'AllowSESInboundPuts',
          Effect: 'Allow',
          Principal: { Service: 'ses.amazonaws.com' },
          Action: 's3:PutObject',
          Resource: `${bucketArn}/inbound/*`,
          Condition: { StringEquals: { 'AWS:SourceAccount': acct } },
        });
        return JSON.stringify(parsed);
      });
    },
  },
});

export const zeroReplicasBucket = new sst.aws.Bucket('ZeroReplicas');
