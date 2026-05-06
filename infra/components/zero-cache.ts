/// <reference path="../../.sst/platform/config.d.ts" />

import { zeroReplicasBucket } from './buckets';
import { cluster } from './cluster';
import { postgres } from './postgres';
import { authSecret, zeroAdminPassword } from './secrets';

/**
 * Rocicorp Zero — single-node topology (view-syncer + replication-manager +
 * Litestream in one container) per zero.rocicorp.dev/docs/deployment.
 *
 * - Image: rocicorp/zero:0.25 — pinned tag (Zero versions move quickly).
 * - Storage: SQLite replica file in container ephemeral FS at /data/replica.db.
 *   Litestream (built into the image) replicates continuously to S3.
 * - Sticky session affinity is required on the ALB target group: clients
 *   must land on the same view-syncer for cache coherence.
 * - WebSockets: ALB HTTP/HTTPS listeners pass them through natively.
 * - Health: GET /keepalive (Zero's built-in liveness path).
 */

export const zeroCache = new sst.aws.Service('ZeroCache', {
  cluster,
  // Pinned to match the @rocicorp/zero npm version pinned in the workspace
  // (see AGENTS.md "Zero (rocicorp) 1.x" — `npm view @rocicorp/zero version`).
  image: 'rocicorp/zero:1.3.0',
  cpu: '1 vCPU',
  memory: '2 GB',
  scaling: { min: 1, max: 1 },
  // Spot is fine pre-launch — interruptions cost a client resync. Switch to
  // 'fargate' before public launch (see plan §12).
  capacity: 'spot',
  loadBalancer: {
    rules: [{ listen: '443/https', forward: '4848/http' }],
    domain: 'sync.usesalve.com',
    health: {
      '4848/http': {
        path: '/keepalive',
        interval: '30 seconds',
        timeout: '5 seconds',
        successCodes: '200',
        healthyThreshold: 2,
        unhealthyThreshold: 5,
      },
    },
    // Sticky cookie affinity — required for Zero. View-syncers maintain a
    // per-instance SQLite replica + per-client CVR; without stickiness the
    // client thrashes between instances and triggers redundant hydration.
    transform: {
      target: {
        stickiness: {
          enabled: true,
          type: 'lb_cookie',
          cookieDuration: 120,
        },
      },
    },
  },
  link: [authSecret, zeroAdminPassword, zeroReplicasBucket],
  environment: {
    AWS_REGION: 'us-east-1',
    ZERO_PORT: '4848',
    // /tmp always exists + is writeable in the image. Litestream replicates
    // continuously to S3, so ephemeral storage is fine — on container restart
    // we restore from S3 (or resync from upstream Postgres if S3 is empty).
    ZERO_REPLICA_FILE: '/tmp/replica.db',
    ZERO_LOG_LEVEL: 'info',
    ZERO_LOG_FORMAT: 'json',
    // Postgres connections — single Aurora cluster, three logical pointers.
    ZERO_UPSTREAM_DB: postgres.databaseUrl,
    ZERO_CVR_DB: postgres.databaseUrl,
    ZERO_CHANGE_DB: postgres.databaseUrl,
    // JWT verification (same secret the Hono API signs with).
    ZERO_AUTH_SECRET: authSecret.value,
    // Admin/introspection auth — required by zero-cache 1.3+ in production.
    ZERO_ADMIN_PASSWORD: zeroAdminPassword.value,
    // Forward queries + mutations to the Hono API. Cookie forwarding is on
    // so the JWT cookie reaches the API authenticated.
    ZERO_QUERY_URL: 'https://api.usesalve.com/api/zero/query',
    ZERO_MUTATE_URL: 'https://api.usesalve.com/api/zero/mutate',
    ZERO_QUERY_FORWARD_COOKIES: 'true',
    ZERO_MUTATE_FORWARD_COOKIES: 'true',
    // Litestream backup — value is a Pulumi output of the bucket name.
    ZERO_LITESTREAM_BACKUP_URL: $interpolate`s3://${zeroReplicasBucket.name}/replica/v1`,
  },
});
